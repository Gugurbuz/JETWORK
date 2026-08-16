import { readFileSync, writeFileSync } from 'node:fs';

const replaceOnce = (text, oldValue, newValue, label) => {
  const first = text.indexOf(oldValue);
  if (first < 0) throw new Error(`${label}: anchor not found`);
  if (text.indexOf(oldValue, first + oldValue.length) >= 0) {
    throw new Error(`${label}: anchor is not unique`);
  }
  return text.slice(0, first) + newValue + text.slice(first + oldValue.length);
};

{
  const path = 'src/services/assistantRuntimeClient.ts';
  let text = readFileSync(path, 'utf8');

  text = replaceOnce(
    text,
    "import { consumeSseBuffer, type SseEvent } from './sseParser';\n",
    "import { consumeSseBuffer, type SseEvent } from './sseParser';\nimport { isRecoverableAssistantTransportError } from './assistantRuntimeRecovery';\n",
    'runtime transport classifier import',
  );

  const oldLoop = `    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = consumeSseBuffer(buffer);
      buffer = parsed.remainder;
      parsed.events.forEach(handleEvent);
    }
    buffer += decoder.decode();
    consumeSseBuffer(buffer, true).events.forEach(handleEvent);

    if (!completedSeen) {`;
  const newLoop = `    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = consumeSseBuffer(buffer);
        buffer = parsed.remainder;
        parsed.events.forEach(handleEvent);
      }
      buffer += decoder.decode();
      consumeSseBuffer(buffer, true).events.forEach(handleEvent);
    } catch (streamError) {
      if (!completedSeen || !isRecoverableAssistantTransportError(streamError)) {
        throw streamError;
      }
      // The backend completed event is the terminal business state. A later
      // network/read close is transport noise and must not overwrite success.
      rememberExecutionLabel('Yanıt tamamlandı; bağlantı kapanışı güvenli şekilde yoksayıldı.');
    }

    if (!completedSeen) {`;
  text = replaceOnce(text, oldLoop, newLoop, 'runtime reader loop');
  writeFileSync(path, text);
}

{
  const path = 'src/hooks/useMessages.ts';
  let text = readFileSync(path, 'utf8');

  text = replaceOnce(
    text,
    "import { splitAssistantSources } from '../services/assistantSources';\n",
    "import { splitAssistantSources } from '../services/assistantSources';\nimport { isRecoverableAssistantTransportError } from '../services/assistantRuntimeRecovery';\n",
    'useMessages transport classifier import',
  );

  text = replaceOnce(
    text,
    "      const stageNotes: string[] = [];\n      const patchStreamingText = (fullText: string) => {",
    "      const stageNotes: string[] = [];\n      let terminalCompletedSeen = false;\n      const patchStreamingText = (fullText: string) => {",
    'useMessages terminal flag',
  );

  text = replaceOnce(
    text,
    "          onStatus: (stage, label) => {\n            const safeLabel = (label || '').trim();",
    "          onCompleted: () => {\n            terminalCompletedSeen = true;\n          },\n          onStatus: (stage, label) => {\n            const safeLabel = (label || '').trim();",
    'useMessages completed callback',
  );

  const oldCatch = `        console.error('Single assistant runtime error:', error);
        const wasAborted = isAbortFailure(error, generationController);
        const stoppedByUser = wasStoppedByUser(generationController);
        const failureDetail = error instanceof Error
          ? error.message
          : 'Yeni asistan yanıtı oluşturulamadı.';
        const failedMessage: Message = {`;
  const newCatch = `        console.error('Single assistant runtime error:', error);
        const wasAborted = isAbortFailure(error, generationController);
        const stoppedByUser = wasStoppedByUser(generationController);
        const terminalTransportClose = terminalCompletedSeen
          && !wasAborted
          && isRecoverableAssistantTransportError(error)
          && streamedText.trim().length > 0;
        if (terminalTransportClose) {
          // Defense in depth. Normal transport closure after a terminal
          // completed event must never turn the successful message red.
          const terminalMessage: Message = {
            id: aiMsgId,
            role: 'model',
            text: streamedText,
            thinkingText: stageNotesAsSummary(stageNotes),
            thinkingTime: elapsedSecondsSince(aiCreatedAt),
            knowledgeSources: streamedKnowledgeSources,
            groundingUrls: streamedGroundingUrls,
            attachments: streamedAttachments,
            isTyping: false,
            isError: false,
            retryPayload: undefined,
            senderName: 'JetWork AI',
            senderRole: 'Sistem Asistanı',
            createdAt: aiCreatedAt,
            phase: null,
            persistenceStatus: 'pending',
          };
          setMessages(previous => previous.map(message => (
            message.id === aiMsgId ? terminalMessage : message
          )));
          broadcastMessage(channelRef, 'ai_stream_end', messageForRealtime(terminalMessage));
          try {
            await saveAiMessage(currentWorkspaceId, user.uid, terminalMessage);
            setMessages(previous => previous.map(message => (
              message.id === terminalMessage.id ? { ...message, persistenceStatus: 'saved' } : message
            )));
          } catch (persistError) {
            console.error('Completed assistant response could not be persisted after transport close:', persistError);
            setMessages(previous => previous.map(message => (
              message.id === terminalMessage.id ? { ...message, persistenceStatus: 'failed' } : message
            )));
          }
          return;
        }
        const failureDetail = error instanceof Error
          ? error.message
          : 'Yeni asistan yanıtı oluşturulamadı.';
        const failedMessage: Message = {`;
  text = replaceOnce(text, oldCatch, newCatch, 'useMessages catch');
  writeFileSync(path, text);
}

// streamAssistantResponse exposes the terminal backend event to the hook only
// for defense-in-depth. Document validation/persistence still happens after the
// SSE terminal event and remains fail-closed inside assistantRuntimeClient.
{
  const path = 'src/services/assistantRuntimeClient.ts';
  let text = readFileSync(path, 'utf8');
  text = replaceOnce(
    text,
    "  onStatus?: (stage: AssistantRuntimeStage, label?: string) => void;\n}): Promise<AssistantRuntimeResult> {",
    "  onStatus?: (stage: AssistantRuntimeStage, label?: string) => void;\n  onCompleted?: () => void;\n}): Promise<AssistantRuntimeResult> {",
    'runtime onCompleted signature',
  );
  text = replaceOnce(
    text,
    "      completedSeen = true;\n      conversationId = parsed.conversationId;",
    "      completedSeen = true;\n      input.onCompleted?.();\n      conversationId = parsed.conversationId;",
    'runtime completed callback',
  );
  writeFileSync(path, text);
}

console.log('Runtime stream stabilization codemod applied successfully.');
