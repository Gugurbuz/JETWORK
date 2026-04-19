import { useStore } from '../store/useStore';
import { db, doc, setDoc, updateDoc, serverTimestamp } from '../db';
import { Message, DocumentData, SectionData } from '../types';
import { callGemini } from '../services/aiService';
import { chatResponseJsonSchema } from '../schemas';
import { saveDocumentAndVersion } from '../utils/documentUtils';
import { SYSTEM_INSTRUCTION, SYSTEM_AGENTS } from '../constants';
import { buildSystemPrompt } from '../services/promptEngine';
import { hybridSearch, extractKeyFacts, summarizeConversation } from '../services/contextManager';
import { parse as parsePartialJson } from 'partial-json';

export const useMessages = (channelRef: any) => {
  const { 
    user, 
    currentWorkspaceId, 
    setMessages, 
    setShowNewItemModal, 
    setIsGenerating,
    selectedModel,
    setDocumentContent
  } = useStore();

  const handleSendMessage = async (text: string, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[], replyToId?: string) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!user) return;
    
    if (!currentWorkspaceId) {
      setShowNewItemModal(true);
      return;
    }

    const isSingleAgentMode = text.startsWith('@');
    
    let targetAgentRole = '';
    let targetAgentName = '';
    let messageText = text;

    if (isSingleAgentMode) {
      const match = text.match(/^@(\w+)\s+(.*)/);
      if (match) {
        const agentName = match[1];
        messageText = match[2];
        const agent = SYSTEM_AGENTS.find(a => a.name.toLowerCase() === agentName.toLowerCase());
        if (agent) {
          targetAgentRole = agent.role;
          targetAgentName = agent.name;
        } else {
           setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'model',
            text: `❌ Hata: "@${agentName}" adında bir ajan bulunamadı. Lütfen geçerli bir ajan adı girin (örn: @BA, @IT).`,
            senderName: 'Sistem',
            senderRole: 'Hata',
            createdAt: Date.now(),
            isError: true
          }]);
          return;
        }
      } else {
         setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'model',
            text: `❌ Hata: Ajan adından sonra bir mesaj girmelisiniz (örn: "@BA bana bir analiz yaz").`,
            senderName: 'Sistem',
            senderRole: 'Hata',
            createdAt: Date.now(),
            isError: true
          }]);
          return;
      }
    }

    const msgId = Date.now().toString();
    const newMsg: Message = {
      id: msgId,
      role: 'user',
      text: messageText,
      senderName: user.name || 'Kullanıcı',
      senderRole: 'Kullanıcı',
      createdAt: Date.now(),
      attachments: attachments?.map(a => ({ url: a.url, data: a.data, name: a.name, mimeType: a.mimeType })),
      replyToId
    };

    setMessages(prev => [...prev, newMsg]);

    try {
      await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', msgId), {
        ...newMsg,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to save user message to database:", err);
    }

    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'new_message', payload: { itemId: currentWorkspaceId, message: newMsg } });
    }

    setIsGenerating(true);
    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    setMessages(prev => [...prev, {
      id: aiMsgId,
      role: 'model',
      text: '',
      senderName: targetAgentName || 'JetWork AI',
      senderRole: targetAgentName ? targetAgentName : 'Sistem Asistanı',
      agentRole: targetAgentRole || undefined,
      createdAt: Date.now(),
      isTyping: true
    }]);

    const state = useStore.getState();
    const promptSettings = state.promptSettings;
    const knowledgeBase = state.knowledgeBase;
    const addKnowledge = state.addKnowledge;
    const memoryEnabled = promptSettings?.memoryEnabled ?? true;
    const contextWindowSize = promptSettings?.contextWindowSize ?? 10;

    try {
      const currentMessages = state.messages;
      const documentContent = state.documentContent;
      
      // 1. Hybrid Search (RAG)
      let retrievedContext = "";
      if (memoryEnabled && knowledgeBase.length > 0) {
        const relevantKnowledge = hybridSearch(messageText, knowledgeBase, 3);
        if (relevantKnowledge.length > 0) {
          retrievedContext = "\n\n[KURUMSAL HAFIZA / GEÇMİŞ BİLGİLER]\n" + 
            relevantKnowledge.map(k => `- ${k.content} (Önem: ${k.importance}/10)`).join('\n');
        }
      }

      // 2. Context Window Management
      let historyToSend = currentMessages.slice(-contextWindowSize);
      
      // Smart Summarization Trigger
      if (memoryEnabled && currentMessages.length > contextWindowSize + 5) {
        // Background task: Summarize older messages
        const messagesToSummarize = currentMessages.slice(0, currentMessages.length - contextWindowSize);
        summarizeConversation(messagesToSummarize).then(summary => {
          if (summary) {
            addKnowledge({
              id: Date.now().toString(),
              content: `Önceki Konuşma Özeti: ${summary}`,
              keywords: ['özet', 'geçmiş', 'konuşma'],
              importance: 9,
              createdAt: Date.now(),
              projectId: currentWorkspaceId
            });
          }
        }).catch(console.error);
      }

      const history = historyToSend.map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: `[${m.senderName} - ${m.senderRole}]: ${m.text}` }]
      }));

      let systemInstruction = buildSystemPrompt({ role: 'SYSTEM', settings: promptSettings, additionalContext: retrievedContext });
      if (targetAgentRole) {
        systemInstruction = buildSystemPrompt({ role: targetAgentRole, settings: promptSettings, additionalContext: retrievedContext });
      }

      // Late Prompt Injection for BA format
      systemInstruction += "\n\n[ÇOK ÖNEMLİ KISITLAMA]: Eğer BA Analiz Dokümanını (İş Analizi) güncelleyeceksen, ASLA Markdown, Yönetici Özeti (Executive Summary), As-Is, To-Be GİBİ BAŞLIKLAR KULLANMA. SADECE Semantik HTML kullan. Mutlaka şu yapıya tamı tamına uy:\n\n1. ANALİZ KAPSAMI\n2. KISALTMALAR\n3. İŞ GEREKSİNİMLERİ\n   3.1. İş Kuralları\n   3.2. İş Modeli ve Kullanıcı Gereksinimleri\n4. FONKSİYONEL GEREKSİNİMLER (FR)\n   4.1. Fonksiyonel Gereksinim Maddeleri (CRM vb.)\n   4.2. Fonksiyonel Gereksinim Maddeleri (BILL vb.)\n5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)\n   5.1. Güvenlik ve Yetkilendirme Gereksinimleri\n   5.2. Performans Gereksinimleri\n   5.3. Raporlama Gereksinimleri\n6. SÜREÇ RİSK ANALİZİ\n   6.1. Kısıtlar ve Varsayımlar\n   6.2. Bağlılıklar\n   6.3. Süreç Etkileri\n7. ONAY\n   7.1. İş Analizi (Tablo formatında)\n   7.2. Değişiklik Kayıtları (Tablo formatında)\n   7.3. Doküman Onay (Tablo formatında)\n   7.4. Referans Dokümanlar (Tablo formatında)\n8. FONKSİYONEL TASARIM DOKÜMANLARI\n\nTabloları HTML table tagleriyle (<table>, <thead>, <tr>, <th>, <td>, <tbody>) eksiksiz çiz.";

      let documentContextStr = '';
      if (documentContent && Object.keys(documentContent).length > 0) {
         documentContextStr = `\n\nAşağıda doküman sekmelerinin güncel durumu bulunmaktadır. Düzenleme yaparken bu HTML yapısını baz al ve sadece istenen bölümleri değiştirerek veya ekleyerek dokümanın TAMAMINI ŞEMA İÇİNDE yeniden üret.\n[MEVCUT DOKÜMAN DURUMU]\n${JSON.stringify(documentContent, null, 2)}`;
      }

      const contents = [
        ...history,
        {
          role: 'user',
          parts: [
            { text: `[${user.name} - Kullanıcı]: ${messageText}${documentContextStr}` },
            ...(attachments?.map(a => ({
              inlineData: {
                data: a.data,
                mimeType: a.mimeType
              }
            })) || [])
          ]
        }
      ];

      const response = await callGemini({
        model: selectedModel,
        systemInstruction,
        contents,
        responseSchema: chatResponseJsonSchema,
        currentDocument: documentContent,
        onChunk: (text, thinking, tokenCount) => {
          let chunkText = text;
          let chunkThinking = thinking || '';
          
          let jsonToParse = text.trim();
          const jsonBlockMatch = text.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
          if (jsonBlockMatch) {
            jsonToParse = jsonBlockMatch[1].trim();
          }

          let isParsedAsJson = false;
          let chunkQuestions = undefined;
          if (jsonToParse && jsonToParse.startsWith('{')) {
             try {
               const parsed = parsePartialJson(jsonToParse);
               if (parsed && typeof parsed === 'object') {
                 if (parsed.message) {
                   chunkText = parsed.message;
                   isParsedAsJson = true;
                 }
                 if (parsed.thinking && !chunkThinking) chunkThinking = parsed.thinking;
                 if (parsed.questions && Array.isArray(parsed.questions)) {
                   chunkQuestions = parsed.questions;
                 }
                 
                 // If AI used the document property in JSON schema to update document
                 if (parsed.document && typeof parsed.document === 'object' && currentWorkspaceId) {
                   setDocumentContent((prev) => {
                     const newDoc = { ...prev } as DocumentData;
                     let hasChanges = false;
                     ['businessAnalysis', 'code', 'test', 'review', 'bpmn'].forEach((section) => {
                       if (parsed.document[section]) {
                         let newContent = parsed.document[section].content || '';
                         const currentSection = prev?.[section as keyof DocumentData] as SectionData | undefined;
                         
                         if (newContent && newContent !== currentSection?.content) {
                           (newDoc as any)[section] = {
                             content: newContent,
                             status: parsed.document[section].status || 'DRAFT',
                             flags: parsed.document[section].flags || []
                           };
                           hasChanges = true;
                         }
                       }
                     });
                     if (hasChanges) {
                       saveDocumentAndVersion(currentWorkspaceId, aiMsgId, newDoc);
                       return newDoc;
                     }
                     return prev;
                   });
                 }
               }
             } catch (e) {}
          }
          
          if (!isParsedAsJson) {
            chunkText = text.trim();
          }

          setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
            ...m, 
            text: chunkText, 
            thinkingText: chunkThinking,
            questions: chunkQuestions,
            tokenCount 
          } : m));
          
          if (channelRef.current) {
            channelRef.current.send({ 
              type: 'broadcast', 
              event: 'ai_stream_chunk', 
              payload: { 
                id: aiMsgId, 
                text: chunkText, 
                thinkingText: chunkThinking,
                senderName: targetAgentName || 'JetWork AI',
                senderRole: targetAgentName || 'Sistem Asistanı',
                agentRole: targetAgentRole || undefined
              } 
            });
          }
        }
      });

      let finalDocument = useStore.getState().documentContent;
      let fullText = response.text;
      let finalQuestions = undefined;

      // Extract final parsed data from the completed response.text
      let jsonToParseFinal = response.text.trim();
      const jsonBlockMatchFinal = response.text.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
      if (jsonBlockMatchFinal) {
        jsonToParseFinal = jsonBlockMatchFinal[1].trim();
      }
      if (jsonToParseFinal && jsonToParseFinal.startsWith('{')) {
         try {
           const parsedFinal = JSON.parse(jsonToParseFinal);
           if (parsedFinal.document && currentWorkspaceId) {
             const newDoc = { ...finalDocument } as DocumentData;
             let hasChanges = false;
             ['businessAnalysis', 'code', 'test', 'review', 'bpmn'].forEach((section) => {
               if (parsedFinal.document[section]) {
                 let newContent = parsedFinal.document[section].content || '';
                 const currentSection = finalDocument?.[section as keyof DocumentData] as SectionData | undefined;
                 
                 if (newContent && newContent !== currentSection?.content) {
                   (newDoc as any)[section] = {
                     content: newContent,
                     status: parsedFinal.document[section].status || 'DRAFT',
                     flags: parsedFinal.document[section].flags || []
                   };
                   hasChanges = true;
                 }
               }
             });
             if (hasChanges) {
               finalDocument = newDoc;
               useStore.getState().setDocumentContent(newDoc);
               fullText += `\n\n*(Sistem Notu: Doküman güncellendi)*`;
             }
           }
           if (parsedFinal.message) {
             fullText = parsedFinal.message;
             if (parsedFinal.document && Object.keys(parsedFinal.document).length > 0) {
               fullText += `\n\n*(Sistem Notu: Doküman güncellendi)*`;
             }
           }
           if (parsedFinal.questions && Array.isArray(parsedFinal.questions) && parsedFinal.questions.length > 0) {
             finalQuestions = parsedFinal.questions;
           }
         } catch(e) {}
      }

      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: fullText, questions: finalQuestions, isTyping: false } : m));
      
      if (channelRef.current) {
        const finalMsg = useStore.getState().messages.find(m => m.id === aiMsgId);
        if (finalMsg) {
          channelRef.current.send({ 
            type: 'broadcast', 
            event: 'ai_stream_end', 
            payload: { 
              id: aiMsgId, 
              text: finalMsg.text, 
              thinkingText: finalMsg.thinkingText,
              senderName: targetAgentName || 'JetWork AI',
              senderRole: targetAgentName || 'Sistem Asistanı',
              agentRole: targetAgentRole || undefined
            } 
          });
          
          await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
            ...finalMsg,
            createdAt: serverTimestamp()
          });

          if (finalDocument && Object.keys(finalDocument).length > 0) {
            await saveDocumentAndVersion(currentWorkspaceId, aiMsgId, finalDocument);
          }
        }
      }

    } catch (error) {
      console.error("AI Error:", error);
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
        ...m, 
        text: "Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.", 
        isTyping: false,
        isError: true 
      } : m));
    } finally {
      // Background task: Extract key facts from user message
      if (memoryEnabled) {
        extractKeyFacts(messageText).then(facts => {
          facts.forEach(f => {
            if (f.importance >= 5) {
              addKnowledge({
                id: Date.now().toString() + Math.random().toString(36).substring(7),
                content: f.fact,
                keywords: f.fact.toLowerCase().split(' ').slice(0, 5), // Simple keywords
                importance: f.importance,
                createdAt: Date.now(),
                projectId: currentWorkspaceId
              });
            }
          });
        }).catch(console.error);
      }

      setIsGenerating(false);
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!user || !currentWorkspaceId) return;
    
    const state = useStore.getState();
    const message = state.messages.find(m => m.id === messageId);
    if (!message) return;

    const currentReactions = message.reactions || [];
    const existingReactionIndex = currentReactions.findIndex(r => r.emoji === emoji);
    
    let newReactions = [...currentReactions];
    
    if (existingReactionIndex >= 0) {
      const reaction = newReactions[existingReactionIndex];
      if (reaction.users.includes(user.name)) {
        reaction.users = reaction.users.filter(u => u !== user.name);
        if (reaction.users.length === 0) {
          newReactions.splice(existingReactionIndex, 1);
        }
      } else {
        reaction.users.push(user.name);
      }
    } else {
      newReactions.push({ emoji, users: [user.name] });
    }

    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: newReactions } : m));

    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', messageId), {
        reactions: newReactions
      });
    } catch (error) {
      console.error("Error updating reaction:", error);
    }
  };

  const handleAcceptAiHandRaise = () => {
    const state = useStore.getState();
    if (state.aiHandRaised) {
      state.setAiHandRaised(null);
    }
  };

  return { handleSendMessage, handleToggleReaction, handleAcceptAiHandRaise };
};
