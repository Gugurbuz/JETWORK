import { create } from 'zustand';
import { Message } from '../types';
import { db, collection, query, orderBy, onSnapshot } from '../db';

interface MessageStore {
  messagesByWorkspace: Record<string, Message[]>;
  activeListeners: Record<string, () => void>;
  
  // Initialize or get messages for a workspace
  getMessages: (workspaceId: string) => Message[];
  
  // Start listening to a workspace if not already listening
  subscribeToWorkspace: (workspaceId: string, onLoaded?: () => void) => void;
  
  // Stop listening to a workspace
  unsubscribeFromWorkspace: (workspaceId: string) => void;
  
  // Add a temporary/optimistic message
  addOptimisticMessage: (workspaceId: string, message: Message) => void;
  
  // Update messages (used internally by the listener or for optimistic updates)
  setMessages: (workspaceId: string, updater: (prev: Message[]) => Message[]) => void;
  
  // Clear all messages and listeners (e.g., on logout)
  clearAll: () => void;
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
          [workspaceId]: newMessages
        }
      };
    });
  },

  addOptimisticMessage: (workspaceId: string, message: Message) => {
    get().setMessages(workspaceId, (prev) => {
      // Don't add if it already exists
      if (prev.some(m => m.id === message.id)) return prev;
      return [...prev, message].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    });
  },

  subscribeToWorkspace: (workspaceId: string, onLoaded?: () => void) => {
    const { activeListeners, setMessages } = get();
    
    // If already listening, just trigger onLoaded and return
    if (activeListeners[workspaceId]) {
      if (onLoaded) onLoaded();
      return;
    }

    const messagesQuery = query(collection(db, 'workspaces', workspaceId, 'messages'), orderBy('createdAt', 'asc'));
    
    const unsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toMillis() || Date.now()
      })) as Message[];
      
      setMessages(workspaceId, (prev) => {
        // Keep typing messages and optimistic messages (those without a server timestamp yet, or very recent ones)
        const typingMessages = prev.filter(m => m.isTyping);
        const optimisticMessages = prev.filter(m => 
          !m.isTyping && 
          !msgs.some(sm => sm.id === m.id) && 
          (Date.now() - (m.createdAt || 0) < 5000) // Keep optimistic messages for up to 5 seconds
        );
        
        const newMsgs = [...msgs, ...optimisticMessages];
        
        typingMessages.forEach(tm => {
          if (!newMsgs.some(m => m.id === tm.id)) {
            newMsgs.push(tm);
          }
        });
        
        return newMsgs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      });

      if (onLoaded) onLoaded();
    }, (error) => {
      console.error("Error fetching messages:", error);
      if (onLoaded) onLoaded();
    });

    set((state) => ({
      activeListeners: {
        ...state.activeListeners,
        [workspaceId]: unsubscribe
      }
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
  }
}));
