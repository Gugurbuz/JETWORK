import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { supabase } from '../supabase';
import { db, doc, onSnapshot } from '../db';
import { useMessageStore } from '../store/useMessageStore';
import { ActiveUser } from '../types';
import { ZERO_TOUCH_AGENTS } from '../constants';

export const useWorkspaceChannel = () => {
  const { 
    currentWorkspaceId, 
    user, 
    isAuthReady, 
    setIsLoadingWorkspace, 
    setActiveUsers, 
    setTypingUsers, 
    setMessages,
    setDocumentContent
  } = useStore();
  
  const channelRef = useRef<any>(null);
  const sessionId = useRef(Math.random().toString(36).substring(7));

  useEffect(() => {
    if (currentWorkspaceId && user && isAuthReady) {
      let existingMessages = useMessageStore.getState().messagesByWorkspace[currentWorkspaceId];
      let hasExistingMessages = existingMessages && existingMessages.length > 0;
      const isAlreadyListening = !!useMessageStore.getState().activeListeners[currentWorkspaceId];
      
      if (!hasExistingMessages && !isAlreadyListening) {
        const cachedMessages = localStorage.getItem(`jetwork_messages_${currentWorkspaceId}`);
        if (cachedMessages) {
          try {
            const parsed = JSON.parse(cachedMessages);
            if (parsed && parsed.length > 0) {
              setMessages(parsed);
              hasExistingMessages = true;
            }
          } catch (e) {
            console.error("Failed to parse cached messages", e);
          }
        }
      }
      
      const cachedDoc = localStorage.getItem(`jetwork_document_${currentWorkspaceId}`);
      if (cachedDoc) {
        try {
          setDocumentContent(JSON.parse(cachedDoc));
        } catch (e) {
          console.error("Failed to parse cached document", e);
        }
      }
      
      if (!hasExistingMessages && !isAlreadyListening) {
        setIsLoadingWorkspace(true);
      }
      
      const channel = supabase.channel(`workspace_${currentWorkspaceId}`, {
        config: {
          presence: {
            key: sessionId.current,
          },
        },
      });

      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          const users: ActiveUser[] = [];
          for (const key in state) {
            const presence = state[key][0] as any;
            if (presence) {
              users.push({ id: key, name: presence.userName, role: 'User' });
            }
          }
          setActiveUsers(users);
        })
        .on('broadcast', { event: 'typing_start' }, ({ payload }) => {
          setTypingUsers(prev => {
            if (!prev.find(u => u.userId === payload.userId)) return [...prev, payload];
            return prev;
          });
        })
        .on('broadcast', { event: 'typing_end' }, ({ payload }) => {
          setTypingUsers(prev => prev.filter(u => u.userId !== payload.userId));
        })
        .on('broadcast', { event: 'ai_stream_chunk' }, ({ payload: data }) => {
          setMessages(prev => {
            const exists = prev.find(m => m.id === data.id);
            const derivedSenderName = data.senderName || (data.agentRole ? ZERO_TOUCH_AGENTS.find(a => a.role === data.agentRole)?.name || 'JetWork AI' : undefined);
            const derivedSenderRole = data.senderRole || (data.agentRole ? ZERO_TOUCH_AGENTS.find(a => a.role === data.agentRole)?.name || 'Sistem Asistanı' : undefined);

            if (exists) {
              return prev.map(m => m.id === data.id ? { 
                ...m, 
                text: data.text, 
                thinkingText: data.thinkingText,
                score: data.score,
                scoreExplanation: data.scoreExplanation,
                questions: data.questions,
                ...(derivedSenderName ? { senderName: derivedSenderName } : {}),
                ...(derivedSenderRole ? { senderRole: derivedSenderRole } : {}),
                ...(data.agentRole ? { agentRole: data.agentRole } : {}),
                ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
              } : m);
            } else {
              return [...prev, {
                id: data.id,
                role: 'model',
                text: data.text,
                thinkingText: data.thinkingText,
                senderName: derivedSenderName || 'JetWork AI',
                senderRole: derivedSenderRole || 'Sistem Asistanı',
                agentRole: data.agentRole,
                score: data.score,
                scoreExplanation: data.scoreExplanation,
                questions: data.questions,
                isTyping: true,
                createdAt: Date.now(),
                ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
              }];
            }
          });
        })
        .on('broadcast', { event: 'ai_stream_end' }, ({ payload: data }) => {
          setMessages(prev => {
            const exists = prev.find(m => m.id === data.id);
            if (exists) {
              return prev.map(m => m.id === data.id ? { 
                ...m, 
                text: data.text, 
                thinkingText: data.thinkingText, 
                isTyping: false,
                score: data.score,
                scoreExplanation: data.scoreExplanation,
                questions: data.questions,
                createdAt: Date.now(),
                ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
              } : m);
            } else {
              return [...prev, {
                id: data.id,
                role: 'model',
                text: data.text,
                thinkingText: data.thinkingText,
                senderName: data.senderName || 'JetWork AI',
                senderRole: data.senderRole || 'Sistem Asistanı',
                agentRole: data.agentRole,
                score: data.score,
                scoreExplanation: data.scoreExplanation,
                questions: data.questions,
                isTyping: false,
                createdAt: Date.now(),
                ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
              }];
            }
          });
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({ userName: user.name });
          }
        });

      channelRef.current = channel;
      
      let workspaceLoaded = false;
      let messagesLoaded = hasExistingMessages || isAlreadyListening;
      let documentLoaded = false;

      const checkLoading = () => {
        if (workspaceLoaded && messagesLoaded && documentLoaded) {
          setIsLoadingWorkspace(false);
        }
      };

      const workspaceRef = doc(db, 'workspaces', currentWorkspaceId);
      const unsubscribeWorkspace = onSnapshot(workspaceRef, () => {
        workspaceLoaded = true;
        checkLoading();
      }, (error) => {
        console.error("Error fetching workspace:", error);
        workspaceLoaded = true;
        checkLoading();
      });

      const documentRef = doc(db, 'workspaces', currentWorkspaceId, 'documents', 'main');
      const unsubscribeDocument = onSnapshot(documentRef, (docSnap) => {
        if (docSnap.exists()) {
          setDocumentContent(docSnap.data().content || null);
        } else {
          setDocumentContent(null);
        }
        documentLoaded = true;
        checkLoading();
      }, (error) => {
        console.error("Error fetching document:", error);
        documentLoaded = true;
        checkLoading();
      });

      useMessageStore.getState().subscribeToWorkspace(currentWorkspaceId, () => {
        messagesLoaded = true;
        checkLoading();
      });

      return () => {
        unsubscribeWorkspace();
        unsubscribeDocument();
        useMessageStore.getState().unsubscribeFromWorkspace(currentWorkspaceId);
        channel.unsubscribe();
        channelRef.current = null;
      };
    }
  }, [currentWorkspaceId, user, isAuthReady, setMessages, setDocumentContent, setIsLoadingWorkspace, setActiveUsers, setTypingUsers]);

  return { channelRef, sessionId };
};
