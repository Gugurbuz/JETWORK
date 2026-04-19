import { db, doc, setDoc, updateDoc, serverTimestamp } from '../db';
import { supabase } from '../supabase';
import { Message, DocumentData, Question, SectionData } from '../types';
import { SYSTEM_INSTRUCTION } from '../constants';
import { callGemini, callAiWithRetry } from '../services/aiService';
import { saveDocumentAndVersion, saveRawResponse, parseBusinessAnalysis } from '../utils/documentUtils';
import { agentTools, documentGenerationJsonSchema, chatResponseJsonSchema } from '../schemas';
import { marked } from 'marked';
import { parse as parsePartialJson } from 'partial-json';
import { User } from './useAuth';
import { useStore } from '../store/useStore';

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

  // If we should parse markdown, but it already looks like heavy HTML (e.g., from updated prompts),
  // we might want to skip marked to preserve pure Tiptap semantic HTML.
  const seemsLikeHtml = content.match(/<table|<h[1-6]>|<ul|<ol|<div|<p>/i);
  
  if (parseMarkdown && content && !seemsLikeHtml) {
    content = marked.parse(content) as string;
  }

  return { content, status, flags };
};

export function useAI(
  currentWorkspaceId: string | null,
  user: User | null,
  messages: Message[],
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void,
  channelRef: React.MutableRefObject<any>
) {
  const isGenerating = useStore(state => state.isGenerating);
  const setIsGenerating = useStore(state => state.setIsGenerating);
  const aiHandRaised = useStore(state => state.aiHandRaised);
  const setAiHandRaised = useStore(state => state.setAiHandRaised);
  const activeTab = useStore(state => state.activeTab);
  const setActiveTab = useStore(state => state.setActiveTab);
  const isAiActive = useStore(state => state.isAiActive);
  const documentContent = useStore(state => state.documentContent);
  const setDocumentContent = useStore(state => state.setDocumentContent);

  const handleSendMessage = async (text: string, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[]) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!user) return;
    
    if (!currentWorkspaceId) {
      // This case should be handled by the component
      return;
    }

    // Clear any pending AI hand raise when user sends a new message
    setAiHandRaised(null);

    const msgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    const newUserMessage: Message = { 
      id: msgId, 
      role: 'user', 
      text, 
      senderName: user.name,
      senderRole: user.role,
      createdAt: Date.now(),
      attachments: attachments?.map(a => ({ url: a.url, data: a.data, mimeType: a.mimeType, name: a.name })) 
    };
    
    // Optimistic update
    setMessages(prev => [...prev, newUserMessage]);

    // Save to database
    try {
      await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', msgId), {
        ...newUserMessage,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to save user message to database:", err);
    }

    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    // Generate AI response
    try {
      let isSpike = false;
      let isThinkMore = false;
      let isWebSearch = false;
      let isStory = false;
      let isTest = false;
      let isRead = false;
      let urlToRead = "";

      let cleanText = text.trim();
      
      if (cleanText.startsWith('/spike')) {
        isSpike = true;
      } else if (cleanText.startsWith('/thinkmore')) {
        isThinkMore = true;
      } else if (cleanText.startsWith('/websearch')) {
        isWebSearch = true;
      } else if (cleanText.startsWith('/story')) {
        isStory = true;
      } else if (cleanText.startsWith('/test')) {
        isTest = true;
      } else if (cleanText.startsWith('/read')) {
        isRead = true;
        const match = cleanText.match(/\/read\s+(https?:\/\/[^\s]+)/);
        if (match) {
          urlToRead = match[1];
        }
      }

      const isMentioned = text.includes("@JetWork") || isSpike || isThinkMore || isWebSearch || isStory || isTest || isRead;
      const shouldAiRespond = isAiActive || isMentioned;
      
      const previousDocumentSnapshot = documentContent ? { ...documentContent } : undefined;
      
      const contents: any[] = [];
      
      let prompt = "Sohbet Geçmişi:\n";
      const allMessages = [...messages, newUserMessage];
      allMessages.slice(-8).forEach(m => {
        prompt += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
      });
      
      if (shouldAiRespond) {
        prompt += "\nLütfen yukarıdaki son mesaja (sana sorulan soruya) öncelikli olarak cevap ver ve sohbete aktif olarak katıl.";
        
        if (isSpike) {
          prompt += "\n\nSen bir Yazılım Mimarı'sın. Bu konu için bir Proof of Concept (PoC) hazırla, alternatif teknolojileri kıyasla, avantaj/dezavantaj tablosu oluştur ve örnek bir entegrasyon kodu yaz.";
        } else if (isThinkMore) {
          prompt += "\n\nBu problemi adım adım, tüm uç durumları (edge-cases) ve olası riskleri hesaplayarak derinlemesine analiz et.";
        } else if (isStory) {
          prompt += "\n\nBu özellik için standart bir Agile formatında (As a... I want to... So that...) Kullanıcı Hikayesi (User Story) ve BDD formatında (Given-When-Then) Kabul Kriterleri (Acceptance Criteria) oluştur.";
        } else if (isTest) {
          prompt += "\n\nBu konu/özellik için kapsamlı test senaryoları (Birim, Entegrasyon, E2E) ve QA notları üret.";
        } else if (isRead && urlToRead) {
          prompt += `\n\nLütfen şu URL'yi oku ve analiz et: ${urlToRead}`;
        }
      } else {
        prompt += "\nLütfen yukarıdaki konuşmayı analiz et. Eğer bir iş gereksinimi, hata veya teknik karar tartışılıyorsa araya girip öneri sun. Eğer konuşma sadece günlük bir sohbetse veya senin araya girmene gerek yoksa SADECE 'NO_RESPONSE' yaz.";
      }

      if (documentContent) {
        prompt += "\n\n--- MEVCUT DOKÜMAN DURUMU ---\nAşağıda doküman sekmelerinin güncel durumu bulunmaktadır. Düzenleme yaparken bu HTML yapısını baz al ve sadece istenen bölümleri değiştirerek veya ekleyerek dokümanın TAMAMINI ŞEMA İCİNDE yeniden üret.\n";
        if (documentContent.businessAnalysis) prompt += `BA Analiz:\n${JSON.stringify(documentContent.businessAnalysis)}\n\n`;
        if (documentContent.code) prompt += `IT Analiz/Teknik Notlar:\n${JSON.stringify(documentContent.code)}\n\n`;
        if (documentContent.test) prompt += `Test Senaryoları:\n${JSON.stringify(documentContent.test)}\n\n`;
      }

      prompt += "\n[ÇOK ÖNEMLİ KISITLAMA]: Eğer BA Analiz Dokümanını (İş Analizi) güncelleyeceksen, ASLA Markdown KULLANMA. Yönetici Özeti (Executive Summary), As-Is, To-Be GİBİ BAŞLIKLAR KULLANMA. SADECE aşağidaki numaralandırılmış BAŞLIK YAPISINI kullan:\n1. ANALİZ KAPSAMI\n2. KISALTMALAR\n3. İŞ GEREKSİNİMLERİ\n   3.1. İş Kuralları\n   3.2. İş Modeli ve Kullanıcı Gereksinimleri\n4. FONKSİYONEL GEREKSİNİMLER (FR)\n   4.1. Fonksiyonel Gereksinim Maddeleri (CRM vb.)\n   4.2. Fonksiyonel Gereksinim Maddeleri (BILL vb.)\n5. FONKSİYONEL OLMAYAN GEREKSİNİMLER (NFR)\n   5.1. Güvenlik ve Yetkilendirme Gereksinimleri\n   5.2. Performans Gereksinimleri\n   5.3. Raporlama Gereksinimleri\n6. SÜREÇ RİSK ANALİZİ\n   6.1. Kısıtlar ve Varsayımlar\n   6.2. Bağlılıklar\n   6.3. Süreç Etkileri\n7. ONAY\n   7.1. İş Analizi (Tablo formatında)\n   7.2. Değişiklik Kayıtları (Tablo formatında)\n   7.3. Doküman Onay (Tablo formatında)\n   7.4. Referans Dokümanlar (Tablo formatında)\n8. FONKSİYONEL TASARIM DOKÜMANLARI\nBaşka hiçbir yapı kurma. Tabloları HTML table tagleriyle (<table>, <thead>, <tr>, <th>, <td>, <tbody>) eksiksiz çiz.";

      const parts: any[] = [{ text: prompt }];
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session");

      // Add temporary AI message with typing indicator only if it should respond directly
      if (shouldAiRespond) {
        const hasDoc = attachments?.some(a => !a.mimeType.startsWith('image/'));
        const tempAiMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: hasDoc ? '📄 Doküman yükleniyor ve analiz ediliyor. Bu işlem dosya boyutuna göre biraz zaman alabilir...' : '',
          senderName: 'JetWork AI',
          senderRole: 'Sistem Asistanı',
          createdAt: Date.now(),
          isTyping: true
        };
        
        setMessages(prev => [...prev, tempAiMessage]);
        if (channelRef.current) {
          channelRef.current.send({ type: 'broadcast', event: 'ai_stream_chunk', payload: { 
            itemId: currentWorkspaceId, 
            id: aiMsgId, 
            text: tempAiMessage.text, 
            senderName: 'JetWork AI',
            senderRole: 'Sistem Asistanı'
          }});
        }
      }

      let fullText = '';
      let fullThinkingText = '';
      let isNoResponse = false;
      let currentQuestions: Question[] | undefined = undefined;
      let groundingUrls: { uri: string; title: string }[] = [];
      let newDocumentContent: DocumentData | null = null;
      let lastUpdateTime = Date.now();

      let finalParsedData: any = null;
      const aiResponse = await callAiWithRetry(() => callGemini({
        model: "gemini-3-flash-preview",
        systemInstruction: SYSTEM_INSTRUCTION,
        contents: [
          { role: 'user', parts: [{ text: prompt }] }
        ],
        responseSchema: chatResponseJsonSchema,
        currentDocument: documentContent,
        onGrounding: (urls) => {
          groundingUrls = [...groundingUrls, ...urls.filter(u => !groundingUrls.find(gu => gu.uri === u.uri))];
        },
        onChunk: (text, thinking, tokens) => {
          let accumulatedJson = text;
          fullThinkingText = thinking || '';
          
          let jsonToParse = accumulatedJson.trim();
          const jsonBlockMatch = accumulatedJson.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
          if (jsonBlockMatch) {
            jsonToParse = jsonBlockMatch[1].trim();
          }
          
          let isParsedAsJson = false;
          if (jsonToParse && jsonToParse.startsWith('{')) {
            try {
              const parsed = parsePartialJson(jsonToParse);
              finalParsedData = parsed;
              if (parsed && typeof parsed === 'object') {
                if (parsed.message) {
                  fullText = parsed.message;
                  isParsedAsJson = true;
                }
                if (parsed.thinking && !fullThinkingText) fullThinkingText = parsed.thinking;
                if (parsed.questions && Array.isArray(parsed.questions)) {
                  currentQuestions = parsed.questions;
                }
                
                // If AI used the document property in JSON schema to update document
                if (parsed.document && typeof parsed.document === 'object') {
                  setDocumentContent((prev) => {
                    const newDoc = { ...prev } as DocumentData;
                    let hasChanges = false;
                    ['businessAnalysis', 'code', 'test', 'review', 'bpmn'].forEach((section) => {
                      if (parsed.document[section]) {
                        let newContent = parsed.document[section].content || '';
                        const currentSection = prev?.[section as keyof DocumentData] as SectionData | undefined;
                        
                        // Parse businessAnalysis markdown before saving if needed
                        const parsedContent = section === 'businessAnalysis' ? parseBusinessAnalysis(newContent) : newContent;
                        
                        if (parsedContent && parsedContent !== currentSection?.content) {
                          (newDoc as any)[section] = processSection(parsedContent, currentSection, section !== 'bpmn');
                          hasChanges = true;
                        }
                      }
                    });
                    
                    if (hasChanges) {
                      newDocumentContent = newDoc;
                      return newDoc;
                    }
                    return prev;
                  });
                }
              }
            } catch (e) {
              // Ignore partial parsing errors
            }
          }
          
          // Fallback to raw text if it wasn't a valid JSON structure
          if (!isParsedAsJson) {
            fullText = text.trim();
          }
          
          if (fullText.trim().startsWith("NO_RESPONSE")) {
            isNoResponse = true;
          }
          
          if (!isNoResponse) {
            if (shouldAiRespond) {
              if (Date.now() - lastUpdateTime > 30) {
                setMessages(prev => prev.map(m => 
                  m.id === aiMsgId ? { 
                    ...m, 
                    text: fullText, 
                    thinkingText: fullThinkingText,
                    questions: currentQuestions,
                    ...(groundingUrls.length > 0 ? { groundingUrls } : {})
                  } : m
                ));
                if (channelRef.current) {
                  channelRef.current.send({ type: 'broadcast', event: 'ai_stream_chunk', payload: { 
                    itemId: currentWorkspaceId, 
                    id: aiMsgId, 
                    text: fullText, 
                    thinkingText: fullThinkingText,
                    questions: currentQuestions,
                    groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
                  }});
                }
                lastUpdateTime = Date.now();
              }
            }
          }
        }
      }));

      if (isNoResponse || fullText.trim() === "NO_RESPONSE") {
        if (shouldAiRespond) {
          setMessages(prev => prev.filter(m => m.id !== aiMsgId));
        }
      } else {
        if (shouldAiRespond) {
          let documentActions: string[] | undefined = undefined;
          if (newDocumentContent) {
            documentActions = [];
            if (!previousDocumentSnapshot) {
              if (newDocumentContent.businessAnalysis) documentActions.push("BA Analiz oluşturuldu");
              if (newDocumentContent.code) documentActions.push("IT Analiz oluşturuldu");
              if (newDocumentContent.test) documentActions.push("Test senaryoları oluşturuldu");
              if (newDocumentContent.bpmn) documentActions.push("FLOW oluşturuldu");
            } else {
              if (newDocumentContent.businessAnalysis !== previousDocumentSnapshot.businessAnalysis) documentActions.push("BA Analiz güncellendi");
              if (newDocumentContent.code !== previousDocumentSnapshot.code) documentActions.push("IT Analiz güncellendi");
              if (newDocumentContent.test !== previousDocumentSnapshot.test) documentActions.push("Test senaryoları güncellendi");
              if (newDocumentContent.bpmn !== previousDocumentSnapshot.bpmn) documentActions.push("FLOW güncellendi");
            }
            if (documentActions.length === 0) {
              documentActions = undefined;
            }
          }

          const finalText = fullText || (aiResponse.functionCalls && aiResponse.functionCalls.length > 0 ? "Doküman güncellendi." : "");
          setMessages(prev => prev.map(m => 
            m.id === aiMsgId ? { 
              ...m, 
              text: finalText,
              isTyping: false,
              documentSnapshot: newDocumentContent || undefined,
              previousDocumentSnapshot,
              documentActions,
              questions: currentQuestions,
              tokenCount: aiResponse.tokenCount
            } : m
          ));
          
          // Save AI response to database
          try {
            await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
              id: aiMsgId,
              role: 'model',
              text: finalText,
              thinkingText: fullThinkingText,
              senderName: 'JetWork AI',
              senderRole: 'Sistem Asistanı',
              questions: currentQuestions,
              ...(groundingUrls.length > 0 ? { groundingUrls } : {}),
              documentSnapshot: newDocumentContent || undefined,
              previousDocumentSnapshot,
              documentActions,
              tokenCount: aiResponse.tokenCount,
              rawResponse: aiResponse.text,
              ownerId: user.uid,
              createdAt: serverTimestamp()
            });

            await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { lastUpdated: serverTimestamp() });
            await saveRawResponse(currentWorkspaceId, aiMsgId, aiResponse.text, finalParsedData);
            if (newDocumentContent && Object.keys(newDocumentContent).length > 0) {
              await saveDocumentAndVersion(currentWorkspaceId, aiMsgId, newDocumentContent);
            }
          } catch (err) {
            console.error("Failed to save AI message to database:", err);
          }

          // Send AI response via Supabase Realtime for other users
          if (channelRef.current) {
            channelRef.current.send({ type: 'broadcast', event: 'ai_stream_end', payload: {
              itemId: currentWorkspaceId,
              id: aiMsgId,
              text: finalText,
              thinkingText: fullThinkingText,
              senderName: 'JetWork AI',
              senderRole: 'Sistem Asistanı',
              questions: currentQuestions,
              groundingUrls: groundingUrls.length > 0 ? groundingUrls : null,
              documentSnapshot: newDocumentContent || null,
              previousDocumentSnapshot,
              documentActions
            }});
          }
        } else {
          // Passive mode: AI has something to say, raise hand
          setAiHandRaised(fullText);
        }
      }
    } catch (error: any) {
      console.error("AI Error:", error);
      const errorMsg = error?.message || String(error);
      const isQuotaError = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
      
      // Remove temporary message on error
      setMessages(prev => prev.filter(m => m.id !== aiMsgId));
      
      // Add error message
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: isQuotaError 
          ? "⚠️ **Kota Sınırı Aşıldı:** Gemini API kullanım sınırına ulaşıldı. Lütfen birkaç dakika bekleyip tekrar deneyin."
          : `❌ **Hata:** Bir sorun oluştu: ${error.message || 'Bilinmeyen hata'}`,
        senderName: 'Sistem',
        senderRole: 'Hata',
        createdAt: Date.now()
      }]);
    }
  };

  const handleAcceptAiHandRaise = async () => {
    if (!aiHandRaised || !currentWorkspaceId || !user) return;

    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    const finalMsg: Message = {
      id: aiMsgId,
      role: 'model',
      text: aiHandRaised,
      senderName: 'JetWork AI',
      senderRole: 'Sistem Asistanı',
      createdAt: Date.now()
    };

    setMessages(prev => [...prev, finalMsg]);
    setAiHandRaised(null);

    // Save to database
    try {
      await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
        ...finalMsg,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to save accepted AI message to database:", err);
    }

    // Send via Supabase Realtime
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'ai_stream_end', payload: {
        itemId: currentWorkspaceId,
        id: aiMsgId,
        text: aiHandRaised,
        senderName: 'JetWork AI',
        senderRole: 'Sistem Asistanı'
      }});
    }
  };

  const handleGenerateDocument = async () => {
    if (messages.length === 0 || !currentWorkspaceId) return;
    setIsGenerating(true);
    
    try {
      let historyText = "Sohbet Geçmişi:\n";
      messages.forEach(m => {
        historyText += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
      });

      const prompt = `${historyText}\n\n[GÖREV]
Yukarıdaki konuşmalara ve kullanıcının isteklerine dayanarak KAPSAMLI ve DERİNLEMESİNE bir analiz dokümanı oluştur. Özet geçme, kurumsal bir yazılım dökümanı standardında çok detaylı ol.

[İÇERİK STANDARTLARI VE FORMATLAMA]
- **businessAnalysis (İş Analizi)**: 
  - Yönetici özeti (Executive Summary).
  - Mevcut Durum (As-Is) ve Hedeflenen Durum (To-Be) analizleri.
  - Kullanıcı Hikayeleri (User Stories) ve gereksinim matrisi.
  - Kabul Kriterleri (Acceptance Criteria - Gherkin 'Given/When/Then' formatında veya detaylı maddelerle).
  - Verileri tablo biçiminde (Markdown tables) ve yapılandırılmış başlıklarla (\`##\`, \`###\`) sun.

- **code (Teknik Tasarım)**: 
  - Mimari kararlar ve sistem gereksinimleri.
  - Eğer veri tutulacaksa Veritabanı Tabloları (Kolonlar, Tipler, İlişkiler tablosu).
  - REST/GraphQL API Endpoint'leri (URL, HTTP Method, Örnek JSON Request/Response'ları \`\`\`json blokları içinde).
  - Güvenlik, yetkilendirme ve performans gereksinimleri.

- **test (QA / Test)**: 
  - TC-01, TC-02 formatında test case havuzu (Ön Koşul, Test Adımları, Beklenen Sonuç tablosu olarak).
  - Hata durumları (Edge Cases/Unhappy Paths) ve limitasyon testleri.

- **bpmn (Süreç Çizimi)**: 
  - Geçerli bir BPMN 2.0 XML kodu. İçerisinde kesinlikle <bpmndi:BPMNDiagram> ve <bpmndi:BPMNPlane> tag'leri ile görsel elemanlar tanımlanmış olmalıdır. XML'i code block içinde DEĞİL, doğrudan string olarak ver. Karar noktalarını (Gateway) ve aktörleri (Pool/Lane) içersin.

- **review (Değerlendirme Raporu)**: 
  - Alınan kararların, açık kalan soruların, olası risklerin ve sonraki adımların (Roadmap) üst düzey (C-Level) bir özeti.

Lütfen bölümleri yüzeysel bırakma. Çok detaylı, okunaklı, listeler ve tablolarla zenginleştirilmiş profesyonel bir Kurumsal Dokümantasyon (.md formatında) oluştur. SADECE BELİRTİLEN JSON ŞEMASINA UYGUN OBJEYİ DÖN.`;

      let accumulatedJson = '';
      
      await callAiWithRetry(() => callGemini({
        model: "gemini-3-flash-preview",
        systemInstruction: SYSTEM_INSTRUCTION,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        responseSchema: documentGenerationJsonSchema,
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
      
      setDocumentContent(htmlData);
      
      try {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { lastUpdated: serverTimestamp() });
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
      setDocumentContent(fallbackData);
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    isGenerating,
    aiHandRaised,
    setAiHandRaised,
    activeTab,
    setActiveTab,
    handleSendMessage,
    handleAcceptAiHandRaise,
    handleGenerateDocument
  };
}
