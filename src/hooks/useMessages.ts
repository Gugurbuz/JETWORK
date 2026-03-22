import { useStore } from '../store/useStore';
import { db, doc, setDoc, updateDoc, serverTimestamp } from '../db';
import { Message, ZERO_TOUCH_AGENTS } from '../types';
import { runZeroTouchMode } from '../services/agentRunner';
import { callGemini } from '../services/geminiService';
import { chatResponseJsonSchema } from '../schemas';
import { saveDocumentAndVersion } from '../utils/documentUtils';
import { SYSTEM_INSTRUCTION, ZERO_TOUCH_AGENTS } from '../constants';

export const useMessages = (channelRef: any) => {
  const { 
    user, 
    currentWorkspaceId, 
    setMessages, 
    setShowNewItemModal, 
    isZeroTouchMode, 
    setIsGenerating,
    selectedModel
  } = useStore();

  const handleSendMessage = async (text: string, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[], replyToId?: string) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!user) return;
    
    if (!currentWorkspaceId) {
      setShowNewItemModal(true);
      return;
    }

    const isZeroTouchModeActive = text.startsWith('/ekip') || isZeroTouchMode;
    const isSingleAgentMode = text.startsWith('@');
    
    let targetAgentRole = '';
    let targetAgentName = '';
    let messageText = text;

    if (isSingleAgentMode) {
      const match = text.match(/^@(\w+)\s+(.*)/);
      if (match) {
        const agentName = match[1];
        messageText = match[2];
        const agent = ZERO_TOUCH_AGENTS.find(a => a.name.toLowerCase() === agentName.toLowerCase());
        if (agent) {
          targetAgentRole = agent.role;
          targetAgentName = agent.name;
        } else {
           setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'model',
            text: `❌ Hata: "@${agentName}" adında bir ajan bulunamadı. Lütfen geçerli bir ajan adı girin (örn: @BA, @IT).`,
            senderName: 'Sistem',
            senderRole: 'Hata',
            createdAt: Date.now(),
            isError: true
          }]);
          return;
        }
      } else {
         setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'model',
            text: `❌ Hata: Ajan adından sonra bir mesaj girmelisiniz (örn: "@BA bana bir analiz yaz").`,
            senderName: 'Sistem',
            senderRole: 'Hata',
            createdAt: Date.now(),
            isError: true
          }]);
          return;
      }
    } else if (text.startsWith('/ekip')) {
      messageText = text.replace('/ekip', '').trim();
    }

    const msgId = Date.now().toString();
    const newMsg: Message = {
      id: msgId,
      role: 'user',
      text: messageText,
      senderName: user.name || 'Kullanıcı',
      senderRole: 'Kullanıcı',
      createdAt: Date.now(),
      attachments: attachments?.map(a => ({ url: a.url, data: a.data, name: a.name, mimeType: a.mimeType })),
      replyToId
    };

    setMessages(prev => [...prev, newMsg]);

    try {
      await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', msgId), {
        ...newMsg,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to save user message to database:", err);
    }

    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'new_message', payload: { itemId: currentWorkspaceId, message: newMsg } });
    }

    if (isZeroTouchModeActive) {
      runZeroTouchMode(newMsg, attachments);
      return;
    }

    setIsGenerating(true);
    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    setMessages(prev => [...prev, {
      id: aiMsgId,
      role: 'model',
      text: '',
      senderName: targetAgentName || 'JetWork AI',
      senderRole: targetAgentName ? targetAgentName : 'Sistem Asistanı',
      agentRole: targetAgentRole || undefined,
      createdAt: Date.now(),
      isTyping: true
    }]);

    try {
      const state = useStore.getState();
      const currentMessages = state.messages;
      const documentContent = state.documentContent;
      
      const history = currentMessages.slice(-10).map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: `[${m.senderName} - ${m.senderRole}]: ${m.text}` }]
      }));

      let systemInstruction = "Sen JetWork AI'sın. Profesyonel bir asistansın.";
      if (targetAgentRole) {
        const agent = ZERO_TOUCH_AGENTS.find(a => a.role === targetAgentRole);
        if (agent) {
          systemInstruction = agent.instruction;
        }
      }

      const contents = [
        ...history,
        {
          role: 'user',
          parts: [
            { text: `[${user.name} - Kullanıcı]: ${messageText}` },
            ...(attachments?.map(a => ({
              inlineData: {
                data: a.data,
                mimeType: a.mimeType
              }
            })) || [])
          ]
        }
      ];

      if (documentContent) {
        contents[0].parts[0].text = `Mevcut Doküman:\n${JSON.stringify(documentContent, null, 2)}\n\n` + contents[0].parts[0].text;
      }

      const response = await callGemini({
        model: selectedModel,
        systemInstruction,
        contents,
        responseSchema: chatResponseJsonSchema,
        onChunk: (text, thinking, tokenCount, functionCalls) => {
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
            ...m, 
            text, 
            thinkingText: thinking,
            tokenCount 
          } : m));
          
          if (channelRef.current) {
            channelRef.current.send({ 
              type: 'broadcast', 
              event: 'ai_stream_chunk', 
              payload: { 
                id: aiMsgId, 
                text, 
                thinkingText: thinking,
                senderName: targetAgentName || 'JetWork AI',
                senderRole: targetAgentName || 'Sistem Asistanı',
                agentRole: targetAgentRole || undefined
              } 
            });
          }
        }
      });

      let finalDocument = documentContent;
      let fullText = response.text;

      if (response.functionCalls && response.functionCalls.length > 0) {
        for (const call of response.functionCalls) {
          if (call.name === 'update_document_section') {
            const args = call.args as { section: string; content: string; actionSummary: string };
            if (args.section && args.content) {
              const newDoc = { ...finalDocument } as DocumentData;
              (newDoc as any)[args.section] = args.content;
              finalDocument = newDoc;
              useStore.getState().setDocumentContent(newDoc);
              fullText += `\n\n*(Sistem Notu: ${args.actionSummary})*`;
            }
          }
        }
      }

      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text: fullText, isTyping: false } : m));
      
      if (channelRef.current) {
        const finalMsg = useStore.getState().messages.find(m => m.id === aiMsgId);
        if (finalMsg) {
          channelRef.current.send({ 
            type: 'broadcast', 
            event: 'ai_stream_end', 
            payload: { 
              id: aiMsgId, 
              text: finalMsg.text, 
              thinkingText: finalMsg.thinkingText,
              senderName: targetAgentName || 'JetWork AI',
              senderRole: targetAgentName || 'Sistem Asistanı',
              agentRole: targetAgentRole || undefined
            } 
          });
          
          await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
            ...finalMsg,
            createdAt: serverTimestamp()
          });

          if (finalDocument && Object.keys(finalDocument).length > 0) {
            await saveDocumentAndVersion(currentWorkspaceId, aiMsgId, finalDocument);
          }
        }
      }

    } catch (error) {
      console.error("AI Error:", error);
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { 
        ...m, 
        text: "Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.", 
        isTyping: false,
        isError: true 
      } : m));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!user || !currentWorkspaceId) return;
    
    const state = useStore.getState();
    const message = state.messages.find(m => m.id === messageId);
    if (!message) return;

    const currentReactions = message.reactions || [];
    const existingReactionIndex = currentReactions.findIndex(r => r.emoji === emoji);
    
    let newReactions = [...currentReactions];
    
    if (existingReactionIndex >= 0) {
      const reaction = newReactions[existingReactionIndex];
      if (reaction.users.includes(user.name)) {
        reaction.users = reaction.users.filter(u => u !== user.name);
        if (reaction.users.length === 0) {
          newReactions.splice(existingReactionIndex, 1);
        }
      } else {
        reaction.users.push(user.name);
      }
    } else {
      newReactions.push({ emoji, users: [user.name] });
    }

    setMessages(prev => prev.map(m => m.id === messageId ? { ...m, reactions: newReactions } : m));

    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', messageId), {
        reactions: newReactions
      });
    } catch (error) {
      console.error("Error updating reaction:", error);
    }
  };

  const handleAcceptAiHandRaise = () => {
    const state = useStore.getState();
    if (state.aiHandRaised) {
      state.setAiHandRaised(null);
      state.setIsDiscussing(true);
      runZeroTouchMode({
        id: Date.now().toString(),
        role: 'user',
        text: 'Lütfen devam et.',
        senderName: 'Sistem',
        senderRole: 'Sistem',
        createdAt: Date.now()
      });
    }
  };

  return { handleSendMessage, handleToggleReaction, handleAcceptAiHandRaise };
};
