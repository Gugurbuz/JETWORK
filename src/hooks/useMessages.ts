import { useRef } from 'react';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useUIStore } from '../store/useUIStore';
import { Message, MessageAttachment, MessageSendOptions } from '../types';
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
import { ingestKnowledgeAttachment } from '../services/knowledgeCatalogRepository';
import {
  prepareAssistantChatAttachments,
  streamAssistantResponse,
  type AssistantRuntimeStage,
} from '../services/assistantRuntimeClient';
import { splitAssistantSources } from '../services/assistantSources';
import { createAssistantTextSmoother } from '../services/assistantTextSmoother';
import { toast } from 'sonner';

const messageForRealtime = (message: Message): Message => (
  FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
    ? {
        ...message,
        retryPayload: undefined,
        attachments: message.attachments?.map(attachment => ({
          ...attachment,
          file: undefined,
          data: undefined,
          url: attachment.url?.startsWith('data:') ? '' : attachment.url,
        })),
      }
    : message
);

const phaseForAssistantStage = (stage: AssistantRuntimeStage): NonNullable<Message['phase']> => {
  if (stage === 'searching_knowledge' || stage === 'searching_web') return 'RESEARCH';
  if (stage === 'verifying') return 'REFLECT';
  if (stage === 'synthesizing' || stage === 'answering') return 'ACT';
  return 'PLAN';
};

const stageNotesAsSummary = (notes: string[]): string | undefined => (
  notes.length ? notes.map(note => `• ${note}`).join('\n') : undefined
);

const USER_STOP_ABORT_MESSAGE = 'Generation stopped by the user.';

const elapsedSecondsSince = (startedAt: number): number => (
  Math.max(1, Math.round((Date.now() - startedAt) / 1000))
);

const isAbortFailure = (error: unknown, controller: AbortController): boolean => (
  controller.signal.aborted
  || (error instanceof DOMException && error.name === 'AbortError')
  || (error instanceof Error && error.name === 'AbortError')
);

const wasStoppedByUser = (controller: AbortController): boolean => {
  const reason = controller.signal.reason;
  return reason instanceof Error
    ? reason.message === USER_STOP_ABORT_MESSAGE
    : String(reason || '') === USER_STOP_ABORT_MESSAGE;
};

export const useMessages = (channelRef: any) => {
  const generationAbortRef = useRef<AbortController | null>(null);
  const user = useDataStore(state => state.user);
  const currentWorkspaceId = useDataStore(state => state.currentWorkspaceId);
  const setShowNewItemModal = useUIStore(state => state.setShowNewItemModal);
  const setIsGenerating = useDocumentStore(state => state.setIsGenerating);

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

  const handleStopGeneration = () => {
    const activeController = generationAbortRef.current;
    if (!activeController || activeController.signal.aborted) return;
    activeController.abort(new DOMException(USER_STOP_ABORT_MESSAGE, 'AbortError'));
  };

  const handleSendMessage = async (
    text: string,
    attachments?: MessageAttachment[],
    options: MessageSendOptions = {},
  ) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!user) return;
    
    if (!currentWorkspaceId) {
      setShowNewItemModal(true);
      return;
    }

    // Snapshot the model at the actual send boundary. A select change and an
    // immediate submit can occur before React has re-rendered this hook, so a
    // render-captured selectedModel can be one choice behind the UI.
    const requestedModel = useSettingsStore.getState().selectedModel || 'auto';

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

    const preparedAttachments = attachments?.map(attachment => ({
      ...attachment,
      attachmentId: attachment.attachmentId || crypto.randomUUID(),
      ingestion: attachment.purpose === 'knowledge_bank'
        ? { status: 'queued' as const }
        : attachment.ingestion,
    }));
    const isAssistantRetry = FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
      && !!options.retryMessageId;
    const replyToId = options.replyToId;
    const msgId = options.retryMessageId || Date.now().toString();
    const newMsg: Message = {
      id: msgId,
      role: 'user',
      text: messageText,
      senderName: user.name || 'Kullanıcı',
      senderRole: 'Kullanıcı',
      senderColor: user.color,
      createdAt: Date.now(),
      attachments: preparedAttachments,
      replyToId,
      persistenceStatus: 'pending',
    };

    const knowledgeAttachments = FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME && !isAssistantRetry
      ? (preparedAttachments || []).filter(attachment => attachment.purpose === 'knowledge_bank')
      : [];
    const hasOnlyKnowledgeAttachments = FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
      && !!preparedAttachments?.length
      && preparedAttachments.every(attachment => attachment.purpose === 'knowledge_bank');
    const shouldShowAssistantPending = !(!messageText.trim() && hasOnlyKnowledgeAttachments);
    const aiMsgId = options.retryAiMessageId || crypto.randomUUID();
    const aiCreatedAt = Date.now();
    const pendingAiMessage: Message = {
      id: aiMsgId,
      role: 'model',
      text: '',
      senderName: targetAgentName || 'JetWork AI',
      senderRole: targetAgentName ? targetAgentName : 'Sistem Asistanı',
      agentRole: targetAgentRole || undefined,
      createdAt: aiCreatedAt,
      phaseLabel: 'Asistana bağlanılıyor...',
      isTyping: true
    };

    if (shouldShowAssistantPending) {
      // Optimistic UI: render the user's message and the assistant work indicator
      // before persistence/network work so the interface reacts immediately.
      setIsGenerating(true);
      setMessages(previous => {
        const nextMessages = isAssistantRetry ? previous : [...previous, newMsg];
        if (!options.retryAiMessageId) return [...nextMessages, pendingAiMessage];
        const retryTargetExists = nextMessages.some(message => message.id === options.retryAiMessageId);
        return retryTargetExists
          ? nextMessages.map(message => message.id === options.retryAiMessageId ? pendingAiMessage : message)
          : [...nextMessages, pendingAiMessage];
      });
    } else if (!isAssistantRetry) {
      setMessages(previous => [...previous, newMsg]);
    }

    if (!isAssistantRetry) {
      try {
        await saveUserMessage(currentWorkspaceId, user.uid, newMsg);
        setMessages(previous => previous.map(message => (
          message.id === newMsg.id ? { ...message, persistenceStatus: 'saved' } : message
        )));
      } catch (err) {
        console.error('Failed to save user message to database:', err);
        setMessages(previous => previous
          .filter(message => !shouldShowAssistantPending || message.id !== aiMsgId)
          .map(message => (
            message.id === newMsg.id ? { ...message, persistenceStatus: 'failed' } : message
          )));
        if (generationAbortRef.current === generationController) {
          generationAbortRef.current = null;
          setIsGenerating(false);
        }
        toast.error('Mesaj kaydedilemedi. Bağlantını kontrol edip tekrar gönder.');
        return;
      }

      broadcastMessage(channelRef, 'new_message', {
        itemId: currentWorkspaceId,
        message: messageForRealtime(newMsg),
      });
    }

    const ingestionNotes: string[] = [];
    if (knowledgeAttachments.length > 0) {
      setIsGenerating(true);
      for (const attachment of knowledgeAttachments) {
        const updateAttachmentStatus = async (
          ingestion: NonNullable<MessageAttachment['ingestion']>,
        ) => {
          let updatedMessage: Message | undefined;
          setMessages(previous => previous.map(message => {
            if (message.id !== msgId || !message.attachments) return message;
            updatedMessage = {
              ...message,
              attachments: message.attachments.map(candidate => (
                candidate.attachmentId === attachment.attachmentId
                  ? { ...candidate, ingestion }
                  : candidate
              )),
            };
            return updatedMessage;
          }));
          if (updatedMessage) {
            try {
              await saveUserMessage(currentWorkspaceId, user.uid, updatedMessage);
            } catch (statusError) {
              console.error('Failed to persist knowledge attachment status:', statusError);
            }
          }
        };
        try {
          const result = await ingestKnowledgeAttachment(
            currentWorkspaceId,
            attachment,
            updateAttachmentStatus,
          );
          const chunkDetail = result.chunkCount ? `, ${result.chunkCount} chunk` : '';
          const embeddingDetail = result.embeddingStats
            ? `, ${result.embeddingStats.embedded}/${result.embeddingStats.attempted} embedding`
            : '';
          ingestionNotes.push(
            result.deduplicated
              ? `- ${attachment.name || 'Kaynak'}: Aynı içerik zaten kayıtlı; yeni kopya oluşturulmadı.`
              : `- ${attachment.name || 'Kaynak'}: ${result.parsedObjects} nesne, ${result.parsedRelations} ilişki${chunkDetail}${embeddingDetail} taslak olarak işlendi.`,
          );
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Bilinmeyen yükleme hatası';
          await updateAttachmentStatus({ status: 'failed', error: detail });
          ingestionNotes.push(`- ${attachment.name || 'Kaynak'}: Yüklenemedi (${detail}).`);
        }
      }

      if (!messageText.trim() && hasOnlyKnowledgeAttachments) {
        if (FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME) {
          if (generationAbortRef.current === generationController) {
            generationAbortRef.current = null;
            setIsGenerating(false);
          }
          return;
        }
        const ingestionMessage: Message = {
          id: crypto.randomUUID(),
          role: 'model',
          text: [
            'Bilgi bankası işlemi tamamlandı.',
            '',
            ...ingestionNotes,
            '',
            'Yeni kaynaklar güvenli biçimde **taslak** kaldı. AI’ın kullanabilmesi için mesaj alanındaki veritabanı simgesinden Bilgi Bankası’nı açıp kaynakları yayımla.',
          ].join('\n'),
          senderName: 'JetWork AI',
          senderRole: 'Bilgi Bankası',
          createdAt: Date.now(),
          isError: ingestionNotes.every(note => note.includes('Yüklenemedi')),
        };
        setMessages(previous => [...previous, ingestionMessage]);
        try {
          await saveAiMessage(currentWorkspaceId, user.uid, ingestionMessage);
        } catch (error) {
          console.error('Failed to save knowledge ingestion message:', error);
        }
        broadcastMessage(channelRef, 'new_message', {
          itemId: currentWorkspaceId,
          message: ingestionMessage,
        });
        setIsGenerating(false);
        return;
      }

      if (!FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME) {
        messageText = [
          messageText,
          '',
          '[Bilgi bankası yükleme sonucu]',
          ...ingestionNotes,
        ].join('\n').trim();
      }
    }

    if (FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME) {
      let streamedText = '';
      let streamedKnowledgeSources: Message['knowledgeSources'] = [];
      let streamedGroundingUrls: Message['groundingUrls'] = [];
      let streamedAttachments: Message['attachments'] = [];
      const stageNotes: string[] = [];
      const patchStreamingText = (fullText: string) => {
        streamedText = fullText;
        const patch = {
          text: fullText,
          knowledgeSources: streamedKnowledgeSources,
          groundingUrls: streamedGroundingUrls,
          phase: 'ACT' as const,
          phaseLabel: 'Yanıt hazırlanıyor...',
          thinkingText: stageNotesAsSummary(stageNotes),
        };
        setMessages(previous => previous.map(message => (
          message.id === aiMsgId ? { ...message, ...patch } : message
        )));
        broadcastMessage(channelRef, 'ai_stream_chunk', {
          id: aiMsgId,
          ...patch,
          senderName: 'JetWork AI',
          senderRole: 'Sistem Asistanı',
        });
      };
      const textSmoother = createAssistantTextSmoother({
        signal: generationController.signal,
        onUpdate: patchStreamingText,
      });

      try {
        const result = await streamAssistantResponse({
          workspaceId: currentWorkspaceId,
          messageId: msgId,
          message: messageText,
          model: requestedModel,
          chatAttachments: await prepareAssistantChatAttachments(preparedAttachments),
          signal: generationController.signal,
          onText: fullText => {
            textSmoother.push(fullText);
          },
          onArtifacts: attachments => {
            streamedAttachments = attachments;
            setMessages(previous => previous.map(message => (
              message.id === aiMsgId ? { ...message, attachments } : message
            )));
            broadcastMessage(channelRef, 'ai_stream_chunk', {
              id: aiMsgId,
              text: streamedText,
              attachments,
              senderName: 'JetWork AI',
              senderRole: 'Sistem Asistanı',
            });
          },
          onSources: sources => {
            const sourceView = splitAssistantSources(sources);
            streamedKnowledgeSources = sourceView.knowledgeSources;
            streamedGroundingUrls = sourceView.groundingUrls;
            setMessages(previous => previous.map(message => (
              message.id === aiMsgId
                ? {
                    ...message,
                    knowledgeSources: streamedKnowledgeSources,
                    groundingUrls: streamedGroundingUrls,
                  }
                : message
            )));
            broadcastMessage(channelRef, 'ai_stream_chunk', {
              id: aiMsgId,
              text: streamedText,
              knowledgeSources: streamedKnowledgeSources,
              groundingUrls: streamedGroundingUrls,
              senderName: 'JetWork AI',
              senderRole: 'Sistem Asistanı',
            });
          },
          onStatus: (stage, label) => {
            const safeLabel = (label || '').trim();
            if (safeLabel && stageNotes[stageNotes.length - 1] !== safeLabel) {
              stageNotes.push(safeLabel);
              if (stageNotes.length > 5) stageNotes.shift();
            }
            const patch = {
              phase: phaseForAssistantStage(stage),
              phaseLabel: safeLabel || 'Çalışılıyor...',
              thinkingText: stageNotesAsSummary(stageNotes),
            };
            setMessages(previous => previous.map(message => (
              message.id === aiMsgId
                ? { ...message, ...patch }
                : message
            )));
            broadcastMessage(channelRef, 'ai_stream_chunk', {
              id: aiMsgId,
              text: streamedText,
              knowledgeSources: streamedKnowledgeSources,
              groundingUrls: streamedGroundingUrls,
              ...patch,
              senderName: 'JetWork AI',
              senderRole: 'Sistem Asistanı',
            });
          },
        });
        await textSmoother.finish(result.text);
        const finalSourceView = splitAssistantSources(result.sources);

        const completedAiMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: result.text,
          thinkingText: result.workSummary || stageNotesAsSummary(stageNotes),
          questions: result.questions,
          actionSummary: result.actionSummary,
          knowledgeSources: finalSourceView.knowledgeSources,
          groundingUrls: finalSourceView.groundingUrls,
          attachments: result.attachments?.length ? result.attachments : streamedAttachments,
          tokenCount: result.usage?.total_tokens || result.usage?.totalTokens,
          thinkingTime: elapsedSecondsSince(aiCreatedAt),
          phase: null,
          phaseLabel: undefined,
          isTyping: false,
          senderName: 'JetWork AI',
          senderRole: 'Sistem Asistanı',
          createdAt: aiCreatedAt,
          provider: result.provider || (result.model?.startsWith('gemini') ? 'gemini' : 'openai'),
          responseModel: result.model,
          fallbackUsed: result.fallbackUsed,
          persistenceStatus: 'pending',
        };
        setMessages(previous => previous.map(message => (
          message.id === aiMsgId ? completedAiMessage : message
        )));
        broadcastMessage(channelRef, 'ai_stream_end', completedAiMessage);
        try {
          await saveAiMessage(currentWorkspaceId, user.uid, completedAiMessage);
          setMessages(previous => previous.map(message => (
            message.id === completedAiMessage.id ? { ...message, persistenceStatus: 'saved' } : message
          )));
        } catch (persistError) {
          console.error('Assistant response was generated but could not be persisted:', persistError);
          setMessages(previous => previous.map(message => (
            message.id === completedAiMessage.id ? { ...message, persistenceStatus: 'failed' } : message
          )));
          toast.error('Asistan yanıtı oluşturuldu ancak kaydedilemedi.');
        }
      } catch (error) {
        console.error('Single assistant runtime error:', error);
        const wasAborted = isAbortFailure(error, generationController);
        const stoppedByUser = wasStoppedByUser(generationController);
        const failureDetail = error instanceof Error
          ? error.message
          : 'Yeni asistan yanıtı oluşturulamadı.';
        const failedMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: stoppedByUser
            ? streamedText
            : streamedText
            ? `${streamedText}\n\n> Yanıt tamamlanmadan bağlantı kesildi. Aşağıdaki tekrar deneme seçeneğini kullanabilirsin.`
            : (
              wasAborted
                ? 'Önceki yanıt yeni talep nedeniyle iptal edildi.'
                : (
                  /tekrar dene/iu.test(failureDetail)
                    ? failureDetail
                    : `${failureDetail} Lütfen tekrar deneyin.`
                )
            ),
          thinkingText: stageNotesAsSummary(stageNotes),
          thinkingTime: elapsedSecondsSince(aiCreatedAt),
          actionSummary: stoppedByUser
            ? (streamedText
                ? 'Yanıt kullanıcı tarafından durduruldu; üretilen bölüm korundu.'
                : 'Yanıt kullanıcı tarafından durduruldu.')
            : undefined,
          knowledgeSources: streamedKnowledgeSources,
          groundingUrls: streamedGroundingUrls,
          isTyping: false,
          isError: !wasAborted,
          retryPayload: wasAborted ? undefined : {
            text,
            attachments: preparedAttachments,
            replyToId,
            messageId: msgId,
            assistantMessageId: aiMsgId,
          },
          senderName: 'JetWork AI',
          senderRole: 'Sistem Asistanı',
          createdAt: aiCreatedAt,
          phase: null,
          persistenceStatus: 'pending',
        };
        setMessages(previous => previous.map(message => (
          message.id === aiMsgId ? failedMessage : message
        )));
        broadcastMessage(channelRef, 'ai_stream_end', messageForRealtime(failedMessage));
        if (!wasAborted || stoppedByUser) {
          try {
            await saveAiMessage(currentWorkspaceId, user.uid, failedMessage);
            setMessages(previous => previous.map(message => (
              message.id === failedMessage.id ? { ...message, persistenceStatus: 'saved' } : message
            )));
          } catch (persistError) {
            console.error('Failed to save assistant error message:', persistError);
            setMessages(previous => previous.map(message => (
              message.id === failedMessage.id ? { ...message, persistenceStatus: 'failed' } : message
            )));
          }
        }
      } finally {
        textSmoother.stop();
        if (generationAbortRef.current === generationController) {
          generationAbortRef.current = null;
          setIsGenerating(false);
        }
      }
      return;
    }

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
        model: requestedModel,
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
        thinkingTime: elapsedSecondsSince(aiCreatedAt),
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
      const wasAborted = isAbortFailure(error, generationController);
      const stoppedByUser = wasStoppedByUser(generationController);
      const currentAiMessage = getCurrentMessages().find(message => message.id === aiMsgId);
      const failedMessage: Message = {
        ...(currentAiMessage || pendingAiMessage),
        text: stoppedByUser
          ? (currentAiMessage?.text || '')
          : wasAborted
            ? 'Önceki üretim yeni talep nedeniyle iptal edildi.'
            : 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.',
        thinkingTime: elapsedSecondsSince(aiCreatedAt),
        actionSummary: stoppedByUser
          ? (currentAiMessage?.text
              ? 'Yanıt kullanıcı tarafından durduruldu; üretilen bölüm korundu.'
              : 'Yanıt kullanıcı tarafından durduruldu.')
          : currentAiMessage?.actionSummary,
        phase: null,
        phaseLabel: stoppedByUser ? 'Durduruldu' : undefined,
        isTyping: false,
        isError: !wasAborted,
      };
      setMessages(prev => prev.map(message => message.id === aiMsgId ? failedMessage : message));
      broadcastMessage(channelRef, 'ai_stream_end', messageForRealtime(failedMessage));
      if (stoppedByUser) {
        try {
          await saveAiMessage(currentWorkspaceId, user.uid, failedMessage);
          setMessages(previous => previous.map(message => (
            message.id === failedMessage.id ? { ...message, persistenceStatus: 'saved' } : message
          )));
        } catch (persistError) {
          console.error('Stopped assistant response could not be persisted:', persistError);
          setMessages(previous => previous.map(message => (
            message.id === failedMessage.id ? { ...message, persistenceStatus: 'failed' } : message
          )));
        }
      }
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

  return {
    handleSendMessage,
    handleStopGeneration,
    handleToggleReaction,
    handleAcceptAiHandRaise,
    handleGenerateDocument,
  };
};