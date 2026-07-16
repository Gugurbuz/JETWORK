import type { DocumentData, Message } from '../types';
import type { SingleChatResult } from './singleChatOrchestrator';
import { postProcessDocumentData } from './documentPostProcessor';
import { ensureDocumentActionSummary, hasDocumentIntent } from './aiMessagePresentation';
import { failPendingOperation, markPendingOperationApplied } from './pendingOperationRepository';
import { saveDocumentAndVersion } from '../utils/documentUtils';

export interface DocumentApplicationResult {
  text: string;
  document: DocumentData | null;
  changedSections: string[];
  score?: number;
  scoreExplanation?: string;
  applied: boolean;
}

export async function applyAiDocumentResult(input: {
  loopOutput: SingleChatResult;
  initialText: string;
  existingDocument: DocumentData | null;
  userMessage: string;
  recentMessages: Message[];
  workspaceTitle?: string;
  workspaceId: string;
  messageId: string;
}): Promise<DocumentApplicationResult> {
  let text = input.initialText;
  let document = input.existingDocument;
  let changedSections: string[] = [];
  let score = input.existingDocument?.score;
  let scoreExplanation = input.existingDocument?.scoreExplanation;

  if (input.loopOutput.document) {
    const processed = postProcessDocumentData(input.loopOutput.document, input.existingDocument, {
      sourceText: [
        input.userMessage,
        ...input.recentMessages.slice(-8).map(message => message.text || ''),
      ].filter(Boolean).join('\n\n'),
      workspaceTitle: input.workspaceTitle,
      turnDecision: input.loopOutput.turnDecision,
    });
    document = processed.document;
    changedSections = processed.changedSections;
    score = processed.document.score ?? processed.qualityGate.score;
    scoreExplanation = processed.document.scoreExplanation || processed.qualityGate.reason;

    if (!processed.qualityGate.canPublishToPanel && hasDocumentIntent(input.userMessage)) {
      text = [
        'Taslak olusturuldu; kalite degerlendirmesi tamamlanmasi gereken alanlari isaretledi.',
        '',
        `Kalite puani: ${processed.qualityGate.score}/100`,
        `Tamamlanacak alanlar: ${processed.qualityGate.missingSections.join(', ') || 'Yok'}`,
      ].join('\n');
    }
  }

  if ((!text || !text.trim()) && document && document !== input.existingDocument) {
    text = changedSections.length
      ? `Sag panelde su bolumler guncellendi: ${changedSections.join(', ')}.`
      : 'Islem tamamlandi.';
  }

  let changed = !!document && document !== input.existingDocument;
  if (!changed && text && /sağ panel|sag panel|dokümana işlen|dokumana islen|belgeye eklen/i.test(text)) {
    text += '\n\n_Not: Dokumanda otomatik guncelleme yapilmadi._';
  }

  if (changed) {
    text = ensureDocumentActionSummary(text, { changedSections, score, scoreExplanation, document });
  }

  if (changed && document) {
    const persistence = await saveDocumentAndVersion(input.workspaceId, input.messageId, document);
    if (!persistence.ok) {
      if (input.loopOutput.pendingOperationId) {
        await failPendingOperation(
          input.loopOutput.pendingOperationId,
          persistence.error || 'Document persistence failed.',
        );
      }
      return {
        text: `Dokuman onerisi uretildi ancak veritabanina kaydedilemedi; degisiklik uygulanmis sayilmadi. ${persistence.error || ''}`.trim(),
        document: input.existingDocument,
        changedSections: [],
        score: input.existingDocument?.score,
        scoreExplanation: input.existingDocument?.scoreExplanation,
        applied: false,
      };
    }

    if (input.loopOutput.pendingOperationId) {
      await markPendingOperationApplied(input.loopOutput.pendingOperationId);
    }
  }

  return { text, document, changedSections, score, scoreExplanation, applied: changed };
}
