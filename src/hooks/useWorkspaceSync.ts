import { useEffect, useRef } from 'react';
import { supabase } from '../supabase';
import { useMessageStore } from '../store/useMessageStore';
import { ActiveUser, Message } from '../types';
import { ZERO_TOUCH_AGENTS, MOCK_COLLABORATORS } from '../constants';
import { saveDocumentAndVersion } from '../utils/documentUtils';
import { User } from './useAuth';
import { useStore } from '../store/useStore';
import { nowIso } from '../lib/mapping';

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
  const setProjectMemory = useStore(state => state.setProjectMemory);
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

  useEffect(() => {
    if (!currentWorkspaceId || !user || !isAuthReady) {
      setDocumentContent(null);
      setProjectMemory({});
      return;
    }

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
          console.error('Failed to parse cached messages', e);
        }
      }
    }

    const cachedDoc = localStorage.getItem(`jetwork_document_${currentWorkspaceId}`);
    if (cachedDoc) {
      try {
        setDocumentContent(JSON.parse(cachedDoc));
      } catch (e) {
        console.error('Failed to parse cached document', e);
      }
    }

    const cachedMemory = localStorage.getItem(`jetwork_project_memory_${currentWorkspaceId}`);
    if (cachedMemory) {
      try {
        setProjectMemory(JSON.parse(cachedMemory));
      } catch (e) {
        console.error('Failed to parse cached project memory', e);
        setProjectMemory({});
      }
    } else {
      setProjectMemory({});
    }

    if (!hasExistingMessages && !isAlreadyListening) {
      setIsLoadingWorkspace(true);
    }

    setTypingUsers([]);

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
          const presence = (state[key][0] as any);
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
              ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {}),
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
              ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {}),
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
              ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {}),
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
              ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {}),
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

    // Load workspace once (realtime workspace changes handled in useWorkspaceChannel)
    supabase
      .from('workspaces')
      .select('id')
      .eq('id', currentWorkspaceId)
      .maybeSingle()
      .then(() => {
        workspaceLoaded = true;
        checkLoading();
      });

    // Load document and subscribe to changes
    const loadDocument = async () => {
      const { data, error } = await supabase
        .from('documents')
        .select('content')
        .eq('id', 'main')
        .eq('workspace_id', currentWorkspaceId)
        .maybeSingle();
      if (error) {
        console.error('Error fetching document:', error);
      }
      setDocumentContent(data?.content ?? null);
      documentLoaded = true;
      checkLoading();
    };
    loadDocument();

    const documentChannel = supabase
      .channel(`document_${currentWorkspaceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'documents', filter: `workspace_id=eq.${currentWorkspaceId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            setDocumentContent(null);
          } else {
            const newRow = payload.new as any;
            if (newRow?.id === 'main') {
              setDocumentContent(newRow.content ?? null);
            }
          }
        }
      )
      .subscribe();

    useMessageStore.getState().subscribeToWorkspace(currentWorkspaceId, () => {
      messagesLoaded = true;
      checkLoading();
    });

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(documentChannel);
      channelRef.current = null;
      useMessageStore.getState().unsubscribeFromWorkspace(currentWorkspaceId);
    };
  }, [currentWorkspaceId, user, isAuthReady]);

  useEffect(() => {
    if (currentWorkspaceId && messages.length > 0) {
      localStorage.setItem(`jetwork_messages_${currentWorkspaceId}`, JSON.stringify(messages));
    }
  }, [messages, currentWorkspaceId]);

  useEffect(() => {
    if (currentWorkspaceId && documentContent) {
      localStorage.setItem(`jetwork_document_${currentWorkspaceId}`, JSON.stringify(documentContent));
    }
  }, [documentContent, currentWorkspaceId]);

  const generateItemCode = () => {
    return 'JET-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('shareId');

    if (shareId && user) {
      const fetchShared = async () => {
        try {
          const { data: share, error } = await supabase
            .from('shared_analyses')
            .select('*')
            .eq('id', shareId)
            .maybeSingle();
          if (error) throw error;
          if (!share) return;

          const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);

          const { data: defaultProject } = await supabase
            .from('projects')
            .select('id')
            .eq('id', 'default-project')
            .maybeSingle();

          if (!defaultProject) {
            await supabase.from('projects').insert({
              id: 'default-project',
              name: 'Varsayılan Proje',
              description: '',
              owner_id: user.uid,
              created_at: nowIso(),
              last_updated: nowIso(),
            });
          }

          await supabase.from('workspaces').insert({
            id: newId,
            project_id: 'default-project',
            issue_key: generateItemCode(),
            title: 'Paylaşılan Çalışma Alanı',
            type: 'Development',
            status: 'Draft',
            owner_id: user.uid,
            collaborators: MOCK_COLLABORATORS,
            created_at: nowIso(),
            last_updated: nowIso(),
          });

          if (share.data) {
            await saveDocumentAndVersion(newId, 'initial', share.data);
          }

          setCurrentWorkspaceId(newId);
          setDocumentContent(share.data);

          window.history.replaceState({}, document.title, window.location.pathname);
        } catch (error) {
          console.error('Error fetching shared workspace:', error);
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
    channelRef,
  };
}
