import type { Message, Question } from '../types';
import { sanitizeAiDisplayText } from './aiMessagePresentation';

type SetMessages = (updater: (previous: Message[]) => Message[]) => void;

function broadcast(channelRef: any, event: string, payload: Record<string, unknown>): void {
  channelRef?.current?.send({ type: 'broadcast', event, payload });
}

export function createAiStreamAdapter(input: {
  channelRef: any;
  messageId: string;
  senderName: string;
  senderRole: string;
  agentRole?: string;
  setMessages: SetMessages;
}) {
  const identity = {
    senderName: input.senderName,
    senderRole: input.senderRole,
    agentRole: input.agentRole,
  };

  return {
    onPhase: (phase: any, phaseLabel: string) => {
      input.setMessages(previous => previous.map(message => message.id === input.messageId
        ? { ...message, phase, phaseLabel }
        : message));
      broadcast(input.channelRef, 'ai_stream_chunk', {
        id: input.messageId,
        phase,
        phaseLabel,
        ...identity,
      });
    },
    onThinking: (thinkingText: string) => {
      input.setMessages(previous => previous.map(message => message.id === input.messageId
        ? { ...message, thinkingText }
        : message));
    },
    onStream: (
      text: string,
      thinkingText: string,
      questions?: Question[],
      actionSummary?: string,
      tokenCount?: number,
    ) => {
      const sanitized = sanitizeAiDisplayText(text);
      const patch = {
        text: sanitized.text,
        thinkingText,
        questions: questions || sanitized.questions,
        actionSummary: actionSummary || sanitized.actionSummary,
        tokenCount,
      };
      input.setMessages(previous => previous.map(message => message.id === input.messageId
        ? { ...message, ...patch }
        : message));
      broadcast(input.channelRef, 'ai_stream_chunk', {
        id: input.messageId,
        ...patch,
        ...identity,
      });
    },
    onGrounding: (groundingUrls: { uri: string; title: string }[]) => {
      input.setMessages(previous => previous.map(message => message.id === input.messageId
        ? { ...message, groundingUrls }
        : message));
    },
  };
}

export function broadcastMessage(channelRef: any, event: string, payload: Message | Record<string, unknown>): void {
  broadcast(channelRef, event, payload as Record<string, unknown>);
}
