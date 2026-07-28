import { useEffect, useRef } from 'react';
import { useMessageStore } from '../store/useMessageStore';
import { Message } from '../types';
import { User } from './useAuth';
import { useDataStore } from '../store/useDataStore';
import { useDocumentStore } from '../store/useDocumentStore';
import { loadProjectMemory, loadProjectMemoryItems } from '../services/projectMemoryRepository';
import { importSharedAnalysis } from '../services/sharedAnalysisImportService';
import {
  cacheWorkspaceDocument,
  cacheWorkspaceMemory,
  cacheWorkspaceMessages,
  readWorkspaceCache,
} from '../services/workspaceCache';
import { isWorkspaceResultCurrent, loadWorkspaceDocument, workspaceExists } from '../services/workspaceRepository';
import {
  subscribeDocumentRealtime,
  subscribeWorkspaceRealtime,
  unsubscribeRealtime,
} from '../services/workspaceRealtimeTransport';

export function useWorkspaceSync(
  currentWorkspaceId: string | null,
  setCurrentWorkspaceId: (id: string | null) => void,
  user: User | null,
  isAuthReady: boolean
) {
  const activeUsers = useDataStore(state => state.activeUsers);
  const setActiveUsers = useDataStore(state => state.setActiveUsers);
  const typingUsers = useDataStore(state => state.typingUsers);
  const setTypingUsers = useDataStore(state => state.setTypingUsers);
  const isLoadingWorkspace = useDataStore(state => state.isLoadingWorkspace);
  const setIsLoadingWorkspace = useDataStore(state => state.setIsLoadingWorkspace);
  const documentContent = useDocumentStore(state => state.documentContent);
  const setDocumentContent = useDocumentStore(state => state.setDocumentContent);
  const setProjectMemory = useDocumentStore(state => state.setProjectMemory);
  const setMemoryItems = useDocumentStore(state => state.setMemoryItems);
  const setLastAnalystContextDebug = useDocumentStore(state => state.setLastAnalystContextDebug);
  const isZeroTouchMode = useDocumentStore(state => state.isZeroTouchMode);
  const setIsAiActive = useDocumentStore(state => state.setIsAiActive);

  const channelRef = useRef<any>(null);
  const sessionId = useRef(crypto.randomUUID());
  const currentWorkspaceIdRef = useRef<string | null>(null);

  const messages = useMessageStore(state => state.messagesByWorkspace[currentWorkspaceId || '']) || [];

  useEffect(() => {
    currentWorkspaceIdRef.current = currentWorkspaceId;
  }, [currentWorkspaceId]);

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
      setMemoryItems([]);
      setLastAnalystContextDebug(null);
      return;
    }

    let memoryLoadCancelled = false;
    const setWorkspaceMessages = (updater: Message[] | ((previous: Message[]) => Message[])): void => {
      useMessageStore.getState().setMessages(
        currentWorkspaceId,
        typeof updater === 'function' ? updater : () => updater,
      );
    };

    let existingMessages = useMessageStore.getState().messagesByWorkspace[currentWorkspaceId];
    let hasExistingMessages = existingMessages && existingMessages.length > 0;
    const isAlreadyListening = !!useMessageStore.getState().activeListeners[currentWorkspaceId];

    const cache = readWorkspaceCache(currentWorkspaceId);
    if (!hasExistingMessages && !isAlreadyListening && cache.messages?.length) {
      setWorkspaceMessages(cache.messages);
      hasExistingMessages = true;
    }
    setDocumentContent(cache.document || null);
    setProjectMemory(cache.memory || {});
    setMemoryItems([]);
    setLastAnalystContextDebug(null);

    Promise.all([
      loadProjectMemory(currentWorkspaceId),
      loadProjectMemoryItems(currentWorkspaceId),
    ])
      .then(([memory, items]) => {
        if (memoryLoadCancelled || currentWorkspaceIdRef.current !== currentWorkspaceId) return;
        setProjectMemory(memory);
        setMemoryItems(items);
        cacheWorkspaceMemory(currentWorkspaceId, memory);
      })
      .catch(error => {
        console.error('Failed to load persistent project memory:', error);
      });

    if (!hasExistingMessages && !isAlreadyListening) {
      setIsLoadingWorkspace(true);
    }

    setTypingUsers([]);

    const channel = subscribeWorkspaceRealtime({
      workspaceId: currentWorkspaceId,
      sessionId: sessionId.current,
      userName: user.name,
      setActiveUsers,
      setTypingUsers,
      setMessages: setWorkspaceMessages,
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

    workspaceExists(currentWorkspaceId)
      .then(() => {
        workspaceLoaded = true;
        checkLoading();
      })
      .catch(error => {
        console.error('Error fetching workspace metadata:', error);
        workspaceLoaded = true;
        checkLoading();
      });

    loadWorkspaceDocument(currentWorkspaceId)
      .then(document => {
        if (isWorkspaceResultCurrent(currentWorkspaceId, currentWorkspaceIdRef.current)) {
          setDocumentContent(document);
        }
      })
      .catch(error => console.error('Error fetching document:', error))
      .finally(() => {
        documentLoaded = true;
        checkLoading();
      });

    const documentChannel = subscribeDocumentRealtime(currentWorkspaceId, document => {
      if (isWorkspaceResultCurrent(currentWorkspaceId, currentWorkspaceIdRef.current)) {
        setDocumentContent(document);
      }
    });

    useMessageStore.getState().subscribeToWorkspace(currentWorkspaceId, () => {
      messagesLoaded = true;
      checkLoading();
    });

    return () => {
      memoryLoadCancelled = true;
      unsubscribeRealtime(channel);
      unsubscribeRealtime(documentChannel);
      channelRef.current = null;
      useMessageStore.getState().unsubscribeFromWorkspace(currentWorkspaceId);
    };
  }, [currentWorkspaceId, user, isAuthReady]);

  useEffect(() => {
    if (currentWorkspaceId && messages.length > 0) {
      cacheWorkspaceMessages(currentWorkspaceId, messages);
    }
  }, [messages, currentWorkspaceId]);

  useEffect(() => {
    if (currentWorkspaceId && documentContent) {
      cacheWorkspaceDocument(currentWorkspaceId, documentContent);
    }
  }, [documentContent, currentWorkspaceId]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shareToken = urlParams.get('share');
    if (!shareToken || !user) return;

    importSharedAnalysis(shareToken, user)
      .then(result => {
        setCurrentWorkspaceId(result.workspaceId);
        setDocumentContent(result.document);
        window.history.replaceState({}, document.title, window.location.pathname);
      })
      .catch(error => {
        console.error('Error importing shared analysis:', error);
      });
  }, [user, setCurrentWorkspaceId, setDocumentContent]);

  return {
    activeUsers,
    typingUsers,
    isLoadingWorkspace,
    documentContent,
    setDocumentContent,
    messages,
    channelRef,
  };
}
