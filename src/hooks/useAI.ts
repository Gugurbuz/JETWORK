import { db, doc, setDoc, updateDoc, serverTimestamp } from '../db';
import { supabase } from '../supabase';
import { Message, DocumentData, Question } from '../types';
import { ZERO_TOUCH_AGENTS, SYSTEM_INSTRUCTION } from '../constants';
import { callGemini, callAiWithRetry } from '../services/aiService';
import { saveDocumentAndVersion, saveRawResponse, parseBusinessAnalysis } from '../utils/documentUtils';
import { chatResponseJsonSchema, discussionJsonSchema } from '../schemas';
import { marked } from 'marked';
import { parse as parsePartialJson } from 'partial-json';
import { User } from './useAuth';
import { useStore } from '../store/useStore';

export function useAI(
  currentWorkspaceId: string | null,
  user: User | null,
  messages: Message[],
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void,
  channelRef: React.MutableRefObject<any>
) {
  const isGenerating = useStore(state => state.isGenerating);
  const setIsGenerating = useStore(state => state.setIsGenerating);
  const isDiscussing = useStore(state => state.isDiscussing);
  const setIsDiscussing = useStore(state => state.setIsDiscussing);
  const aiHandRaised = useStore(state => state.aiHandRaised);
  const setAiHandRaised = useStore(state => state.setAiHandRaised);
  const activeTab = useStore(state => state.activeTab);
  const setActiveTab = useStore(state => state.setActiveTab);
  const isZeroTouchMode = useStore(state => state.isZeroTouchMode);
  const activeZeroTouchRoles = useStore(state => state.activeZeroTouchRoles);
  const isAiActive = useStore(state => state.isAiActive);
  const documentContent = useStore(state => state.documentContent);
  const setDocumentContent = useStore(state => state.setDocumentContent);

  const runZeroTouchMode = async (newUserMessage: Message, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[]) => {
    if (!currentWorkspaceId) return;

    setIsDiscussing(true);
    setIsGenerating(false);
    setActiveTab('Review');
    try {
      let currentMessages = [...messages, newUserMessage];
      let currentDocument = documentContent ? { ...documentContent } : null;

      // PHASE 1: Discussion
      let isDocumentationPhase = false;
      let needsUserInput = false;
      let turnCount = 0;
      const MAX_TURNS = 15;

      while (!isDocumentationPhase && !needsUserInput && turnCount < MAX_TURNS) {
        turnCount++;
        
        const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
        const startTime = Date.now();
        
        const tempAiMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: '',
          senderName: 'Ekip',
          senderRole: 'Tartışma',
          createdAt: Date.now(),
          isTyping: true
        };
        
        setMessages(prev => [...prev, tempAiMessage]);
        if (channelRef.current) {
          channelRef.current.send({ type: 'broadcast', event: 'ai_stream_chunk', payload: { 
            itemId: currentWorkspaceId, 
            id: aiMsgId, 
            text: '', 
            senderName: tempAiMessage.senderName,
            senderRole: tempAiMessage.senderRole
          }});
        }

        const contents: any[] = [];
        let prompt = "Sen bir toplantı odasındaki yapay zeka ajanlarını yöneten bir simülatörsün.\n";
        prompt += "Odada şu ajanlar var:\n";
        ZERO_TOUCH_AGENTS.filter(a => activeZeroTouchRoles.includes(a.role) || a.role === 'Orchestrator').forEach(a => {
          prompt += `- ${a.role} (${a.name})\n`;
        });
        
        prompt += "\nSohbet Geçmişi:\n";
        currentMessages.slice(-8).forEach(m => {
          prompt += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
        });

        if (currentDocument && currentDocument.review) {
          prompt += `\nŞu Ana Kadarki Toplantı Notları (Özet):\n${currentDocument.review}\n`;
        }

        const userName = user?.name || 'Kullanıcı';
        prompt += `\n\nÖNEMLİ NOT: Kullanıcının adı "${userName}". Eğer kullanıcıya hitap edecekseniz veya soru soracaksanız MUTLAKA @${userName} şeklinde etiketleyin. Eğer birden fazla soru soracaksanız, soruları metin içine gömmeyin, kesinlikle 1., 2., 3. şeklinde alt alta maddeler halinde (bullet points) yazın.`;

        prompt += "\n\nGörev: Sohbet geçmişine bakarak, sıradaki en mantıklı konuşmacı kim olmalıysa onun rolünü seç (agentRole) ve onun ağzından bir yanıt üret (message). Ayrıca bu yanıtın çok kısa bir özetini (actionSummary) oluştur (Örn: 'BA gereksinimleri sordu', 'QA test senaryosu çıkardı'). Eğer konu yeterince tartışıldıysa ve herkes hemfikirse, SM rolüyle 'isDocumentationPhase' değerini true yap. Konuşmalar sırayla olmak zorunda değil, bağlama göre en uygun ajanı seç.";
        
        prompt += "\n\nKRİTİK KURAL: Ajanlar kendi aralarında tartışarak en doğru kararı vermelidir. PO, BA, IT, QA kendi uzmanlık alanlarıyla ilgili kritik bir bilgiye ihtiyaç duyduklarında DOĞRUDAN KULLANICIYA SORU SORABİLİRLER. Bunun için `requiresUserInput` değerini true yapmalı ve `questions` dizisini DOLDURMALIDIRLAR. EĞER KULLANICIYA SORU SORUYORSANIZ VE 'questions' DİZİSİ BOŞSA SİSTEM ÇÖKER. Kullanıcıya soru sorulduğunda, kullanıcı cevap verene kadar BAŞKA HİÇBİR AJAN KONUŞMAMALIDIR. Kullanıcı cevapladıktan sonra tartışma devam eder. Eğer tüm sorular cevaplandıysa ve MVP üzerinde uzlaşıldıysa, SM rolüyle 'isDocumentationPhase' değerini true yapın.";
        
        prompt += "\n\nUYARI: Çıktı token sınırına (8192) takılmamak ve mesajın yarım kalmasını önlemek için düşünme (thinking) sürecini çok fazla uzatmayın. Doğrudan konuya ve tartışmaya odaklanın.";

        const parts: any[] = [{ text: prompt }];

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            if (att.data && att.mimeType) {
              parts.push({ inlineData: { data: att.data, mimeType: att.mimeType } });
            }
          }
        }

        contents.push({ role: 'user', parts });

        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error("No active session");

          let fullText = '';
          let fullThinkingText = '';
          let currentAgentRole = '';
          let currentAgentName = 'Ekip';
          let currentAgentTitle = 'Tartışma';
          let currentActionSummary = '';
          let currentQuestions: Question[] | undefined = undefined;
          let groundingUrls: { uri: string; title: string }[] = [];
          let lastUpdateTime = Date.now();
          let tokenCount = 0;

          let finalParsedData: any = null;
          const aiResponse = await callAiWithRetry(() => callGemini({
            model: "gemini-3-flash-preview",
            systemInstruction: "Sen bir toplantı simülatörüsün. Sadece JSON formatında yanıt ver.",
            contents: contents,
            responseSchema: discussionJsonSchema,
            onGrounding: (urls) => {
              groundingUrls = [...groundingUrls, ...urls.filter(u => !groundingUrls.find(gu => gu.uri === u.uri))];
            },
            onChunk: (text, thinking, tokens) => {
              let accumulatedJson = text;
              fullThinkingText = thinking || '';
              if (tokens) tokenCount = tokens;
              
              let jsonToParse = accumulatedJson.trim();
              const jsonBlockMatch = accumulatedJson.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
              if (jsonBlockMatch) {
                jsonToParse = jsonBlockMatch[1].trim();
              }
              
              if (jsonToParse) {
                try {
                  const parsed = parsePartialJson(jsonToParse);
                  finalParsedData = parsed;
                  if (parsed && typeof parsed === 'object') {
                    if (parsed.agentRole && !currentAgentRole) {
                      currentAgentRole = parsed.agentRole;
                      const agentDef = ZERO_TOUCH_AGENTS.find(a => a.role === currentAgentRole);
                      if (agentDef) {
                        currentAgentName = agentDef.name;
                        currentAgentTitle = agentDef.name;
                      }
                    }
                    if (parsed.message) fullText = parsed.message;
                    if (parsed.actionSummary) currentActionSummary = parsed.actionSummary;
                    if (parsed.isDocumentationPhase !== undefined) isDocumentationPhase = parsed.isDocumentationPhase;
                    if (parsed.requiresUserInput !== undefined) needsUserInput = parsed.requiresUserInput;
                    if (parsed.questions && Array.isArray(parsed.questions)) currentQuestions = parsed.questions;
                    
                    if (parsed.document && parsed.document.review) {
                      setDocumentContent(prev => {
                        const newDoc = { ...prev } as DocumentData;
                        newDoc.review = marked.parse(parsed.document.review) as string;
                        currentDocument = newDoc;
                        return newDoc;
                      });
                    }
                  } else {
                    fullText = jsonToParse;
                  }
                } catch (e) {
                  fullText = jsonToParse;
                }
              }

              if (Date.now() - lastUpdateTime > 30) {
                setMessages(prev => prev.map(m => 
                  m.id === aiMsgId ? { 
                    ...m, 
                    text: fullText, 
                    thinkingText: fullThinkingText,
                    senderName: currentAgentName,
                    senderRole: currentAgentTitle,
                    agentRole: currentAgentRole,
                    actionSummary: currentActionSummary,
                    questions: currentQuestions,
                    thinkingTime: Math.round((Date.now() - startTime) / 1000),
                    ...(groundingUrls.length > 0 ? { groundingUrls } : {})
                  } : m
                ));
                
                if (channelRef.current) {
                  channelRef.current.send({ type: 'broadcast', event: 'ai_stream_chunk', payload: { 
                    itemId: currentWorkspaceId, 
                    id: aiMsgId, 
                    text: fullText, 
                    thinkingText: fullThinkingText,
                    agentRole: currentAgentRole,
                    questions: currentQuestions,
                    thinkingTime: Math.round((Date.now() - startTime) / 1000),
                    groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
                  }});
                }
                lastUpdateTime = Date.now();
              }
            }
          }));

          const finalMsg: Message = {
            id: aiMsgId,
            role: 'model',
            text: fullText,
            thinkingText: fullThinkingText,
            senderName: currentAgentName,
            senderRole: currentAgentTitle,
            agentRole: currentAgentRole,
            actionSummary: currentActionSummary,
            documentSnapshot: currentDocument || undefined,
            questions: currentQuestions,
            tokenCount: aiResponse.tokenCount,
            thinkingTime: Math.round((Date.now() - startTime) / 1000),
            createdAt: Date.now(),
            rawResponse: aiResponse.text,
            ...(groundingUrls.length > 0 ? { groundingUrls } : {})
          };

          setMessages(prev => prev.map(m => m.id === aiMsgId ? finalMsg : m));
          currentMessages.push(finalMsg);

          try {
            await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
              ...finalMsg,
              ownerId: user?.uid,
              createdAt: serverTimestamp()
            });
            await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { lastUpdated: serverTimestamp() });
            await saveRawResponse(currentWorkspaceId, aiMsgId, aiResponse.text, finalParsedData);
            if (currentDocument && Object.keys(currentDocument).length > 0) {
              await saveDocumentAndVersion(currentWorkspaceId, aiMsgId, currentDocument);
            }
          } catch (err) {
            console.error("Failed to save zero-touch message to database:", err);
          }

          if (channelRef.current) {
            channelRef.current.send({ type: 'broadcast', event: 'ai_stream_end', payload: {
              itemId: currentWorkspaceId,
              id: aiMsgId,
              text: fullText,
              thinkingText: fullThinkingText,
              agentRole: currentAgentRole,
              senderName: currentAgentName,
              senderRole: currentAgentTitle,
              documentSnapshot: currentDocument || undefined,
              questions: currentQuestions,
              groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
            }});
          }

          if (needsUserInput) {
            break;
          }

        } catch (error: any) {
          console.error("Discussion Error:", error);
          const errorMsg = error?.message || String(error);
          const isQuotaError = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
          
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'model',
            text: isQuotaError 
              ? "⚠️ **Kota Sınırı Aşıldı:** Çok fazla istek gönderildi. Lütfen birkaç dakika bekleyip tekrar deneyin. (Hata: 429)"
              : `❌ **Tartışma Hatası:** Bir sorun oluştu. Lütfen tekrar deneyin.`,
            senderName: 'Sistem',
            senderRole: 'Hata',
            createdAt: Date.now()
          }]);
          break;
        }
      }

      // PHASE 2: Documentation
      if (!needsUserInput && (isDocumentationPhase || turnCount >= MAX_TURNS)) {
        setIsDiscussing(false);
        setIsGenerating(true);
        
        if (turnCount >= MAX_TURNS && !isDocumentationPhase) {
          const timeoutMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
          const timeoutMsg: Message = {
            id: timeoutMsgId,
            role: 'model',
            text: "⏱️ **Tartışma Süresi Doldu:** Ekip maksimum tartışma süresine ulaştı. Mevcut kararlar üzerinden dokümantasyon aşamasına geçiliyor.",
            senderName: 'Sistem',
            senderRole: 'Bilgi',
            createdAt: Date.now(),
            ownerId: user?.uid
          };
          setMessages(prev => [...prev, timeoutMsg]);
          currentMessages.push(timeoutMsg);
          
          try {
            await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', timeoutMsgId), {
              ...timeoutMsg,
              ownerId: user?.uid,
              createdAt: serverTimestamp()
            });
          } catch (err) {
            console.error("Failed to save timeout message to database:", err);
          }
        }

        let docNeedsRevision = true;
        let docLoopCount = 0;
        const MAX_DOC_LOOPS = 5; // Increased to allow more revisions until score >= 90
        let lastScore = 0;
        let agentsToRun = ['BA', 'IT', 'QA', 'UIUX', 'Orchestrator'].filter(r => activeZeroTouchRoles.includes(r) || r === 'Orchestrator');

        while (docNeedsRevision && docLoopCount < MAX_DOC_LOOPS) {
          docLoopCount++;
          docNeedsRevision = false; // Assume it's fine unless Orchestrator says otherwise
          let nextAgentsToRun: string[] = [];

          const docAgents = ZERO_TOUCH_AGENTS.filter(a => agentsToRun.includes(a.role));
          for (const agent of docAgents) {
            const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
            const startTime = Date.now();
        
        const tempAiMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: '',
          senderName: agent.name,
          senderRole: agent.name,
          agentRole: agent.role,
          createdAt: Date.now(),
          isTyping: true
        };
        
        setMessages(prev => [...prev, tempAiMessage]);
        if (channelRef.current) {
          channelRef.current.send({ type: 'broadcast', event: 'ai_stream_chunk', payload: { 
            itemId: currentWorkspaceId, 
            id: aiMsgId, 
            text: '', 
            agentRole: agent.role,
            senderName: agent.name,
            senderRole: agent.name
          }});
        }

        const userName = user?.name || 'Kullanıcı';
        let customPrompt = `Senin Rolün ve Görevin:\n${agent.instruction}\n\nÖNEMLİ NOT: Kullanıcının adı "${userName}". Eğer kullanıcıya hitap edeceksen veya soru soracaksan MUTLAKA @${userName} şeklinde etiketle. Eğer birden fazla soru soracaksan, soruları metin içine gömme, kesinlikle 1., 2., 3. şeklinde alt alta maddeler halinde (bullet points) yaz.\n\nLütfen yukarıdaki uzlaşılan çözüme göre kendi dokümantasyon alanını GÜNCELLE ve GENİŞLET. Mevcut dokümandaki bilgileri koru, eksikleri tamamla ve yeni kararları ekle. Dokümanı tamamen silip baştan yazma, üzerine ekleyerek ilerle. Kullanıcıya kısa bir bilgi mesajı ver (örn: "İş analizi dokümanı güncellendi.").`;
        customPrompt += `\n\nDİKKAT: Ürettiğin uzun metinleri, HTML/XML kodlarını ASLA 'message' alanına yazma. 'message' alanı sadece kullanıcıya vereceğin 1-2 cümlelik kısa bir bilgi mesajıdır. Tüm teknik veriyi, testleri ve kodları SADECE 'document' objesinin içindeki ilgili alanlara koy.`;
        customPrompt += `\n\nEN KRİTİK KURAL (DOKÜMAN EZİLMESİNİ ÖNLEMEK İÇİN): JSON çıktısı üretirken 'document' objesi içine SADECE kendi rolünle ilgili alanı ekle. Diğer ajanların alanlarını KESİNLİKLE JSON'a dahil etme (null bile gönderme, o key'i hiç yazma). Örneğin BA isen sadece 'businessAnalysis' alanını gönder, 'code' veya 'test' alanlarını JSON'a koyma! UI/UX isen 'businessAnalysis' ve 'code' alanlarına kendi notlarını ekleyebilirsin. Böylece diğer ajanların yazdıkları silinmez.`;
        customPrompt += `\n\nEk olarak, 'actionSummary' alanına yaptığın işlemi anlatan çok kısa bir özet yaz (Örn: 'İş Analisti gereksinimleri dokümana ekledi.', 'Test Uzmanı test senaryolarını yazdı.').`;
        customPrompt += `\n\nKRİTİK UYARI: Dokümanı ASLA özet geçme. Üreteceğin metin son derece detaylı olmalı; örnek veri yapıları (JSON payload'lar), tablolar, durum kodları (status codes) ve tüm uç senaryoları (edge-cases) adım adım içermelidir. Kurumsal bir doküman standardında olabildiğince uzun ve derinlemesine yaz.`;
        
        // ROLE ÖZEL ZORUNLU DOKÜMAN ŞABLONLARI İNJEKSİYONU
        let roleTemplate = "";
        if (agent.role === 'BA') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU (ASLA ÖZET GEÇME):
DİKKAT: İş analizi dokümanını JSON formatında, 'businessAnalysis' objesi içindeki tüm alanları (1_ANALIZ_KAPSAMI, 2_KISALTMALAR vb.) eksiksiz ve detaylı bir şekilde doldurarak oluştur. Her bir alanın içeriği Markdown formatında olabilir, ancak genel yapı JSON şemasına kesinlikle uymalıdır.`;
        } else if (agent.role === 'IT') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU (ASLA ÖZET GEÇME, AŞAĞIDAKİ BAŞLIKLARI KOD BLOKLARIYLA DETAYLANDIR):
1. Mimari Genel Bakış (C4 Model Mantığı)
2. Teknik Bileşenler ve Entegrasyon (Protokoller, Authentication, Güvenlik)
3. API Kontratları (ZORUNLU: Endpoint URL, HTTP Method, Request JSON Payload örneği, Response JSON Payload örneği, HTTP Status Kodları)
4. Veri Modeli ve Veritabanı Şeması (Tablo adları, kolonlar, tipler)
5. Hata Yönetimi, Retry Mekanizmaları ve Performans Riskleri`;
        } else if (agent.role === 'QA') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU (ASLA ÖZET GEÇME, AŞAĞIDAKİ BAŞLIKLARI DETAYLICA DOLDUR):
1. Master Test Stratejisi ve Yaklaşımı
2. Kritik Test Senaryoları ve Edge Case'ler (TC-01, TC-02 formatında)
3. Hata Yönetimi ve Dayanıklılık Testleri (Circuit Breaker, Yük Testi senaryoları)
4. Güvenlik, Veri Gizliliği (PII Masking) ve KVKK Testleri
5. Test Verisi İhtiyacı ve Temizlik (Clean-up) Stratejisi`;
        } else if (agent.role === 'UIUX') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU (ASLA ÖZET GEÇME):
DİKKAT: Ayrı bir UI/UX dokümanı oluşturma! Tasarım notlarını mevcut BA Analiz (businessAnalysis) ve IT Analiz (code) dokümanlarına entegre et.
BA Analiz (businessAnalysis) içine eklenecekler:
- Kullanıcı Yolculuğu (User Journey) ve Temel Akışlar
- Ekran ve Bileşen İhtiyaçları (Wireframe açıklamaları)

IT Analiz (code) içine eklenecekler:
- Etkileşim Tasarımı (Durumlar: Hover, Active, Disabled, Loading)
- Erişilebilirlik (Accessibility) ve Renk Kontrastı Notları
- Hata Mesajları ve Boş Durum (Empty State) Tasarımları`;
        } else if (agent.role === 'Orchestrator') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU:
1. Toplantı ve Karar Özeti
2. Kritik Karar Matrisi (Tablo: Konu, Alınan Karar, Neden/Fayda)
3. Risk ve Aksiyon Planı (Kimin ne yapacağı)`;
        }

        customPrompt += roleTemplate;
        
        if (agent.role !== 'IT' && agent.role !== 'Orchestrator') {
          customPrompt += `\nDİKKAT: BPMN diyagramını SADECE IT veya Moderatör üretebilir. Sen 'bpmn' alanını boş bırak.`;
        }

        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (!session) throw new Error("No active session");

          const contents: any[] = [{ role: 'user', parts: [{ text: customPrompt }] }];
          if (attachments && attachments.length > 0) {
            for (const att of attachments) {
              if (att.data) {
                contents[0].parts.push({
                  inlineData: {
                    data: att.data.split(',')[1] || att.data,
                    mimeType: att.mimeType
                  }
                });
              }
            }
          }

          let fullText = '';
          let fullThinkingText = '';
          let currentActionSummary = '';
          let finalScore: number | undefined = undefined;
          let finalScoreExplanation: string | undefined = undefined;
          let currentQuestions: Question[] | undefined = undefined;
          let tokenCount = 0;
          let groundingUrls: { uri: string; title: string }[] = [];
          let lastUpdateTime = Date.now();

          let finalParsedData: any = null;
          const aiResponse = await callAiWithRetry(() => callGemini({
            model: "gemini-3-flash-preview",
            systemInstruction: SYSTEM_INSTRUCTION,
            contents: contents,
            responseSchema: chatResponseJsonSchema,
            onGrounding: (urls) => {
              groundingUrls = [...groundingUrls, ...urls.filter(u => !groundingUrls.find(gu => gu.uri === u.uri))];
            },
            onChunk: (text, thinking, tokens) => {
              let accumulatedJson = text;
              fullThinkingText = thinking || '';
              if (tokens) tokenCount = tokens;
              
              let jsonToParse = accumulatedJson.trim();
              const jsonBlockMatch = accumulatedJson.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
              if (jsonBlockMatch) {
                jsonToParse = jsonBlockMatch[1].trim();
              }
              
              if (jsonToParse) {
                try {
                  const parsed = parsePartialJson(jsonToParse);
                  finalParsedData = parsed;
                  if (parsed && typeof parsed === 'object') {
                    if (parsed.message) fullText = parsed.message;
                    if (parsed.actionSummary) currentActionSummary = parsed.actionSummary;
                    if (parsed.score !== undefined) {
                      finalScore = parsed.score;
                      lastScore = parsed.score;
                    }
                    if (parsed.scoreExplanation) finalScoreExplanation = parsed.scoreExplanation;
                    if (parsed.questions && Array.isArray(parsed.questions)) currentQuestions = parsed.questions;
                    
                    if (agent.role === 'Orchestrator') {
                      if (parsed.needsRevision !== undefined) {
                        if (Array.isArray(parsed.needsRevision) && parsed.needsRevision.length > 0) {
                          docNeedsRevision = true;
                          nextAgentsToRun = parsed.needsRevision;
                        } else if (parsed.needsRevision === true) {
                          docNeedsRevision = true;
                          nextAgentsToRun = ['BA', 'IT', 'QA'];
                        }
                      }
                      
                      // Force revision if score < 90 and it's the Orchestrator
                      if (finalScore !== undefined && finalScore < 90) {
                        docNeedsRevision = true;
                        if (nextAgentsToRun.length === 0) {
                          nextAgentsToRun = ['BA', 'IT', 'QA'];
                        }
                      }
                    }

                    if (parsed.document) {
                      const docFields = ['businessAnalysis', 'code', 'test', 'review', 'bpmn'];
                      const hasFields = docFields.some(field => parsed.document[field]) || finalScore !== undefined || finalScoreExplanation !== undefined;
                      
                      if (hasFields) {
                        setDocumentContent(prev => {
                          const newDoc = { ...prev } as DocumentData;
                          if (parsed.document.businessAnalysis) newDoc.businessAnalysis = marked.parse(parseBusinessAnalysis(parsed.document.businessAnalysis)) as string;
                          if (parsed.document.code) newDoc.code = marked.parse(parsed.document.code) as string;
                          if (parsed.document.test) newDoc.test = marked.parse(parsed.document.test) as string;
                          if (parsed.document.review) newDoc.review = marked.parse(parsed.document.review) as string;
                          if (parsed.document.bpmn) {
                            let bpmnStr = parsed.document.bpmn.trim();
                            const bpmnMatch = bpmnStr.match(/```(?:xml|bpmn)?\s*([\s\S]*?)(```|$)/i);
                            if (bpmnMatch) {
                              bpmnStr = bpmnMatch[1].trim();
                            }
                            // Fallback: extract from <?xml or <bpmn:definitions
                            const xmlStart = bpmnStr.indexOf('<?xml');
                            const defStart = bpmnStr.indexOf('<bpmn:definitions');
                            if (xmlStart !== -1) {
                              bpmnStr = bpmnStr.substring(xmlStart);
                            } else if (defStart !== -1) {
                              bpmnStr = bpmnStr.substring(defStart);
                            }
                            newDoc.bpmn = bpmnStr;
                          }
                          if (finalScore !== undefined) newDoc.score = finalScore;
                          if (finalScoreExplanation) newDoc.scoreExplanation = finalScoreExplanation;
                          currentDocument = newDoc;
                          return newDoc;
                        });
                      }
                    }
                  } else {
                    fullText = jsonToParse;
                  }
                } catch (e) {
                  fullText = jsonToParse;
                }
              }
              
              if (Date.now() - lastUpdateTime > 30) {
                setMessages(prev => prev.map(m => 
                  m.id === aiMsgId ? { 
                    ...m, 
                    text: fullText, 
                    thinkingText: fullThinkingText,
                    actionSummary: currentActionSummary,
                    score: finalScore,
                    scoreExplanation: finalScoreExplanation,
                    questions: currentQuestions,
                    tokenCount: tokenCount,
                    thinkingTime: Math.round((Date.now() - startTime) / 1000),
                    ...(groundingUrls.length > 0 ? { groundingUrls } : {})
                  } : m
                ));
                
                if (channelRef.current) {
                  channelRef.current.send({ type: 'broadcast', event: 'ai_stream_chunk', payload: { 
                    itemId: currentWorkspaceId, 
                    id: aiMsgId, 
                    text: fullText, 
                    thinkingText: fullThinkingText,
                    agentRole: agent.role,
                    score: finalScore,
                    scoreExplanation: finalScoreExplanation,
                    questions: currentQuestions,
                    tokenCount: tokenCount,
                    thinkingTime: Math.round((Date.now() - startTime) / 1000),
                    groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
                  }});
                }
                lastUpdateTime = Date.now();
              }
            }
          }));

          const finalMsg: Message = {
            id: aiMsgId,
            role: 'model',
            text: fullText,
            thinkingText: fullThinkingText,
            senderName: agent.name,
            senderRole: agent.name,
            agentRole: agent.role,
            actionSummary: currentActionSummary,
            score: finalScore,
            scoreExplanation: finalScoreExplanation,
            questions: currentQuestions,
            tokenCount: tokenCount,
            thinkingTime: Math.round((Date.now() - startTime) / 1000),
            createdAt: Date.now(),
            rawResponse: aiResponse.text,
            ...(groundingUrls.length > 0 ? { groundingUrls } : {})
          };

          setMessages(prev => prev.map(m => m.id === aiMsgId ? finalMsg : m));
          currentMessages.push(finalMsg);

          try {
            await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
              ...finalMsg,
              ownerId: user?.uid,
              createdAt: serverTimestamp()
            });
            await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { lastUpdated: serverTimestamp() });
            await saveRawResponse(currentWorkspaceId, aiMsgId, aiResponse.text, finalParsedData);
            if (currentDocument && Object.keys(currentDocument).length > 0) {
              await saveDocumentAndVersion(currentWorkspaceId, aiMsgId, currentDocument);
            }
          } catch (err) {
            console.error("Failed to save AI message to database:", err);
          }

          if (channelRef.current) {
            channelRef.current.send({ type: 'broadcast', event: 'ai_stream_end', payload: {
              itemId: currentWorkspaceId,
              id: aiMsgId,
              text: fullText,
              thinkingText: fullThinkingText,
              agentRole: agent.role,
              senderName: agent.name,
              senderRole: agent.name,
              score: finalScore,
              scoreExplanation: finalScoreExplanation,
              questions: currentQuestions,
              documentSnapshot: currentDocument || null,
              groundingUrls: groundingUrls.length > 0 ? groundingUrls : null
            }});
          }

        } catch (error: any) {
          console.error(`AI Error for agent ${agent.role}:`, error);
          const errorMsg = error?.message || String(error);
          const isQuotaError = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
          
          setMessages(prev => prev.map(m => 
            m.id === aiMsgId ? { 
              ...m, 
              text: isQuotaError 
                ? "⚠️ **Kota Sınırı Aşıldı:** İşlem durduruldu. Lütfen biraz bekleyip tekrar deneyin." 
                : "❌ Bir hata oluştu.",
              isTyping: false 
            } : m
          ));
          docNeedsRevision = false; // Stop the while loop on error
          break;
        }
      }
          
          if (docNeedsRevision) {
            if (!nextAgentsToRun.includes('Orchestrator')) {
              nextAgentsToRun.push('Orchestrator');
            }
            agentsToRun = nextAgentsToRun;
          }
        }
      }
    } finally {
      setIsGenerating(false);
      setIsDiscussing(false);
    }
  };

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

    if (isZeroTouchMode) {
      runZeroTouchMode(newUserMessage, attachments);
      return;
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
        prompt += "\n\n--- MEVCUT DOKÜMAN DURUMU ---\n";
        if (documentContent.businessAnalysis) prompt += `BA Analiz:\n${documentContent.businessAnalysis}\n\n`;
        if (documentContent.code) prompt += `IT Analiz/Teknik Notlar:\n${documentContent.code}\n\n`;
        if (documentContent.test) prompt += `Test Senaryoları:\n${documentContent.test}\n\n`;
        prompt += "Lütfen yanıt verirken bu mevcut doküman durumunu göz önünde bulundur ve gerekirse dokümana ekleme/çıkarma yapmayı teklif et.\n";
      }

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
        onGrounding: (urls) => {
          groundingUrls = [...groundingUrls, ...urls.filter(u => !groundingUrls.find(gu => gu.uri === u.uri))];
        },
        onChunk: (text, thinking) => {
          let accumulatedJson = text;
          fullThinkingText = thinking || '';
          
          let jsonToParse = accumulatedJson.trim();
          const jsonBlockMatch = accumulatedJson.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
          if (jsonBlockMatch) {
            jsonToParse = jsonBlockMatch[1].trim();
          }
          
          if (jsonToParse) {
            try {
              const parsed = parsePartialJson(jsonToParse);
              finalParsedData = parsed;
              if (parsed && typeof parsed === 'object' && parsed.message) {
                fullText = parsed.message;
                if (parsed.questions && Array.isArray(parsed.questions)) {
                  currentQuestions = parsed.questions;
                }
              } else {
                fullText = jsonToParse;
              }
              if (parsed && typeof parsed === 'object' && parsed.document) {
                const docFields = ['businessAnalysis', 'code', 'test', 'review', 'bpmn'];
                const hasFields = docFields.some(field => parsed.document[field]);
                
                if (shouldAiRespond && hasFields) {
                  setDocumentContent(prev => {
                    const newDoc = { ...prev } as DocumentData;
                    if (parsed.document.businessAnalysis) newDoc.businessAnalysis = marked.parse(parseBusinessAnalysis(parsed.document.businessAnalysis)) as string;
                    if (parsed.document.code) newDoc.code = marked.parse(parsed.document.code) as string;
                    if (parsed.document.test) newDoc.test = marked.parse(parsed.document.test) as string;
                    if (parsed.document.review) newDoc.review = marked.parse(parsed.document.review) as string;
                    if (parsed.document.bpmn) {
                      let bpmnStr = parsed.document.bpmn.trim();
                      const bpmnMatch = bpmnStr.match(/```(?:xml|bpmn)?\s*([\s\S]*?)(```|$)/i);
                      if (bpmnMatch) {
                        bpmnStr = bpmnMatch[1].trim();
                      }
                      // Fallback: extract from <?xml or <bpmn:definitions
                      const xmlStart = bpmnStr.indexOf('<?xml');
                      const defStart = bpmnStr.indexOf('<bpmn:definitions');
                      if (xmlStart !== -1) {
                        bpmnStr = bpmnStr.substring(xmlStart);
                      } else if (defStart !== -1) {
                        bpmnStr = bpmnStr.substring(defStart);
                      }
                      newDoc.bpmn = bpmnStr;
                    }
                    newDocumentContent = newDoc;
                    return newDoc;
                  });
                }
              }
            } catch (e) {
              // Ignore partial parsing errors, but fallback to raw text
              fullText = jsonToParse;
            }
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

          setMessages(prev => prev.map(m => 
            m.id === aiMsgId ? { 
              ...m, 
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
              text: fullText,
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
              text: fullText,
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

      const prompt = `${historyText}\n\nYukarıdaki konuşmalara dayanarak kapsamlı bir dokümantasyon oluştur.
      Lütfen aşağıdaki JSON formatında bir çıktı üret. Sadece geçerli bir JSON döndür, markdown kod bloğu kullanma:
      {
        "businessAnalysis": "İş analizi dokümanı (Talep özeti, mevcut durum, hedeflenen durum, kullanıcı hikayeleri, kabul kriterleri, vb.) Markdown formatında. Eğer özel bir format (örn: Enerjisa) istendiyse, o formatı Markdown olarak buraya yaz.",
        "code": "Geliştirme için teknik notlar, mimari kararlar, veritabanı şemaları, API tasarımları ve örnek kod blokları. Markdown formatında.",
        "test": "Test senaryoları, birim testleri, entegrasyon testleri ve QA notları. Markdown formatında.",
        "bpmn": "Geçerli bir BPMN 2.0 XML kodu. Eğer süreç bir akış veya entegrasyon içeriyorsa mutlaka doldur. DİKKAT: XML kodu mutlaka <bpmndi:BPMNDiagram> ve <bpmndi:BPMNPlane> etiketlerini içeren görsel (DI) kısımlarını da barındırmalıdır. Aksi takdirde ekranda çizilemez."
      }
      Tüm bölümler birbiriyle ilişkili ve tutarlı olmalıdır.`;

      let accumulatedJson = '';
      
      await callAiWithRetry(() => callGemini({
        model: "gemini-3-flash-preview",
        systemInstruction: SYSTEM_INSTRUCTION,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        responseSchema: chatResponseJsonSchema,
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
        businessAnalysis: marked.parse(data.businessAnalysis || "") as string,
        code: marked.parse(data.code || "") as string,
        test: marked.parse(data.test || "") as string,
        review: data.review ? marked.parse(data.review) as string : null,
        bpmn: data.bpmn || "",
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
        businessAnalysis: "Doküman oluşturulurken veya JSON ayrıştırılırken bir hata oluştu. Lütfen tekrar deneyin.",
        code: "",
        test: "",
        review: ""
      };
      setDocumentContent(fallbackData);
    } finally {
      setIsGenerating(false);
    }
  };

  return {
    isGenerating,
    isDiscussing,
    aiHandRaised,
    setAiHandRaised,
    activeTab,
    setActiveTab,
    handleSendMessage,
    handleAcceptAiHandRaise,
    handleGenerateDocument
  };
}
