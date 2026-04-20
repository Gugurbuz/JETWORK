import React from 'react';
import { Message, DocumentData, Question } from '../types';
import { SYSTEM_INSTRUCTION } from '../constants';
import { callGemini, callAiWithRetry } from '../services/aiService';
import { saveDocumentAndVersion } from '../utils/documentUtils';
import { db, doc, updateDoc, serverTimestamp } from '../db';
import { chatResponseJsonSchema, documentGenerationJsonSchema } from '../schemas';
import { buildSystemPrompt } from '../services/promptEngine';
import { hybridSearch, extractKeyFacts, summarizeConversation } from '../services/contextManager';
import { parseAgentMention, isJetWorkMention, parseReadUrl } from '../services/agentRouter';
import { parseStreamChunk, parseFinalResponse } from '../services/streamingService';
import { processSection, applyDocumentUpdates, buildDocumentActions } from '../services/documentService';
import { saveUserMessage, saveAIMessage, saveReactions } from '../services/messageService';
import { useAIStore } from '../store/useAIStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useStore } from '../store/useStore';
import { AuthUser } from '../store/useAuthStore';

export type { AuthUser as User };

interface UseAIParams {
  currentWorkspaceId: string | null;
  user: AuthUser | null;
  messages: Message[];
  setMessages: (updater: Message[] | ((prev: Message[]) => Message[])) => void;
  channelRef: React.MutableRefObject<any>;
}

export function useAI({
  currentWorkspaceId,
  user,
  messages,
  setMessages,
  channelRef
}: UseAIParams) {
  const { isGenerating, setIsGenerating, aiHandRaised, setAiHandRaised, activeTab, setActiveTab, isAiActive } = useAIStore();
  const { documentContent, setDocumentContent, setShowNewItemModal } = useStore();
  const { selectedModel, promptSettings, knowledgeBase, addKnowledge } = useSettingsStore();

  const broadcast = (event: string, payload: Record<string, any>) => {
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event, payload });
    }
  };

  const handleSendMessage = async (
    text: string,
    attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[],
    replyToId?: string
  ) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!user) return;

    if (!currentWorkspaceId) {
      setShowNewItemModal(true);
      return;
    }

    setAiHandRaised(null);

    const agentParse = parseAgentMention(text);

    if (agentParse.isMention && agentParse.error) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'model',
          text: `Hata: ${agentParse.error}`,
          senderName: 'Sistem',
          senderRole: 'Hata',
          createdAt: Date.now(),
          isError: true
        }
      ]);
      return;
    }

    const targetAgent = agentParse.target;
    const cleanText = targetAgent ? targetAgent.messageText : text;

    const msgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    const newUserMessage: Message = {
      id: msgId,
      role: 'user',
      text: cleanText,
      senderName: user.name || 'Kullanıcı',
      senderRole: user.role || 'Kullanıcı',
      createdAt: Date.now(),
      replyToId,
      attachments: attachments?.map((a) => ({ url: a.url, data: a.data, mimeType: a.mimeType, name: a.name }))
    };

    setMessages((prev) => [...prev, newUserMessage]);

    try {
      await saveUserMessage(currentWorkspaceId, newUserMessage, user.uid);
    } catch (err) {
      console.error('Failed to save user message:', err);
    }

    broadcast('new_message', { itemId: currentWorkspaceId, message: newUserMessage });

    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);

    const isMentioned = isJetWorkMention(text);
    const shouldAiRespond = isAiActive || isMentioned || agentParse.isMention;

    const previousDocumentSnapshot = documentContent ? { ...documentContent } : undefined;

    setIsGenerating(true);

    setMessages((prev) => [
      ...prev,
      {
        id: aiMsgId,
        role: 'model',
        text: '',
        senderName: targetAgent?.agentName || 'JetWork AI',
        senderRole: targetAgent?.agentName || 'Sistem Asistanı',
        agentRole: targetAgent?.agentRole || undefined,
        createdAt: Date.now(),
        isTyping: true
      }
    ]);

    broadcast('ai_stream_chunk', {
      itemId: currentWorkspaceId,
      id: aiMsgId,
      text: '',
      senderName: targetAgent?.agentName || 'JetWork AI',
      senderRole: targetAgent?.agentName || 'Sistem Asistanı'
    });

    try {
      const memoryEnabled = promptSettings?.memoryEnabled ?? true;
      const contextWindowSize = promptSettings?.contextWindowSize ?? 10;

      let retrievedContext = '';
      if (memoryEnabled && knowledgeBase.length > 0) {
        const relevant = hybridSearch(cleanText, knowledgeBase, 3);
        if (relevant.length > 0) {
          retrievedContext =
            '\n\n[KURUMSAL HAFIZA]\n' +
            relevant.map((k) => `- ${k.content} (Önem: ${k.importance}/10)`).join('\n');
        }
      }

      if (memoryEnabled && messages.length > contextWindowSize + 5) {
        const toSummarize = messages.slice(0, messages.length - contextWindowSize);
        summarizeConversation(toSummarize)
          .then((summary) => {
            if (summary) {
              addKnowledge({
                id: Date.now().toString(),
                content: `Önceki Konuşma Özeti: ${summary}`,
                keywords: ['özet', 'geçmiş', 'konuşma'],
                importance: 9,
                createdAt: Date.now(),
                projectId: currentWorkspaceId!
              });
            }
          })
          .catch(console.error);
      }

      const historySlice = messages.slice(-contextWindowSize);
      const history = historySlice.map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: `[${m.senderName} - ${m.senderRole}]: ${m.text}` }]
      }));

      let systemInstruction = targetAgent
        ? buildSystemPrompt({ role: targetAgent.agentRole, settings: promptSettings, additionalContext: retrievedContext })
        : buildSystemPrompt({ role: 'SYSTEM', settings: promptSettings, additionalContext: retrievedContext });

      systemInstruction +=
        "\n\n[KISITLAMA]: Eğer BA Analiz Dokümanını güncelleyeceksen, ASLA Markdown KULLANMA. Tablolari HTML table tagleriyle ciz.";

      let documentContextStr = '';
      if (documentContent && Object.keys(documentContent).length > 0) {
        documentContextStr = '\n\n[MEVCUT DOKÜMAN DURUMU]: Mevcut doküman içeriği kontekst olarak eklendi.';
      }

      let commandAddition = '';
      if (text.startsWith('/spike')) {
        commandAddition = "\n\nBu konu için bir PoC hazırla, alternatif teknolojileri kıyasla.";
      } else if (text.startsWith('/thinkmore')) {
        commandAddition = "\n\nBu problemi adım adım, tüm uç durumları ve riskleri hesaplayarak analiz et.";
      } else if (text.startsWith('/story')) {
        commandAddition = "\n\nBu özellik için Agile formatında User Story ve BDD formatında Kabul Kriterleri oluştur.";
      } else if (text.startsWith('/test')) {
        commandAddition = "\n\nBu konu/özellik için kapsamlı test senaryoları üret.";
      } else if (text.startsWith('/read')) {
        const url = parseReadUrl(text);
        if (url) commandAddition = `\n\nLütfen şu URL yi oku ve analiz et: ${url}`;
      }

      const userParts: any[] = [
        { text: `[${user.name} - Kullanıcı]: ${cleanText}${documentContextStr}${commandAddition}` },
        ...(attachments?.map((a) => ({ inlineData: { data: a.data, mimeType: a.mimeType } })) || [])
      ];

      const contents = [
        ...history,
        { role: 'user', parts: userParts }
      ];

      let fullText = '';
      let fullThinkingText = '';
      let currentQuestions: Question[] | undefined;
      let groundingUrls: { uri: string; title: string }[] = [];
      let newDocumentContent: DocumentData | null = null;
      let lastUpdateTime = Date.now();

      const aiResponse = await callAiWithRetry(() =>
        callGemini({
          model: selectedModel || 'gemini-3-flash-preview',
          systemInstruction,
          contents,
          responseSchema: chatResponseJsonSchema,
          currentDocument: documentContent,
          onGrounding: (urls) => {
            groundingUrls = [
              ...groundingUrls,
              ...urls.filter((u) => !groundingUrls.find((gu) => gu.uri === u.uri))
            ];
          },
          onChunk: (rawText, thinking) => {
            const result = parseStreamChunk(rawText, thinking || '');
            fullText = result.text;
            fullThinkingText = result.thinkingText;
            if (result.questions) currentQuestions = result.questions;

            if (result.documentUpdates) {
              setDocumentContent((prev) => {
                const { newDoc, hasChanges } = applyDocumentUpdates(prev, result.documentUpdates!);
                if (hasChanges) {
                  newDocumentContent = newDoc;
                  return newDoc;
                }
                return prev;
              });
            }

            if (!result.isNoResponse && Date.now() - lastUpdateTime > 30) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? {
                        ...m,
                        text: fullText,
                        thinkingText: fullThinkingText,
                        questions: currentQuestions,
                        groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
                      }
                    : m
                )
              );
              broadcast('ai_stream_chunk', {
                itemId: currentWorkspaceId,
                id: aiMsgId,
                text: fullText,
                thinkingText: fullThinkingText,
                questions: currentQuestions,
                groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
              });
              lastUpdateTime = Date.now();
            }
          }
        })
      );

      const finalParsed = parseFinalResponse(aiResponse.text);
      if (finalParsed.text && !fullText) fullText = finalParsed.text;
      if (finalParsed.questions) currentQuestions = finalParsed.questions;

      if (finalParsed.documentUpdates) {
        setDocumentContent((prev) => {
          const { newDoc, hasChanges } = applyDocumentUpdates(prev, finalParsed.documentUpdates!);
          if (hasChanges) {
            newDocumentContent = newDoc;
            return newDoc;
          }
          return prev;
        });
      }

      if (fullText.trim().startsWith('NO_RESPONSE')) {
        setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
        if (!shouldAiRespond) setAiHandRaised(fullText);
        return;
      }

      const documentActions =
        newDocumentContent
          ? buildDocumentActions(newDocumentContent, previousDocumentSnapshot)
          : undefined;

      const finalMessage: Message = {
        id: aiMsgId,
        role: 'model',
        text: fullText || (newDocumentContent ? 'Doküman güncellendi.' : ''),
        thinkingText: fullThinkingText,
        senderName: targetAgent?.agentName || 'JetWork AI',
        senderRole: targetAgent?.agentName || 'Sistem Asistanı',
        agentRole: targetAgent?.agentRole || undefined,
        isTyping: false,
        documentSnapshot: newDocumentContent || undefined,
        previousDocumentSnapshot,
        documentActions: documentActions && documentActions.length > 0 ? documentActions : undefined,
        questions: currentQuestions,
        groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined,
        tokenCount: aiResponse.tokenCount,
        createdAt: Date.now()
      };

      setMessages((prev) => prev.map((m) => (m.id === aiMsgId ? finalMessage : m)));

      broadcast('ai_stream_end', {
        itemId: currentWorkspaceId,
        id: aiMsgId,
        text: finalMessage.text,
        thinkingText: fullThinkingText,
        senderName: finalMessage.senderName,
        senderRole: finalMessage.senderRole,
        agentRole: finalMessage.agentRole,
        questions: currentQuestions,
        groundingUrls: groundingUrls.length > 0 ? groundingUrls : null,
        documentSnapshot: newDocumentContent || null,
        previousDocumentSnapshot,
        documentActions
      });

      try {
        await saveAIMessage(
          currentWorkspaceId,
          finalMessage,
          user.uid,
          aiResponse.text,
          null,
          newDocumentContent
        );
      } catch (err) {
        console.error('Failed to save AI message:', err);
      }
    } catch (error: any) {
      console.error('AI Error:', error);
      const isQuotaError =
        error?.message?.includes('429') || error?.message?.includes('RESOURCE_EXHAUSTED');

      setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          role: 'model',
          text: isQuotaError
            ? 'Kota Siniri Asildi: Gemini API kullanim sinirina ulasildi. Lutfen birkaç dakika bekleyip tekrar deneyin.'
            : `Hata: ${error.message || 'Bilinmeyen hata'}`,
          senderName: 'Sistem',
          senderRole: 'Hata',
          createdAt: Date.now(),
          isError: true
        }
      ]);
    } finally {
      const memoryEnabled = promptSettings?.memoryEnabled ?? true;
      if (memoryEnabled) {
        extractKeyFacts(cleanText)
          .then((facts) => {
            facts.forEach((f) => {
              if (f.importance >= 5) {
                addKnowledge({
                  id: Date.now().toString() + Math.random().toString(36).substring(7),
                  content: f.fact,
                  keywords: f.fact.toLowerCase().split(' ').slice(0, 5),
                  importance: f.importance,
                  createdAt: Date.now(),
                  projectId: currentWorkspaceId!
                });
              }
            });
          })
          .catch(console.error);
      }
      setIsGenerating(false);
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

    setMessages((prev) => [...prev, finalMsg]);
    setAiHandRaised(null);

    try {
      await saveAIMessage(currentWorkspaceId, finalMsg, user.uid);
    } catch (err) {
      console.error('Failed to save accepted AI message:', err);
    }

    broadcast('ai_stream_end', {
      itemId: currentWorkspaceId,
      id: aiMsgId,
      text: aiHandRaised,
      senderName: 'JetWork AI',
      senderRole: 'Sistem Asistanı'
    });
  };

  const handleGenerateDocument = async () => {
    if (messages.length === 0 || !currentWorkspaceId) return;
    setIsGenerating(true);

    try {
      let historyText = 'Sohbet Gecmisi:\n';
      messages.forEach((m) => {
        historyText += `${m.senderName || 'Kullanici'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
      });

      const prompt = historyText + '\n\n[GOREV]\nYukaridaki konusmalara dayanarak KAPSAMLI bir analiz dokumani olustur. SADECE BELİRTİLEN JSON SEMASINA UYGUN OBJEYI DON.';

      let accumulatedJson = '';
      await callAiWithRetry(() =>
        callGemini({
          model: selectedModel || 'gemini-3-flash-preview',
          systemInstruction: SYSTEM_INSTRUCTION,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          responseSchema: documentGenerationJsonSchema,
          onChunk: (text) => {
            accumulatedJson = text;
          }
        })
      );

      let jsonText = accumulatedJson.trim();
      const jsonBlockMatch = jsonText.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
      if (jsonBlockMatch) {
        jsonText = jsonBlockMatch[1].trim();
      } else {
        const firstBrace = jsonText.indexOf('{');
        if (firstBrace >= 0) jsonText = jsonText.substring(firstBrace).trim();
      }
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.replace(/\n?```$/, '');
      }

      const data = JSON.parse(jsonText);

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
        console.error('Failed to save generated document:', err);
      }
    } catch (error) {
      console.error('Error generating document:', error);
      const fallbackData: DocumentData = {
        businessAnalysis: { content: 'Dokuman olusturulurken bir hata olustu. Lutfen tekrar deneyin.', status: 'DRAFT', flags: [] },
        code: { content: '', status: 'DRAFT', flags: [] },
        test: { content: '', status: 'DRAFT', flags: [] },
        review: { content: '', status: 'DRAFT', flags: [] },
        bpmn: { content: '', status: 'DRAFT', flags: [] }
      };
      setDocumentContent(fallbackData);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!user || !currentWorkspaceId) return;

    const message = messages.find((m) => m.id === messageId);
    if (!message) return;

    const currentReactions = message.reactions || [];
    const existingIdx = currentReactions.findIndex((r) => r.emoji === emoji);
    let newReactions = [...currentReactions];

    if (existingIdx >= 0) {
      const reaction = { ...newReactions[existingIdx] };
      if (reaction.users.includes(user.name)) {
        reaction.users = reaction.users.filter((u) => u !== user.name);
        if (reaction.users.length === 0) {
          newReactions.splice(existingIdx, 1);
        } else {
          newReactions[existingIdx] = reaction;
        }
      } else {
        reaction.users = [...reaction.users, user.name];
        newReactions[existingIdx] = reaction;
      }
    } else {
      newReactions.push({ emoji, users: [user.name] });
    }

    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, reactions: newReactions } : m))
    );

    try {
      await saveReactions(currentWorkspaceId, messageId, newReactions);
    } catch (error) {
      console.error('Error updating reaction:', error);
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
    handleGenerateDocument,
    handleToggleReaction
  };
}
