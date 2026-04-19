import { db, doc, setDoc, updateDoc, serverTimestamp } from '../db';
import { Message, DocumentData } from '../types';
import { saveDocumentAndVersion, saveRawResponse } from '../utils/documentUtils';

export const saveUserMessage = async (
  workspaceId: string,
  message: Message,
  ownerId: string
): Promise<void> => {
  await setDoc(doc(db, 'workspaces', workspaceId, 'messages', message.id), {
    ...message,
    ownerId,
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, 'workspaces', workspaceId), {
    lastUpdated: serverTimestamp()
  });
};

export const saveAIMessage = async (
  workspaceId: string,
  message: Message,
  ownerId: string,
  rawText?: string,
  parsedData?: any,
  documentContent?: DocumentData | null
): Promise<void> => {
  await setDoc(doc(db, 'workspaces', workspaceId, 'messages', message.id), {
    ...message,
    ownerId,
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, 'workspaces', workspaceId), {
    lastUpdated: serverTimestamp()
  });

  if (rawText !== undefined) {
    await saveRawResponse(workspaceId, message.id, rawText, parsedData);
  }

  if (documentContent && Object.keys(documentContent).length > 0) {
    await saveDocumentAndVersion(workspaceId, message.id, documentContent);
  }
};

export const saveReactions = async (
  workspaceId: string,
  messageId: string,
  reactions: { emoji: string; users: string[] }[]
): Promise<void> => {
  await updateDoc(doc(db, 'workspaces', workspaceId, 'messages', messageId), {
    reactions
  });
};
