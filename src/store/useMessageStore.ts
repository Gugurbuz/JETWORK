import { create } from 'zustand';
import { Message } from '../types';
import { supabase } from '../supabase';
import { rowsToCamel, rowToCamel } from '../lib/mapping';

interface MessageStore {
  messagesByWorkspace: Record<string, Message[]>;
  activeListeners: Record<string, () => void>;

  getMessages: (workspaceId: string) => Message[];
  subscribeToWorkspace: (workspaceId: string, onLoaded?: () => void) => void;
  unsubscribeFromWorkspace: (workspaceId: string) => void;
  addOptimisticMessage: (workspaceId: string, message: Message) => void;
  setMessages: (workspaceId: string, updater: (prev: Message[]) => Message[]) => void;
  clearAll: () => void;
}

async function loadMessages(workspaceId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('Error fetching messages:', error);
    return [];
  }
  return rowsToCamel<Message>(data);
}

export const useMessageStore = create<MessageStore>((set, get) => ({
  messagesByWorkspace: {},
  activeListeners: {},

  getMessages: (workspaceId: string) => {
    return get().messagesByWorkspace[workspaceId] || [];
  },

  setMessages: (workspaceId: string, updater: (prev: Message[]) => Message[]) => {
    set((state) => {
      const currentMessages = state.messagesByWorkspace[workspaceId] || [];
      const newMessages = updater(currentMessages);
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

            const incoming = rowToCamel<Message>(payload.new);
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

  clearAll: () => {
    const { activeListeners } = get();
    Object.values(activeListeners).forEach(unsubscribe => unsubscribe());
    set({ messagesByWorkspace: {}, activeListeners: {} });
  },
}));
