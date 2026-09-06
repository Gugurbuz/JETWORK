import { create } from 'zustand';
import { Message } from '../types';
import { supabase } from '../supabase';
import { rowsToCamel, rowToCamel } from '../lib/mapping';
import { FEATURE_FLAGS } from '../lib/featureFlags';
import { parseAssistantPresentationMetadata } from '../services/assistantPresentationMetadata';
import { decodeAgentWorkEnvelope } from '../services/agentWorkPersistence';
import { registerPersistedAgentWorkEvents } from '../services/agentWorkLiveStream';

interface MessageStore {
  messagesByWorkspace: Record<string, Message[]>;
  activeListeners: Record<string, () => void>;
  loadErrorsByWorkspace: Record<string, string | null>;
  loadingByWorkspace: Record<string, boolean>;

  getMessages: (workspaceId: string) => Message[];
  subscribeToWorkspace: (workspaceId: string, onLoaded?: () => void) => void;
  unsubscribeFromWorkspace: (workspaceId: string) => void;
  retryWorkspace: (workspaceId: string) => void;
  addOptimisticMessage: (workspaceId: string, message: Message) => void;
  setMessages: (workspaceId: string, updater: (prev: Message[]) => Message[]) => void;
  clearAll: () => void;
}

function sanitizeAssistantPresentation(message: Message): Message {
  if (message.role !== 'model') return message;
  const envelope = decodeAgentWorkEnvelope(message.rawResponse);
  const hasPresentationMetadata = /<jetwork_meta>/iu.test(message.text || '');
  const presentation = hasPresentationMetadata ? parseAssistantPresentationMetadata(message.text) : null;
  const workEvents = envelope?.workEvents.length ? envelope.workEvents : message.workEvents;
  if (workEvents?.length) registerPersistedAgentWorkEvents(message.createdAt, workEvents);
  return {
    ...message,
    text: presentation?.visibleText ?? message.text,
    thinkingText: message.thinkingText || presentation?.workSummary,
    questions: message.questions?.length ? message.questions : presentation?.questions,
    actionSummary: message.actionSummary || presentation?.actionSummary,
    workEvents,
    // Hide the transport envelope from application consumers while preserving
    // any real raw response that was nested inside it.
    rawResponse: envelope ? envelope.rawResponse : message.rawResponse,
  };
}

export function normalizeRuntimePersistenceState(message: Message): Message {
  if (
    !FEATURE_FLAGS.SINGLE_ASSISTANT_RUNTIME
    || message.role !== 'model'
    || !message.provider
    || !message.persistenceStatus
  ) {
    return message;
  }

  // A successful runtime turn is not publicly complete until its message row —
  // including the canonical Agent Work envelope — is durably committed. Keep the
  // work header active while persistence is pending; the answer text can already
  // be visible because streaming is independent from this completion boundary.
  if (message.persistenceStatus === 'pending') {
    return message.isTyping ? message : { ...message, isTyping: true };
  }

  // Once persistence succeeds (or definitively fails), the turn can leave the
  // active state. This prevents a completed/collapsed UI from racing ahead of
  // the durable chronology and makes reload equality a product invariant.
  if ((message.persistenceStatus === 'saved' || message.persistenceStatus === 'failed') && message.isTyping) {
    return { ...message, isTyping: false };
  }

  return message;
}

const normalizeRuntimePersistenceStates = (messages: Message[]): Message[] => (
  messages.map(normalizeRuntimePersistenceState)
);

async function loadMessages(workspaceId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Error fetching messages:', error);
    throw error;
  }
  return rowsToCamel<Message>(data).map(sanitizeAssistantPresentation);
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messagesByWorkspace: {},
  activeListeners: {},
  loadErrorsByWorkspace: {},
  loadingByWorkspace: {},

  getMessages: (workspaceId: string) => {
    return get().messagesByWorkspace[workspaceId] || [];
  },

  setMessages: (workspaceId: string, updater: (prev: Message[]) => Message[]) => {
    set((state) => {
      const currentMessages = state.messagesByWorkspace[workspaceId] || [];
      const newMessages = normalizeRuntimePersistenceStates(updater(currentMessages));
      return {
        messagesByWorkspace: {
          ...state.messagesByWorkspace,
          [workspaceId]: newMessages,
        },
      };
    });
  },

  addOptimisticMessage: (workspaceId: string, message: Message) => {
    get().setMessages(workspaceId, (prev) => {
      if (prev.some(m => m.id === message.id)) return prev;
      return [...prev, message].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    });
  },

  subscribeToWorkspace: (workspaceId: string, onLoaded?: () => void) => {
    const { activeListeners, setMessages } = get();

    if (activeListeners[workspaceId]) {
      if (onLoaded) onLoaded();
      return;
    }

    set(state => ({
      loadingByWorkspace: { ...state.loadingByWorkspace, [workspaceId]: true },
      loadErrorsByWorkspace: { ...state.loadErrorsByWorkspace, [workspaceId]: null },
    }));

    const mergeServerMessages = (msgs: Message[]) => {
      setMessages(workspaceId, (prev) => {
        const typingMessages = prev.filter(m => m.isTyping);
        const optimisticMessages = prev.filter(m =>
          !m.isTyping &&
          !msgs.some(sm => sm.id === m.id) &&
          (Date.now() - (m.createdAt || 0) < 5000)
        );

        const newMsgs = [...msgs, ...optimisticMessages];

        typingMessages.forEach(tm => {
          if (!newMsgs.some(m => m.id === tm.id)) {
            newMsgs.push(tm);
          }
        });

        return newMsgs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      });
    };

    loadMessages(workspaceId).then((msgs) => {
      mergeServerMessages(msgs);
      set(state => ({
        loadingByWorkspace: { ...state.loadingByWorkspace, [workspaceId]: false },
        loadErrorsByWorkspace: { ...state.loadErrorsByWorkspace, [workspaceId]: null },
      }));
      if (onLoaded) onLoaded();
    }).catch(error => {
      set(state => ({
        loadingByWorkspace: { ...state.loadingByWorkspace, [workspaceId]: false },
        loadErrorsByWorkspace: {
          ...state.loadErrorsByWorkspace,
          [workspaceId]: error instanceof Error ? error.message : 'Mesajlar yüklenemedi.',
        },
      }));
      if (onLoaded) onLoaded();
    });

    const channel = supabase
      .channel(`messages-${workspaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `workspace_id=eq.${workspaceId}` },
        (payload) => {
          setMessages(workspaceId, (prev) => {
            if (payload.eventType === 'DELETE') {
              const removedId = (payload.old as any)?.id;
              return prev.filter(m => m.id !== removedId);
            }

            const incomingRow = rowToCamel<Message>(payload.new);
            const incoming = incomingRow ? sanitizeAssistantPresentation(incomingRow) : incomingRow;
            if (!incoming) return prev;

            const idx = prev.findIndex(m => m.id === incoming.id);
            let next: Message[];
            if (idx >= 0) {
              next = [...prev];
              next[idx] = { ...prev[idx], ...incoming };
            } else {
              next = [...prev, incoming];
            }
            return next.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          });
        }
      )
      .subscribe();

    const unsubscribe = () => {
      supabase.removeChannel(channel);
    };

    set((state) => ({
      activeListeners: {
        ...state.activeListeners,
        [workspaceId]: unsubscribe,
      },
    }));
  },

  unsubscribeFromWorkspace: (workspaceId: string) => {
    const { activeListeners } = get();
    const unsubscribe = activeListeners[workspaceId];
    if (unsubscribe) {
      unsubscribe();
      set((state) => {
        const newListeners = { ...state.activeListeners };
        delete newListeners[workspaceId];
        return { activeListeners: newListeners };
      });
    }
  },

  retryWorkspace: (workspaceId: string) => {
    get().unsubscribeFromWorkspace(workspaceId);
    get().subscribeToWorkspace(workspaceId);
  },

  clearAll: () => {
    const { activeListeners } = get();
    Object.values(activeListeners).forEach(unsubscribe => unsubscribe());
    set({ messagesByWorkspace: {}, activeListeners: {}, loadErrorsByWorkspace: {}, loadingByWorkspace: {} });
  },
}));
