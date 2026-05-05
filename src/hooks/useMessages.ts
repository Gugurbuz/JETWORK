import { useStore } from '../store/useStore';
import { supabase } from '../supabase';
import { Message, DocumentData, SectionData } from '../types';
import { camelToSnake, nowIso } from '../lib/mapping';
import { runZeroTouchMode } from '../services/agentRunner';
import { callGemini, callAiWithRetry } from '../services/geminiService';
import { chatResponseJsonSchema } from '../schemas';
import { saveDocumentAndVersion, applyPatch } from '../utils/documentUtils';
import { SYSTEM_INSTRUCTION, ZERO_TOUCH_AGENTS } from '../constants';
import { buildSystemPrompt, BA_DOCUMENT_TEMPLATE_INSTRUCTION } from '../services/promptEngine';
import { hybridSearch, extractKeyFacts, summarizeConversation } from '../services/contextManager';
import { runBaAgentLoop } from '../services/baAgentLoop';
import { marked } from 'marked';
import { parse as parsePartialJson } from 'partial-json';
import { useMessageStore } from '../store/useMessageStore';

const extractChatParts = (raw: string): { message: string; thinking?: string; questions?: any[]; actionSummary?: string } => {
  if (!raw) return { message: '' };
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return { message: raw };
  try {
    const parsed: any = parsePartialJson(trimmed);
    if (parsed && typeof parsed === 'object') {
      return {
        message: typeof parsed.message === 'string' ? parsed.message : '',
        thinking: typeof parsed.thinking === 'string' ? parsed.thinking : undefined,
        questions: Array.isArray(parsed.questions) ? parsed.questions : undefined,
        actionSummary: typeof parsed.actionSummary === 'string' ? parsed.actionSummary : undefined,
      };
    }
  } catch {}
  return { message: raw };
};

const processSection = (data: any, existing?: SectionData, parseMarkdown = true): SectionData => {
  let content = '';
  let status: 'DRAFT' | 'NEEDS_REVISION' | 'APPROVED' = existing?.status || 'DRAFT';
  let flags: string[] = existing?.flags || [];

  if (data && typeof data === 'object' && 'content' in data) {
    content = data.content || '';
    status = data.status || status;
    flags = data.flags || flags;
  } else {
    content = typeof data === 'string' ? data : JSON.stringify(data);
  }

  if (parseMarkdown && content) {
    content = marked.parse(content) as string;
  }

  return { content, status, flags };
};

export const useMessages = (channelRef: any) => {
  const {
    user,
    currentWorkspaceId,
    setShowNewItemModal,
    isZeroTouchMode,
    setIsGenerating,
    selectedModel
  } = useStore();

  const setMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    const id = currentWorkspaceId;
    if (!id) return;
    if (typeof updater === 'function') {
      useMessageStore.getState().setMessages(id, updater);
    } else {
      useMessageStore.getState().setMessages(id, () => updater);
    }
  };

  const getCurrentMessages = (): Message[] => {
    const id = currentWorkspaceId;
    if (!id) return [];
    return useMessageStore.getState().messagesByWorkspace[id] || [];
  };

  const handleSendMessage = async (text: string, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[], replyToId?: string) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!user) return;
    
    if (!currentWorkspaceId) {
      setShowNewItemModal(true);
      return;
    }

    const isZeroTouchModeActive = text.startsWith('/ekip') || isZeroTouchMode;
    const isSingleAgentMode = text.startsWith('@');
    
    let targetAgentRole = '';
    let targetAgentName = '';
    let messageText = text;

    if (isSingleAgentMode) {
      const match = text.match(/^@(\w+)\s+(.*)/);
      if (match) {
        const agentName = match[1];
        messageText = match[2];
        const agent = ZERO_TOUCH_AGENTS.find(a => a.name.toLowerCase() === agentName.toLowerCase());
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
    } else if (text.startsWith('/ekip')) {
      messageText = text.replace('/ekip', '').trim();
    }

    const msgId = Date.now().toString();
    const newMsg: Message = {
      id: msgId,
      role: 'user',
      text: messageText,
      senderName: user.name || 'Kullanıcı',
      senderRole: 'Kullanıcı',
      senderColor: user.color,
      createdAt: Date.now(),
      attachments: attachments?.map(a => ({ url: a.url, data: a.data, name: a.name, mimeType: a.mimeType })),
      replyToId
    };

    setMessages(prev => [...prev, newMsg]);

    try {
      const payload = camelToSnake<Record<string, any>>({ ...newMsg, ownerId: user.uid });
      payload.workspace_id = currentWorkspaceId;
      payload.created_at = nowIso();
      const { error } = await supabase.from('messages').upsert(payload);
      if (error) throw error;

      const { error: wsErr } = await supabase
        .from('workspaces')
        .update({ last_updated: nowIso() })
        .eq('id', currentWorkspaceId);
      if (wsErr) throw wsErr;
    } catch (err) {
      console.error("Failed to save user message to database:", err);
    }

    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'new_message', payload: { itemId: currentWorkspaceId, message: newMsg } });
    }

    if (isZeroTouchModeActive) {
      runZeroTouchMode(newMsg, attachments);
      return;
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
      const currentMessages = getCurrentMessages();
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

      const contents = [
        ...history,
        {
          role: 'user',
          parts: [
            { text: `[${user.name} - Kullanıcı]: ${messageText}` },
            ...(attachments?.map(a => ({
              inlineData: {
                data: a.data,
                mimeType: a.mimeType
              }
            })) || [])
          ]
        }
      ];

      if (documentContent) {
        const firstPart = contents[0].parts[0];
        if ('text' in firstPart) {
          firstPart.text = `Mevcut Doküman:\n${JSON.stringify(documentContent, null, 2)}\n\n` + firstPart.text;
        }
      }

      const loopOutput = await runBaAgentLoop({
        userMessage: messageText,
        history,
        documentContent,
        knowledgeBase,
        model: selectedModel,
        systemInstruction,
        onPhase: (phase, label) => {
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, phase, phaseLabel: label } : m));
          if (channelRef.current) {
            channelRef.current.send({
              type: 'broadcast',
              event: 'ai_stream_chunk',
              payload: {
                id: aiMsgId,
                phase,
                phaseLabel: label,
                senderName: targetAgentName || 'JetWork AI',
                senderRole: targetAgentName || 'Sistem Asistanı',
                agentRole: targetAgentRole || undefined
              }
            });
          }
        },
        onThinking: (thinkingText) => {
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, thinkingText } : m));
        },
        onActStream: (text, thinking, questions, actionSummary, tokenCount) => {
          setMessages(prev => prev.map(m => m.id === aiMsgId ? {
            ...m,
            text,
            thinkingText: thinking,
            questions,
            actionSummary,
            tokenCount
          } : m));
          if (channelRef.current) {
            channelRef.current.send({
              type: 'broadcast',
              event: 'ai_stream_chunk',
              payload: {
                id: aiMsgId,
                text,
                thinkingText: thinking,
                questions,
                actionSummary,
                senderName: targetAgentName || 'JetWork AI',
                senderRole: targetAgentName || 'Sistem Asistanı',
                agentRole: targetAgentRole || undefined
              }
            });
          }
        },
        onGrounding: (urls) => {
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, groundingUrls: urls } : m));
        }
      });

      const emptySection = { content: '', status: 'DRAFT' as const, flags: [] };
      const base = documentContent || {
        businessAnalysis: { ...emptySection },
        code: { ...emptySection },
        test: { ...emptySection },
      };
      const aiDoc = loopOutput.document;
      let finalDocument = documentContent;
      if (aiDoc) {
        const mergeSection = (existing: any, incoming: any) => {
          if (!incoming || !incoming.content || !incoming.content.trim()) return existing;
          return incoming;
        };
        finalDocument = {
          businessAnalysis: mergeSection(base.businessAnalysis, aiDoc.businessAnalysis) || base.businessAnalysis,
          code: mergeSection(base.code, aiDoc.code) || base.code,
          test: mergeSection(base.test, aiDoc.test) || base.test,
          ...(aiDoc.bpmn || base.bpmn ? { bpmn: mergeSection(base.bpmn, aiDoc.bpmn) } : {}),
          ...(aiDoc.review || base.review ? { review: mergeSection(base.review, aiDoc.review) } : {}),
        } as DocumentData;
      }
      let fullText = loopOutput.text;
      const finalThinking = loopOutput.thinking;
      const finalQuestions = loopOutput.questions;
      const finalActionSummary = loopOutput.actionSummary;

      if (finalDocument && finalDocument !== documentContent) {
        useStore.getState().setDocumentContent(finalDocument);
      }

      setMessages(prev => prev.map(m => m.id === aiMsgId ? {
        ...m,
        text: fullText,
        thinkingText: finalThinking,
        questions: finalQuestions,
        actionSummary: finalActionSummary,
        groundingUrls: loopOutput.groundingUrls,
        tokenCount: loopOutput.tokenCount,
        phase: null,
        phaseLabel: undefined,
        isTyping: false
      } : m));
      
      if (channelRef.current) {
        const finalMsg = getCurrentMessages().find(m => m.id === aiMsgId);
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
          
          const { phase: _p, phaseLabel: _pl, isTyping: _it, retryPayload: _rp, ...persistable } = finalMsg as any;
          const aiPayload = camelToSnake<Record<string, any>>(persistable);
          aiPayload.workspace_id = currentWorkspaceId;
          aiPayload.created_at = nowIso();
          const { error: aiErr } = await supabase.from('messages').upsert(aiPayload);
          if (aiErr) throw aiErr;

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
    
    const message = getCurrentMessages().find(m => m.id === messageId);
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
      const { error } = await supabase
        .from('messages')
        .update({ reactions: newReactions })
        .eq('id', messageId)
        .eq('workspace_id', currentWorkspaceId);
      if (error) throw error;
    } catch (error) {
      console.error("Error updating reaction:", error);
    }
  };

  const handleAcceptAiHandRaise = () => {
    const state = useStore.getState();
    if (state.aiHandRaised) {
      state.setAiHandRaised(null);
      state.setIsDiscussing(true);
      runZeroTouchMode({
        id: Date.now().toString(),
        role: 'user',
        text: 'Lütfen devam et.',
        senderName: 'Sistem',
        senderRole: 'Sistem',
        createdAt: Date.now()
      });
    }
  };

  const handleGenerateDocument = async () => {
    const state = useStore.getState();
    const messages = getCurrentMessages();
    if (messages.length === 0 || !currentWorkspaceId) return;
    useStore.getState().setIsGeneratingDocument(true);
    
    try {
      let historyText = "Sohbet Geçmişi:\n";
      messages.forEach(m => {
        historyText += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
      });

      const prompt = `${historyText}\n\nYukarıdaki konuşmalara dayanarak kapsamlı bir dokümantasyon oluştur.
      Lütfen aşağıdaki JSON formatında bir çıktı üret. Sadece geçerli bir JSON döndür, markdown kod bloğu kullanma:
      {
        "businessAnalysis": "TAM YAPILANDIRILMIŞ İş Analizi Dokümanı. Aşağıdaki şablona birebir uy: kapak sayfası, içindekiler, numaralı bölümler (1., 1.1., 1.1.1.), tablolar ve kullanıcı hikayeleri içermelidir. Markdown + izin verilen HTML div blokları.",
        "code": "Teknik mimari dokümanı. Numaralı başlıklar (## 1. Sistem Mimarisi, ## 2. Veritabanı Şeması, ## 3. API Endpoint'leri, ## 4. Entegrasyonlar) kullan. Tablolar ve kod blokları içermeli. Markdown formatında.",
        "test": "Test dokümanı. Numaralı başlıklar (## 1. Test Stratejisi, ## 2. Test Senaryoları, ## 3. Kabul Kriterleri) kullan. Test senaryoları için tablo: | TC-ID | Senaryo | Adımlar | Beklenen Sonuç |. Markdown formatında.",
        "review": "Proje değerlendirme dokümanı. Numaralı başlıklar ve risk/öneri tabloları içermeli. Markdown formatında.",
        "bpmn": "Geçerli bir BPMN 2.0 XML kodu. <bpmndi:BPMNDiagram> ve <bpmndi:BPMNPlane> görsel kısımları bulunmalı."
      }
      Tüm bölümler birbiriyle ilişkili ve tutarlı olmalıdır.

      ${BA_DOCUMENT_TEMPLATE_INSTRUCTION}`;

      let accumulatedJson = '';
      
      await callAiWithRetry(() => callGemini({
        model: "gemini-3-flash-preview",
        systemInstruction: "Sen bir yazılım mimarı ve iş analistisin. Verilen sohbet geçmişine dayanarak kapsamlı bir dokümantasyon oluşturuyorsun.",
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        onChunk: (text, thinking, tokens) => {
          accumulatedJson = text;
        }
      }));

      let jsonText = accumulatedJson.trim();
      
      // Try to extract JSON from markdown blocks if present
      const jsonBlockMatch = jsonText.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
      if (jsonBlockMatch) {
        jsonText = jsonBlockMatch[1].trim();
      } else {
        const firstBraceIndex = jsonText.indexOf('{');
        if (firstBraceIndex >= 0) {
          jsonText = jsonText.substring(firstBraceIndex).trim();
        }
      }
      
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.replace(/\n?```$/, '');
      }
      
      const data = JSON.parse(jsonText);
      
      // Convert Markdown to HTML for each section
      const htmlData: DocumentData = {
        businessAnalysis: processSection(data.businessAnalysis, undefined, true),
        code: processSection(data.code, undefined, true),
        test: processSection(data.test, undefined, true),
        review: processSection(data.review, undefined, true),
        bpmn: processSection(data.bpmn, undefined, false),
        score: data.score,
        scoreExplanation: data.scoreExplanation
      };
      
      state.setDocumentContent(htmlData);
      
      try {
        await supabase.from('workspaces').update({ last_updated: nowIso() }).eq('id', currentWorkspaceId);
        await saveDocumentAndVersion(currentWorkspaceId, `gen-${Date.now()}`, htmlData);
      } catch (err) {
        console.error("Failed to save generated document to database:", err);
      }
      
    } catch (error) {
      console.error('Error generating document:', error);
      // Fallback if JSON parsing fails
      const fallbackData: DocumentData = {
        businessAnalysis: { content: "Doküman oluşturulurken veya JSON ayrıştırılırken bir hata oluştu. Lütfen tekrar deneyin.", status: 'DRAFT', flags: [] },
        code: { content: "", status: 'DRAFT', flags: [] },
        test: { content: "", status: 'DRAFT', flags: [] },
        review: { content: "", status: 'DRAFT', flags: [] },
        bpmn: { content: "", status: 'DRAFT', flags: [] }
      };
      state.setDocumentContent(fallbackData);
    } finally {
      useStore.getState().setIsGeneratingDocument(false);
    }
  };

  return { handleSendMessage, handleToggleReaction, handleAcceptAiHandRaise, handleGenerateDocument };
};
