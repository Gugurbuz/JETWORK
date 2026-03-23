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
    // Get current messages from message store
    const currentMessages = useMessageStore.getState().messagesByWorkspace[currentWorkspaceId] || [];
    
    // Add the new user message to the history for the orchestrator
    const history = [...currentMessages, newUserMessage];

    const wrappedCallGemini = async (params: any) => {
      return callAiWithRetry(() => callGemini(params));
    };

    const orchestrator = new AgentOrchestrator(
      wrappedCallGemini,
      documentContent,
      history,
      activeZeroTouchRoles
    );

    let isDone = false;
    let maxSteps = 10;
    let stepCount = 0;

    while (!isDone && stepCount < maxSteps) {
      stepCount++;
      
      const result = await orchestrator.step(
        (agent, reason) => {
          console.log(`[Orchestrator] Next Agent: ${agent}, Reason: ${reason}`);
        }
      );

      if (result.nextAgent === 'DONE' || result.nextAgent === 'USER') {
        isDone = true;
        if (result.nextAgent === 'USER') {
          setAiHandRaised('Orchestrator');
        }
      }

      const sender = (result.nextAgent === 'USER' || result.nextAgent === 'DONE') ? 'Orchestrator' : result.nextAgent;

      // Save the agent's message
      const msgId = Date.now().toString() + Math.random().toString(36).substring(7);
      const newMsg: Message = {
        id: msgId,
        text: result.finalText || result.actionSummary || '',
        role: 'model',
        senderName: sender,
        senderRole: sender,
        createdAt: Date.now(),
        actionSummary: result.actionSummary,
        questions: result.questions && result.questions.length > 0 ? result.questions : undefined
      };
      
      setMessages(prev => [...prev, newMsg]);

      // Save to DB
      setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', msgId), {
        ...newMsg,
        createdAt: serverTimestamp()
      }).catch(err => console.error("Error saving AI message:", err));

      if (result.requiresUserInput) {
        setAiHandRaised(result.nextAgent);
        isDone = true;
      }

      // Update document if changed
      if (result.updatedDocument) {
        setDocumentContent(result.updatedDocument);
        
        // Save document to DB
        const docRef = doc(db, 'workspaces', currentWorkspaceId, 'documents', 'main');
        setDoc(docRef, {
          content: result.updatedDocument,
          lastUpdated: serverTimestamp(),
          updatedBy: sender
        }).catch(err => console.error("Error saving document:", err));
      }
      
      if (isDone) {
        break;
      }
    }

  } catch (error) {
    console.error("Zero-touch mode error:", error);
    const errorMsgId = Date.now().toString();
    const errorMsg: Message = {
      id: errorMsgId,
      text: "Üzgünüm, tartışma sırasında bir hata oluştu. Lütfen tekrar deneyin.",
      role: 'model',
      senderName: 'Sistem',
      senderRole: 'System',
      createdAt: Date.now(),
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
