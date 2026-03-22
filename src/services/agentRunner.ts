import { useStore } from '../store/useStore';
import { Message, DocumentData } from '../types';
import { callGemini, callAiWithRetry } from './geminiService';
import { AgentOrchestrator } from './AgentOrchestrator';
import { db, doc, setDoc, serverTimestamp } from '../db';
import { useMessageStore } from '../store/useMessageStore';
import { ZERO_TOUCH_AGENTS } from '../constants';

// We need to pass dependencies or use the store directly.
// Since it's a service, it's better to pass the required state/actions or use getState().

export const runZeroTouchMode = async (
  newUserMessage: Message, 
  attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[]
) => {
  const state = useStore.getState();
  const { 
    currentWorkspaceId, 
    activeZeroTouchRoles, 
    documentContent, 
    setMessages, 
    setIsDiscussing, 
    setDocumentContent, 
    setAiHandRaised,
    user
  } = state;

  if (!currentWorkspaceId) return;

  setIsDiscussing(true);
  
  try {
    const orchestrator = new AgentOrchestrator(
      activeZeroTouchRoles,
      documentContent,
      (agentRole, message, actionSummary, isDocumentationPhase, requiresUserInput) => {
        const msgId = Date.now().toString() + Math.random().toString(36).substring(7);
        const newMsg: Message = {
          id: msgId,
          text: message,
          senderId: agentRole,
          senderName: agentRole,
          senderRole: agentRole,
          createdAt: Date.now(),
          isAi: true,
          actionSummary,
          isDocumentationPhase,
          requiresUserInput
        };
        
        setMessages(prev => [...prev, newMsg]);

        // Save to DB
        setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', msgId), {
          ...newMsg,
          createdAt: serverTimestamp()
        }).catch(err => console.error("Error saving AI message:", err));

        if (requiresUserInput) {
          setAiHandRaised(agentRole);
          setIsDiscussing(false);
        }
      },
      (updatedDocument) => {
        setDocumentContent(updatedDocument);
        
        // Save document to DB
        const docRef = doc(db, 'workspaces', currentWorkspaceId, 'documents', 'main');
        setDoc(docRef, {
          content: updatedDocument,
          lastUpdated: serverTimestamp(),
          updatedBy: 'AI Orchestrator'
        }, { merge: true }).catch(err => console.error("Error saving document:", err));
      }
    );

    // Get current messages from message store
    const currentMessages = useMessageStore.getState().messagesByWorkspace[currentWorkspaceId] || [];
    await orchestrator.runDiscussion(currentMessages, newUserMessage);

  } catch (error) {
    console.error("Zero-touch mode error:", error);
    const errorMsgId = Date.now().toString();
    const errorMsg: Message = {
      id: errorMsgId,
      text: "Üzgünüm, tartışma sırasında bir hata oluştu. Lütfen tekrar deneyin.",
      senderId: 'system',
      senderName: 'Sistem',
      senderRole: 'System',
      createdAt: Date.now(),
      isAi: true,
      isError: true
    };
    setMessages(prev => [...prev, errorMsg]);
  } finally {
    // Only set to false if not waiting for user input
    if (!useStore.getState().aiHandRaised) {
      setIsDiscussing(false);
    }
  }
};
