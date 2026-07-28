import { useRef } from 'react';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { Message } from '../types';
import { ZERO_TOUCH_AGENTS } from '../constants';
import { buildSystemPrompt } from '../services/promptEngine';
import { summarizeConversation } from '../services/contextManager';
import { runSingleChatOrchestrator } from '../services/singleChatOrchestrator';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { useMessageStore } from '../store/useMessageStore';
import { sanitizeAiDisplayText } from '../services/aiMessagePresentation';
import { applyAiDocumentResult } from '../services/documentApplicationService';
import { extractKnowledgeItems, persistTurnMemory } from '../services/memoryExtractionService';
import { saveAiMessage, saveMessageReactions, saveUserMessage } from '../services/messageRepository';
import { broadcastMessage, createAiStreamAdapter } from '../services/aiStreamAdapter';
import {
  buildAnalystTurnContext,
  renderAnalystTurnContext,
  toModelHistory,
} from '../services/analystContext';
import {
  retrieveRelevantKnowledge,
  saveKnowledgeItems,
} from '../services/semanticKnowledgeRepository';

export const useMessages = (channelRef: any) => {
  const generationAbortRef = useRef<AbortController | null>(null);
  const user = useDataStore(state => state.user);
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const setShowNewItemModal = useUIStore(state => state.setShowNewItemModal);
  const setIsGenerating = useDocumentStore(state => state.setIsGenerating);
  const selectedModel = useSettingsStore(state => state.selectedModel);

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

    generationAbortRef.current?.abort(new DOMException('Superseded by a newer user message.', 'AbortError'));
    const generationController = new AbortController();
    generationAbortRef.current = generationController;

    const isSingleAgentMode = FEATURE_FLAGS.SINGLE_AGENT_MENTIONS && text.startsWith('@');

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
      await saveUserMessage(currentWorkspaceId, user.uid, newMsg);
    } catch (err) {
      console.error('Failed to save user message to database:', err);
    }

    broadcastMessage(channelRef, 'new_message', { itemId: currentWorkspaceId, message: newMsg });

    setIsGenerating(true);
    const aiMsgId = crypto.randomUUID();
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

    const documentState = useDocumentStore.getState();
    const promptSettings = useSettingsStore.getState().promptSettings;
    const knowledgeBase = documentState.knowledgeBase;
    const projectMemory = documentState.projectMemory || {};
    const memoryItems = documentState.memoryItems || [];
    const addKnowledge = documentState.addKnowledge;
    const memoryEnabled = promptSettings?.memoryEnabled ?? true;
    const contextWindowSize = promptSettings?.contextWindowSize ?? 10;

    if (memoryEnabled) {
      try {
        const nextMemory = await persistTurnMemory({
          workspaceId: currentWorkspaceId,
          messageId: msgId,
          userMessage: messageText,
          currentMemoryItems: memoryItems,
        });
        if (nextMemory) {
          useDocumentStore.getState().setMemoryItems(nextMemory);
        }
      } catch (error) {
        console.error('Project memory persistence failed:', error);
      }
    }

    try {
      const currentMessages = getCurrentMessages();
      const documentContent = documentState.documentContent;
      const selectedNodeContent = useDocumentStore.getState().selectedDocumentText || null;
      // Keep the existing setting as a compatibility input, but budget the
      // conversation by approximate tokens instead of a raw message count.
      const contextTokenBudget = Math.min(12_000, Math.max(2_400, contextWindowSize * 600));
      const turnContext = await buildAnalystTurnContext({
        userMessage: messageText,
        currentUserMessageId: msgId,
        messages: currentMessages,
        projectMemory,
        memoryItems,
        knowledgeBase,
        currentArtifact: documentContent,
        selectedContent: selectedNodeContent,
        tokenBudget: contextTokenBudget,
        memoryEnabled,
        summarize: messages => summarizeConversation(messages, generationController.signal),
        retrieveKnowledge: (query, items) => (
          retrieveRelevantKnowledge(query, items, currentWorkspaceId, 5)
        ),
      });
      useDocumentStore.getState().setLastAnalystContextDebug(turnContext.debug);
      const history = toModelHistory(turnContext.recentConversation);
      const additionalContext = renderAnalystTurnContext(turnContext);
      let systemInstruction = buildSystemPrompt({ role: 'SYSTEM', settings: promptSettings, additionalContext });
      if (targetAgentRole) {
        systemInstruction = buildSystemPrompt({ role: targetAgentRole, settings: promptSettings, additionalContext });
      }

      const currentWorkspaceTitle = useDataStore.getState().projects
        .flatMap(project => project.workspaces)
        .find(workspace => workspace.id === currentWorkspaceId)?.title;
      const streamAdapter = createAiStreamAdapter({
        channelRef,
        messageId: aiMsgId,
        senderName: targetAgentName || 'JetWork AI',
        senderRole: targetAgentName || 'Sistem Asistanı',
        agentRole: targetAgentRole || undefined,
        setMessages,
      });
      const loopOutput = await runSingleChatOrchestrator({
        userMessage: messageText,
        history,
        messageHistory: turnContext.recentConversation,
        documentContent,
        workspaceId: currentWorkspaceId,
        workspaceTitle: currentWorkspaceTitle,
        projectMemory,
        knowledgeBase: turnContext.retrievedSources,
        analystContext: turnContext,
        model: selectedModel,
        systemInstruction,
        signal: generationController.signal,
        selectedNodeContent,
        ...streamAdapter,
      });

      const sanitizedFinal = sanitizeAiDisplayText(loopOutput.text);
      let fullText = sanitizedFinal.text || loopOutput.text;
      if (fullText.trim().startsWith('{')) fullText = '';
      const finalThinking = loopOutput.thinking;
      const finalQuestions = loopOutput.questions || sanitizedFinal.questions;
      const finalActionSummary = loopOutput.actionSummary || sanitizedFinal.actionSummary;

      const application = await applyAiDocumentResult({
        loopOutput,
        initialText: fullText,
        existingDocument: documentContent,
        userMessage: messageText,
        recentMessages: [...turnContext.recentConversation, newMsg],
        workspaceTitle: currentWorkspaceTitle,
        workspaceId: currentWorkspaceId,
        messageId: aiMsgId,
      });
      fullText = application.text;
      const finalDocument = application.document;
      const qualityScore = application.score;
      const qualityExplanation = application.scoreExplanation;

      if (application.applied && finalDocument) {
        useDocumentStore.getState().setDocumentContent(finalDocument);
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
        agentRole: targetAgentRole || loopOutput.turnDecision?.action || loopOutput.intent,
        createdAt: aiCreatedAt,
        score: qualityScore,
        scoreExplanation: qualityExplanation,
        documentSnapshot: application.applied && finalDocument ? finalDocument : undefined,
        previousDocumentSnapshot: application.applied && documentContent ? documentContent : undefined,
        documentActions: application.applied ? application.changedSections : undefined,
      };

      setMessages(prev => prev.map(m => m.id === aiMsgId ? completedAiMessage : m));
      broadcastMessage(channelRef, 'ai_stream_end', completedAiMessage);
      await saveAiMessage(currentWorkspaceId, user.uid, completedAiMessage);

    } catch (error) {
      console.error('AI Error:', error);
      const wasAborted = error instanceof DOMException && error.name === 'AbortError';
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
        ...m, 
        text: wasAborted ? 'Önceki üretim yeni talep nedeniyle iptal edildi.' : 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.',
        isTyping: false,
        isError: !wasAborted,
      } : m));
    } finally {
      if (memoryEnabled) {
        extractKnowledgeItems(currentWorkspaceId, messageText).then(items => {
          items.forEach(addKnowledge);
          return saveKnowledgeItems(currentWorkspaceId, items, msgId);
        }).catch(console.error);
      }

      if (generationAbortRef.current === generationController) {
        generationAbortRef.current = null;
        setIsGenerating(false);
      }
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
      await saveMessageReactions(currentWorkspaceId, messageId, newReactions);
    } catch (error) {
      console.error('Error updating reaction:', error);
    }
  };

  const handleAcceptAiHandRaise = () => {
    const state = useDocumentStore.getState();
    if (state.aiHandRaised) {
      state.setAiHandRaised(null);
      void handleSendMessage('Lutfen mevcut analize ana JetWork AI karar hatti uzerinden devam et.');
    }
  };

  const handleGenerateDocument = async () => {
    await handleSendMessage('Bu konusmaya gore kapsamli kavramsal tasarim dokumani olustur. Kaynakta belirlenen surecleri, is gereklerini, KPI olcumlerini, ekran/toast/validasyon davranislarini, dokuman yonetimini, entegrasyonlari, test/UAT senaryolarini ve akis detaylarini BA Analiz icinde detaylandir; kaynakta olmayan degerleri uydurma ve Review bolumunde risk, varsayim, acik konu ve kalite bulgularini ayir.');
  };

  return { handleSendMessage, handleToggleReaction, handleAcceptAiHandRaise, handleGenerateDocument };
};
