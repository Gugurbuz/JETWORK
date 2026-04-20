import { useStore } from '../store/useStore';
import { Message, DocumentData } from '../types';
import { callGemini, callAiWithRetry } from './geminiService';
import { AgentOrchestrator } from './AgentOrchestrator';
import { supabase } from '../supabase';
import { camelToSnake, nowIso } from '../lib/mapping';
import { useMessageStore } from '../store/useMessageStore';

export const runZeroTouchMode = async (
  newUserMessage: Message, 
  attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[]
) => {
  const state = useStore.getState();
  const { 
    currentWorkspaceId, 
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

    const msgId = Date.now().toString() + Math.random().toString(36).substring(7);
    const initialMsg: Message = {
      id: msgId,
      text: '',
      role: 'model',
      senderName: 'JetWork AI',
      senderRole: 'Sistem Asistanı',
      createdAt: Date.now(),
      isTyping: true
    };
    
    setMessages(prev => [...prev, initialMsg]);

    const orchestrator = new AgentOrchestrator(
      wrappedCallGemini,
      documentContent,
      history,
      state.promptSettings
    );

    const result = await orchestrator.processMessage(
      (text, thinking, tokenCount, functionCalls) => {
        let actionSummary = '';
        if (functionCalls && functionCalls.length > 0) {
          const call = functionCalls.find(c => c.name === 'apply_micro_edit');
          if (call && call.args && call.args.explanation) {
            actionSummary = call.args.explanation;
          }
        }

        setMessages(prev => prev.map(m => m.id === msgId ? {
          ...m,
          text,
          thinkingText: thinking,
          tokenCount,
          actionSummary: actionSummary || m.actionSummary
        } : m));
      }
    );

    // Save the agent's message
    const finalMsg: Message = {
      ...initialMsg,
      text: result.explanation || result.finalText || 'İşlem tamamlandı.',
      thinkingText: result.finalThinking,
      isTyping: false,
      actionSummary: result.explanation
    };
    
    setMessages(prev => prev.map(m => m.id === msgId ? finalMsg : m));

    const msgPayload = camelToSnake<Record<string, any>>({ ...finalMsg });
    msgPayload.workspace_id = currentWorkspaceId;
    msgPayload.created_at = nowIso();
    if (user?.uid) msgPayload.owner_id = user.uid;
    supabase.from('messages').upsert(msgPayload).then(({ error }) => {
      if (error) console.error("Error saving AI message:", error);
    });

    if (result.updatedDocument) {
      setDocumentContent(result.updatedDocument);

      supabase.from('documents').upsert({
        id: 'main',
        workspace_id: currentWorkspaceId,
        content: result.updatedDocument,
        last_updated: nowIso(),
        updated_at: nowIso(),
        updated_by: 'Orchestrator',
      }).then(({ error }) => {
        if (error) console.error("Error saving document:", error);
      });
    }

  } catch (error) {
    console.error("Zero-touch mode error:", error);
    const errorMsgId = Date.now().toString();
    const errorMsg: Message = {
      id: errorMsgId,
      text: "Üzgünüm, işlem sırasında bir hata oluştu. Lütfen tekrar deneyin.",
      role: 'model',
      senderName: 'Sistem',
      senderRole: 'System',
      createdAt: Date.now(),
      isError: true
    };
    setMessages(prev => [...prev, errorMsg]);
  } finally {
    setIsDiscussing(false);
  }
};
