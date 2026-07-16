import { supabase } from '../supabase';
import { ZERO_TOUCH_AGENTS } from '../constants';
import type { ActiveUser, DocumentData, Message, TypingUser } from '../types';

type MessageUpdater = (updater: (previous: Message[]) => Message[]) => void;

export function mergeAiChunk(previous: Message[], data: any): Message[] {
  const existingMessage = previous.find(message => message.id === data.id);
  if (existingMessage && existingMessage.isTyping === false) return previous;
  const existing = !!existingMessage;
  const senderName = data.senderName
    || (data.agentRole ? ZERO_TOUCH_AGENTS.find(agent => agent.role === data.agentRole)?.name : undefined)
    || 'JetWork AI';
  const senderRole = data.senderRole || senderName || 'Sistem Asistanı';
  const patch = {
    text: data.text,
    thinkingText: data.thinkingText,
    score: data.score,
    scoreExplanation: data.scoreExplanation,
    questions: data.questions,
    senderName,
    senderRole,
    agentRole: data.agentRole,
    groundingUrls: data.groundingUrls,
  };

  if (existing) {
    return previous.map(message => message.id === data.id ? { ...message, ...patch } : message);
  }
  return [...previous, {
    id: data.id,
    role: 'model',
    ...patch,
    isTyping: true,
    createdAt: Date.now(),
  } as Message];
}

export function mergeAiEnd(previous: Message[], data: any): Message[] {
  const existing = previous.some(message => message.id === data.id);
  const patch = {
    text: data.text,
    thinkingText: data.thinkingText,
    score: data.score,
    scoreExplanation: data.scoreExplanation,
    questions: data.questions,
    groundingUrls: data.groundingUrls,
    isTyping: false,
    createdAt: Date.now(),
  };
  if (existing) {
    return previous.map(message => message.id === data.id ? { ...message, ...patch } : message);
  }
  return [...previous, {
    id: data.id,
    role: 'model',
    senderName: data.senderName || 'JetWork AI',
    senderRole: data.senderRole || 'Sistem Asistanı',
    agentRole: data.agentRole,
    ...patch,
  } as Message];
}

export function subscribeWorkspaceRealtime(input: {
  workspaceId: string;
  sessionId: string;
  userName: string;
  setActiveUsers: (users: ActiveUser[]) => void;
  setTypingUsers: (updater: TypingUser[] | ((previous: TypingUser[]) => TypingUser[])) => void;
  setMessages: MessageUpdater;
}): any {
  const channel = supabase.channel(`workspace_${input.workspaceId}`, {
    config: { presence: { key: input.sessionId } },
  });

  channel
    .on('presence', { event: 'sync' }, () => {
      const users = Object.entries(channel.presenceState()).flatMap(([id, values]: [string, any]) => {
        const presence = values?.[0];
        return presence ? [{ id, name: presence.userName, role: 'User' }] : [];
      });
      input.setActiveUsers(users);
    })
    .on('broadcast', { event: 'typing_start' }, ({ payload }: any) => {
      input.setTypingUsers(previous => previous.some(user => user.userId === payload.userId)
        ? previous
        : [...previous, payload]);
    })
    .on('broadcast', { event: 'typing_end' }, ({ payload }: any) => {
      input.setTypingUsers(previous => previous.filter(user => user.userId !== payload.userId));
    })
    .on('broadcast', { event: 'ai_stream_chunk' }, ({ payload }: any) => {
      input.setMessages(previous => mergeAiChunk(previous, payload));
    })
    .on('broadcast', { event: 'ai_stream_end' }, ({ payload }: any) => {
      input.setMessages(previous => mergeAiEnd(previous, payload));
    })
    .subscribe(async (status: string) => {
      if (status === 'SUBSCRIBED') await channel.track({ userName: input.userName });
    });

  return channel;
}

export function subscribeDocumentRealtime(
  workspaceId: string,
  setDocument: (document: DocumentData | null) => void,
): any {
  return supabase
    .channel(`document_${workspaceId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'documents', filter: `workspace_id=eq.${workspaceId}` },
      (payload: any) => {
        if (payload.eventType === 'DELETE') setDocument(null);
        else if (payload.new?.id === 'main') setDocument(payload.new.content ?? null);
      },
    )
    .subscribe();
}

export function unsubscribeRealtime(channel: any): void {
  if (channel) supabase.removeChannel(channel);
}
