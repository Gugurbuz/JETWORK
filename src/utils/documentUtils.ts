import { db, doc, setDoc, serverTimestamp } from '../db';
import { DocumentData } from '../types';

export const saveDocumentAndVersion = async (workspaceId: string, messageId: string, content: DocumentData) => {
  try {
    const docRef = doc(db, 'workspaces', workspaceId, 'documents', 'main');
    await setDoc(docRef, {
      content,
      lastUpdated: serverTimestamp(),
      updatedBy: 'AI Orchestrator'
    }, { merge: true });

    const versionRef = doc(db, 'workspaces', workspaceId, 'documents', 'main', 'versions', messageId);
    await setDoc(versionRef, {
      content,
      createdAt: serverTimestamp(),
      messageId
    });
  } catch (error) {
    console.error("Error saving document version:", error);
  }
};
