import { useEffect, useRef } from 'react';
import { db, doc, onSnapshot, getDocFromServer, setDoc, serverTimestamp } from '../db';
import { supabase } from '../supabase';
import { useMessageStore } from '../store/useMessageStore';
import { ActiveUser, TypingUser, DocumentData, Message } from '../types';
import { ZERO_TOUCH_AGENTS, MOCK_COLLABORATORS } from '../constants';
import { saveDocumentAndVersion } from '../utils/documentUtils';
import { User } from './useAuth';
import { useStore } from '../store/useStore';

export function useWorkspaceSync(
  currentWorkspaceId: string | null,
  setCurrentWorkspaceId: (id: string | null) => void,
  user: User | null,
  isAuthReady: boolean
) {
  const activeUsers = useStore(state => state.activeUsers);
  const setActiveUsers = useStore(state => state.setActiveUsers);
  const typingUsers = useStore(state => state.typingUsers);
  const setTypingUsers = useStore(state => state.setTypingUsers);
  const isLoadingWorkspace = useStore(state => state.isLoadingWorkspace);
  const setIsLoadingWorkspace = useStore(state => state.setIsLoadingWorkspace);
  const documentContent = useStore(state => state.documentContent);
  const setDocumentContent = useStore(state => state.setDocumentContent);
  const isZeroTouchMode = useStore(state => state.isZeroTouchMode);
  const setIsAiActive = useStore(state => state.setIsAiActive);
  
  const channelRef = useRef<any>(null);
  const sessionId = useRef(Math.random().toString(36).substring(7));
  const currentWorkspaceIdRef = useRef<string | null>(null);

  const messages = useMessageStore(state => state.messagesByWorkspace[currentWorkspaceId || '']) || [];

  useEffect(() => {
    currentWorkspaceIdRef.current = currentWorkspaceId;
  }, [currentWorkspaceId]);

  const setMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    const id = currentWorkspaceIdRef.current;
    if (id) {
      if (typeof updater === 'function') {
        useMessageStore.getState().setMessages(id, updater);
      } else {
        useMessageStore.getState().setMessages(id, () => updater);
      }
    }
  };

  // Manage AI active state based on workspace and zero touch mode
  useEffect(() => {
    if (currentWorkspaceId && !isZeroTouchMode) {
      setIsAiActive(true);
    }
  }, [currentWorkspaceId, isZeroTouchMode, setIsAiActive]);

  useEffect(() => {
    if (isZeroTouchMode) {
      setIsAiActive(false);
    }
  }, [isZeroTouchMode, setIsAiActive]);

  // Join room when workspace changes and fetch messages
  useEffect(() => {
    if (currentWorkspaceId && user && isAuthReady) {
      // 1. Load from cache immediately for instant UI if store is empty
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
      
      // Only show loading spinner if we don't have messages in memory or cache AND we aren't already listening
      if (!hasExistingMessages && !isAlreadyListening) {
        setIsLoadingWorkspace(true);
      }
      
      setTypingUsers([]);

      // Initialize Supabase Channel
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
      let messagesLoaded = hasExistingMessages || isAlreadyListening; // If we already have messages or are listening, consider them loaded
      let documentLoaded = false;

      const checkLoading = () => {
        if (workspaceLoaded && messagesLoaded && documentLoaded) {
          setIsLoadingWorkspace(false);
        }
      };

      const workspaceRef = doc(db, 'workspaces', currentWorkspaceId);
      const unsubscribeWorkspace = onSnapshot(workspaceRef, (docSnap) => {
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
        supabase.removeChannel(channel);
        channelRef.current = null;
        unsubscribeWorkspace();
        unsubscribeDocument();
        useMessageStore.getState().unsubscribeFromWorkspace(currentWorkspaceId);
      };
    } else {
      setDocumentContent(null);
    }
  }, [currentWorkspaceId, user, isAuthReady]);

  // Save messages to cache
  useEffect(() => {
    if (currentWorkspaceId && messages.length > 0) {
      localStorage.setItem(`jetwork_messages_${currentWorkspaceId}`, JSON.stringify(messages));
    }
  }, [messages, currentWorkspaceId]);

  // Save document to cache
  useEffect(() => {
    if (currentWorkspaceId && documentContent) {
      localStorage.setItem(`jetwork_document_${currentWorkspaceId}`, JSON.stringify(documentContent));
    }
  }, [documentContent, currentWorkspaceId]);

  const generateItemCode = () => {
    return 'JET-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  };

  // Restore active workspace state on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('shareId');

    if (shareId && user) {
      // Fetch shared workspace
      const fetchShared = async () => {
        try {
          const shareRef = doc(db, 'shared_analyses', shareId);
          const shareSnap = await getDocFromServer(shareRef);
          
          if (shareSnap.exists()) {
            const data = shareSnap.data();
            const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
            
            // Check if default project exists, if not create it
            const defaultProjectRef = doc(db, 'projects', 'default-project');
            const defaultProjectSnap = await getDocFromServer(defaultProjectRef);
            
            if (!defaultProjectSnap.exists()) {
              await setDoc(defaultProjectRef, {
                name: 'Varsayılan Proje',
                description: '',
                ownerId: user.uid,
                createdAt: serverTimestamp(),
                lastUpdated: serverTimestamp()
              });
            }

            // Create the workspace
            await setDoc(doc(db, 'workspaces', newId), {
              projectId: 'default-project',
              issueKey: generateItemCode(),
              title: 'Paylaşılan Çalışma Alanı',
              type: 'Development',
              status: 'Draft',
              ownerId: user.uid,
              collaborators: MOCK_COLLABORATORS,
              createdAt: serverTimestamp(),
              lastUpdated: serverTimestamp()
            });
            
            // Save document
            if (data.data) {
              await saveDocumentAndVersion(newId, 'initial', data.data);
            }
            
            setCurrentWorkspaceId(newId);
            setDocumentContent(data.data);
            
            // Remove shareId from URL
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (error) {
          console.error("Error fetching shared workspace:", error);
        }
      };
      fetchShared();
    }
  }, [user, setCurrentWorkspaceId]);

  return {
    activeUsers,
    typingUsers,
    isLoadingWorkspace,
    documentContent,
    setDocumentContent,
    messages,
    setMessages,
    channelRef
  };
}
