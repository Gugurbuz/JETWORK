import { useStore } from '../store/useStore';
import { supabase } from '../supabase';
import { Message, DocumentData } from '../types';
import { camelToSnake, nowIso } from '../lib/mapping';
import { runZeroTouchMode } from '../services/agentRunner';
import { saveDocumentAndVersion } from '../utils/documentUtils';
import { ZERO_TOUCH_AGENTS } from '../constants';
import { buildSystemPrompt } from '../services/promptEngine';
import { hybridSearch, extractKeyFacts, summarizeConversation } from '../services/contextManager';
import { runSingleChatOrchestrator } from '../services/singleChatOrchestrator';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { parse as parsePartialJson } from 'partial-json';
import { useMessageStore } from '../store/useMessageStore';
import { buildActionIntentContext, detectAiActionIntent } from '../modules/ai-actions/actionIntentRouter';
import type { AnalysisInputAttachment } from '../modules/conceptual-design/conceptualDesignTypes';
import { postProcessDocumentData } from '../services/documentPostProcessor';
import {
  buildProjectMemoryContext,
  extractProjectMemoryUpdates,
  mergeProjectMemory,
} from '../services/ai/projectMemoryEngine';

const stripCodeFences = (raw: string): string => {
  let t = raw.trim();
  const fenceMatch = t.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) t = fenceMatch[1].trim();
  return t;
};

const extractChatParts = (raw: string): { message: string; thinking?: string; questions?: any[]; actionSummary?: string } => {
  if (!raw) return { message: '' };
  const trimmed = stripCodeFences(raw);
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
  return { message: '' };
};

const sanitizeDisplayText = (text: string): { text: string; questions?: any[]; actionSummary?: string } => {
  if (!text) return { text: '' };
  const trimmed = stripCodeFences(text);
  if (!trimmed.startsWith('{')) return { text };
  const parts = extractChatParts(trimmed);
  return {
    text: parts.message || '',
    questions: parts.questions,
    actionSummary: parts.actionSummary,
  };
};

const toAnalysisAttachments = (
  attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[],
): AnalysisInputAttachment[] => (attachments || []).map(attachment => ({
  name: attachment.name,
  mimeType: attachment.mimeType,
  data: attachment.data,
}));

const hasDocumentIntent = (text: string): boolean => /dok[üu]man|kavramsal tasar[ıi]m|iş analizi|is analizi|gereksinim|bpmn|ak[ıi]ş|toast|validasyon|modal|rapor/i.test(text);

const ensureDocumentActionSummary = (
  text: string,
  options: {
    changedSections: string[];
    score?: number;
    scoreExplanation?: string;
    document?: DocumentData | null;
  },
): string => {
  const current = text?.trim() || '';
  if (/ne yapt[Ä±i]m|ne yaptim/i.test(current)) return current;
  const changed = options.changedSections.length
    ? options.changedSections.join(', ')
    : 'Dokuman icerigi';
  const flags = Array.from(new Set([
    ...(options.document?.businessAnalysis?.flags || []),
    ...(options.document?.review?.flags || []),
  ]));
  const controls = [
    flags.includes('SOURCE_FIDELITY_REPAIRED') ? 'Kaynak uyum onarimi eklendi' : '',
    flags.includes('SOURCE_FIDELITY_REPAIR_REQUIRED') ? 'Kaynak yansitma kontrolu Review tarafinda isaretlendi' : '',
    flags.includes('OFFICIAL_SOURCE_VERIFICATION_REQUIRED') ? 'Resmi kaynak dogrulama guard devrede' : '',
    flags.includes('TRACEABILITY_REPAIRED') ? 'REQ-BR-AC-TC izlenebilirlik matrisi eklendi' : '',
    flags.includes('TRACEABILITY_REPAIR_REQUIRED') ? 'Kabul kriteri ve test baglantisi Review tarafinda isaretlendi' : '',
    flags.includes('ANALYSIS_COVERAGE_REPAIRED') ? 'Analysis coverage matrisi eklendi' : '',
    flags.includes('ANALYSIS_COVERAGE_REPAIR_REQUIRED') ? 'Aktor/akis/istisna/veri/NFR kapsami Review tarafinda isaretlendi' : '',
    flags.includes('CONCEPTUAL_TEMPLATE_APPLIED') ? 'Word kavramsal tasarim sablonu uygulandi' : '',
    flags.includes('CONCEPTUAL_TEMPLATE_COMPLETED') ? 'Süreç ve ek bölümler şablona göre tamamlandı' : '',
    flags.includes('SOURCE_ANCHORED_TEMPLATE_REBUILT') ? 'Dokuman kaynak talebe gore yeniden kuruldu' : '',
    flags.includes('COPILOT_RUNTIME_STATE') ? 'Runtime state machine, tool honesty ve completion evidence Review tarafinda izlendi' : '',
    flags.includes('WORD_TEMPLATE_CONFORMANCE_GUARD') ? 'Word şablon uyum kontrolü Review tarafında izlendi' : '',
  ].filter(Boolean);
  const guardQuickActions = [
    flags.includes('ANALYSIS_COVERAGE_REPAIR_REQUIRED') ? 'Coverage matrisini tamamla' : '',
    flags.includes('ANALYSIS_COVERAGE_REPAIR_REQUIRED') ? 'Istisna ve negatif akislari detaylandir' : '',
    flags.includes('TRACEABILITY_REPAIR_REQUIRED') ? 'Traceability matrisini tamamla' : '',
    flags.includes('TRACEABILITY_REPAIR_REQUIRED') ? 'Kabul kriterlerini testlere bagla' : '',
    flags.includes('SOURCE_FIDELITY_REPAIR_REQUIRED') ? 'Kaynak talep izlerini dokumana isle' : '',
    flags.includes('OFFICIAL_SOURCE_VERIFICATION_REQUIRED') ? 'Resmi kaynaklarla dogrula' : '',
    flags.includes('COPILOT_RUNTIME_STATE') ? 'Runtime karar izini incele' : '',
    flags.includes('WORD_TEMPLATE_REVIEW_REQUIRED') ? 'Şablon uyumunu tamamla' : '',
  ].filter(Boolean);
  const quickActions = Array.from(new Set([
    ...guardQuickActions,
    ...(options.document?.suggestions || []),
  ])).slice(0, 4);
  const quality = typeof options.score === 'number'
    ? `Kalite puani: ${options.score}/100.`
    : '';
  const reason = options.scoreExplanation
    ? `Puan nedeni: ${options.scoreExplanation}`
    : '';
  return [
    current,
    '',
    '**Ne yaptim?**',
    `- Sag panelde guncellenen alanlar: ${changed}.`,
    controls.length ? `- Calisan kontroller: ${controls.join('; ')}.` : '',
    quality ? `- ${quality}` : '',
    reason ? `- ${reason}` : '',
    quickActions.length ? `- Hizli aksiyonlar: ${quickActions.join('; ')}.` : '',
  ].filter(Boolean).join('\n');
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

  const persistAiMessage = async (message: Message) => {
    if (!currentWorkspaceId) return;
    const { phase: _p, phaseLabel: _pl, isTyping: _it, retryPayload: _rp, ...persistable } = message as any;
    const aiPayload = camelToSnake<Record<string, any>>(persistable);
    aiPayload.workspace_id = currentWorkspaceId;
    aiPayload.created_at = nowIso();
    const { error: aiErr } = await supabase.from('messages').upsert(aiPayload);
    if (aiErr) throw aiErr;
  };

  const handleSendMessage = async (text: string, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[], replyToId?: string) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!user) return;
    
    if (!currentWorkspaceId) {
      setShowNewItemModal(true);
      return;
    }

    const isZeroTouchModeActive = FEATURE_FLAGS.ZERO_TOUCH && (text.startsWith('/ekip') || isZeroTouchMode);
    const isSingleAgentMode = FEATURE_FLAGS.SINGLE_AGENT_MENTIONS && text.startsWith('@');

    let targetAgentRole = '';
    let targetAgentName = '';
    let messageText = text;

    if (!FEATURE_FLAGS.ZERO_TOUCH && text.startsWith('/ekip')) {
      messageText = text.replace('/ekip', '').trim() || text;
    }

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
      console.error('Failed to save user message to database:', err);
    }

    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'new_message', payload: { itemId: currentWorkspaceId, message: newMsg } });
    }

    if (isZeroTouchModeActive) {
      runZeroTouchMode(newMsg, attachments);
      return;
    }

    const analysisAttachments = toAnalysisAttachments(attachments);
    const actionIntent = detectAiActionIntent(messageText, analysisAttachments);
    const actionIntentContext = buildActionIntentContext(actionIntent);

    setIsGenerating(true);
    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    const aiCreatedAt = Date.now();
    
    setMessages(prev => [...prev, {
      id: aiMsgId,
      role: 'model',
      text: '',
      senderName: targetAgentName || 'JetWork AI',
      senderRole: targetAgentName ? targetAgentName : 'Sistem Asistanı',
      agentRole: targetAgentRole || undefined,
      createdAt: aiCreatedAt,
      isTyping: true
    }]);

    const state = useStore.getState();
    const promptSettings = state.promptSettings;
    const knowledgeBase = state.knowledgeBase;
    const projectMemory = state.projectMemory || {};
    const addKnowledge = state.addKnowledge;
    const memoryEnabled = promptSettings?.memoryEnabled ?? true;
    const contextWindowSize = promptSettings?.contextWindowSize ?? 10;

    try {
      const currentMessages = getCurrentMessages();
      const documentContent = state.documentContent;
      
      let retrievedContext = '';
      if (memoryEnabled && knowledgeBase.length > 0) {
        const relevantKnowledge = hybridSearch(messageText, knowledgeBase, 3);
        if (relevantKnowledge.length > 0) {
          retrievedContext = '\n\n[KURUMSAL HAFIZA / GEÇMİŞ BİLGİLER]\n' + 
            relevantKnowledge.map(k => `- ${k.content} (Önem: ${k.importance}/10)`).join('\n');
        }
      }

      const historyToSend = currentMessages.slice(-contextWindowSize);
      
      if (memoryEnabled && currentMessages.length > contextWindowSize + 5) {
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

      const history: { role: 'user' | 'model'; parts: { text: string }[] }[] = historyToSend.map(m => ({
        role: (m.role === 'user' ? 'user' : 'model') as 'user' | 'model',
        parts: [{ text: `[${m.senderName} - ${m.senderRole}]: ${m.text}` }]
      }));

      const projectMemoryContext = memoryEnabled ? buildProjectMemoryContext(projectMemory) : '';
      const additionalContext = [projectMemoryContext, retrievedContext, actionIntentContext].filter(Boolean).join('\n\n');
      let systemInstruction = buildSystemPrompt({ role: 'SYSTEM', settings: promptSettings, additionalContext });
      if (targetAgentRole) {
        systemInstruction = buildSystemPrompt({ role: targetAgentRole, settings: promptSettings, additionalContext });
      }

      const selectedNodeContent = useStore.getState().selectedDocumentText || null;
      const currentWorkspaceTitle = useStore.getState().projects
        .flatMap(project => project.workspaces)
        .find(workspace => workspace.id === currentWorkspaceId)?.title;
      const loopOutput = await runSingleChatOrchestrator({
        userMessage: messageText,
        history,
        messageHistory: currentMessages,
        documentContent,
        workspaceTitle: currentWorkspaceTitle,
        projectMemory,
        knowledgeBase,
        model: selectedModel,
        systemInstruction,
        selectedNodeContent,
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
        onStream: (text, thinking, questions, actionSummary, tokenCount) => {
          const sanitized = sanitizeDisplayText(text);
          setMessages(prev => prev.map(m => m.id === aiMsgId ? {
            ...m,
            text: sanitized.text,
            thinkingText: thinking,
            questions: questions || sanitized.questions,
            actionSummary: actionSummary || sanitized.actionSummary,
            tokenCount
          } : m));
          if (channelRef.current) {
            channelRef.current.send({
              type: 'broadcast',
              event: 'ai_stream_chunk',
              payload: {
                id: aiMsgId,
                text: sanitized.text,
                thinkingText: thinking,
                questions: questions || sanitized.questions,
                actionSummary: actionSummary || sanitized.actionSummary,
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

      const sanitizedFinal = sanitizeDisplayText(loopOutput.text);
      let fullText = sanitizedFinal.text || loopOutput.text;
      if (fullText.trim().startsWith('{')) fullText = '';
      const finalThinking = loopOutput.thinking;
      const finalQuestions = loopOutput.questions || sanitizedFinal.questions;
      const finalActionSummary = loopOutput.actionSummary || sanitizedFinal.actionSummary;

      let finalDocument: DocumentData | null = documentContent;
      let changedSections: string[] = [];
      let qualityScore = documentContent?.score;
      let qualityExplanation = documentContent?.scoreExplanation;

      if (loopOutput.document) {
        const postProcessResult = postProcessDocumentData(loopOutput.document, documentContent, {
          sourceText: [
            messageText,
            ...currentMessages.slice(-8).map(message => message.text || ''),
          ].filter(Boolean).join('\n\n'),
          workspaceTitle: currentWorkspaceTitle,
          turnDecision: loopOutput.turnDecision,
        });
        finalDocument = postProcessResult.document;
        changedSections = postProcessResult.changedSections;
        qualityScore = postProcessResult.document.score ?? postProcessResult.qualityGate.score;
        qualityExplanation = postProcessResult.document.scoreExplanation || postProcessResult.qualityGate.reason;

        if (!postProcessResult.qualityGate.canPublishToPanel && hasDocumentIntent(messageText)) {
          fullText = [
            'Taslak oluşturdum ve kalite kapısı sağ panelde tamamlanacak alanları işaretledi.',
            '',
            `Kalite puanı: ${postProcessResult.qualityGate.score}/100`,
            `Tamamlanacak/zayıf alanlar: ${postProcessResult.qualityGate.missingSections.join(', ') || 'Yok'}`,
            '',
            'Daha iyi sonuç için ekran görüntüleri, talep dokümanı veya süreç notlarını ekleyebilirsin; mevcut bilgilerle çalışmaya devam edebilirim.'
          ].join('\n');
        }
      }

      if ((!fullText || !fullText.trim()) && finalDocument && finalDocument !== documentContent) {
        fullText = changedSections.length > 0
          ? `Sağ panelde şu bölümler güncellendi: ${changedSections.join(', ')}.`
          : 'İşlem tamamlandı.';
      }

      const docActuallyChanged = !!finalDocument && finalDocument !== documentContent;
      if (docActuallyChanged) {
        useStore.getState().setDocumentContent(finalDocument!);
      } else if (fullText && /sağ panel|dokümana işlen|dokümanlara işlen|belgeye eklen/i.test(fullText)) {
        fullText += '\n\n_Not: Dokümanda otomatik güncelleme yapılmadı. Devam etmek için yönergelerinizi netleştirebilir misiniz?_';
      }

      if (docActuallyChanged) {
        fullText = ensureDocumentActionSummary(fullText, {
          changedSections,
          score: qualityScore,
          scoreExplanation: qualityExplanation,
          document: finalDocument,
        });
      }

      if (memoryEnabled) {
        const memoryUpdates = extractProjectMemoryUpdates({
          userMessage: messageText,
          aiMessage: fullText,
          document: finalDocument,
        });
        if (Object.keys(memoryUpdates).length > 0) {
          const nextMemory = mergeProjectMemory(useStore.getState().projectMemory || {}, memoryUpdates);
          useStore.getState().setProjectMemory(nextMemory);
          localStorage.setItem(`jetwork_project_memory_${currentWorkspaceId}`, JSON.stringify(nextMemory));
        }
      }

      const completedAiMessage: Message = {
        id: aiMsgId,
        role: 'model',
        text: fullText,
        thinkingText: finalThinking,
        questions: finalQuestions,
        actionSummary: finalActionSummary,
        groundingUrls: loopOutput.groundingUrls,
        tokenCount: loopOutput.tokenCount,
        phase: null,
        phaseLabel: undefined,
        isTyping: false,
        senderName: targetAgentName || 'JetWork AI',
        senderRole: targetAgentName || 'Sistem Asistanı',
        agentRole: targetAgentRole || actionIntent.type,
        createdAt: aiCreatedAt,
        score: qualityScore,
        scoreExplanation: qualityExplanation,
      };

      setMessages(prev => prev.map(m => m.id === aiMsgId ? completedAiMessage : m));
      if (channelRef.current) {
        channelRef.current.send({ 
          type: 'broadcast', 
          event: 'ai_stream_end', 
          payload: completedAiMessage,
        });
      }
      await persistAiMessage(completedAiMessage);

      if (docActuallyChanged && finalDocument && Object.keys(finalDocument).length > 0) {
        await saveDocumentAndVersion(currentWorkspaceId, aiMsgId, finalDocument);
      }

    } catch (error) {
      console.error('AI Error:', error);
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
        ...m, 
        text: 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.', 
        isTyping: false,
        isError: true 
      } : m));
    } finally {
      if (memoryEnabled) {
        extractKeyFacts(messageText).then(facts => {
          facts.forEach(f => {
            if (f.importance >= 5) {
              addKnowledge({
                id: Date.now().toString() + Math.random().toString(36).substring(7),
                content: f.fact,
                keywords: f.fact.toLowerCase().split(' ').slice(0, 5),
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
      console.error('Error updating reaction:', error);
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
    await handleSendMessage('Bu konusmaya gore kapsamli kavramsal tasarim dokumani olustur. Surec modelleri, is gerekleri, KPI, ekran/toast/validasyon davranislari, dokuman yonetimi, entegrasyonlar, test/UAT senaryolari ve akis detaylarini BA Analiz icinde detaylandir; Review bolumunde risk, acik konu ve kalite notlarini ayir.');
    return;
    await handleSendMessage('Bu konuşmaya göre kapsamlı kavramsal tasarım dokümanı oluştur. Süreç modelleri, iş gerekleri, KPI, toast/validasyon mesajları, doküman yönetimi, entegrasyonlar, test senaryoları ve akış/sequence detaylarını BA Analiz içinde detaylandır.');
  };

  return { handleSendMessage, handleToggleReaction, handleAcceptAiHandRaise, handleGenerateDocument };
};
