import type { DocumentData, Message } from '../types';
import type { AssistantDocumentRequestMode } from './assistantDocumentIntent';

const normalizeContinuationText = (value: string): string => value
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const DOCUMENT_TARGETS = [
  'analiz dokumani',
  'is analizi dokumani',
  'ihtiyac analizi dokumani',
  'kavramsal tasarim dokumani',
  'talep dokumani',
  'ba analizi',
];

const DOCUMENT_ACTION_STEMS = [
  'hazirla',
  'olustur',
  'uret',
  'yaz',
];

export const isDocumentContinuationAnswerCandidate = (message: string): boolean => {
  const normalized = normalizeContinuationText(message);
  if (!normalized) return false;
  if (normalized.startsWith('varsayimlarla devam et')) return true;

  const questionCount = (normalized.match(/\bsoru\s+\d+\b/g) || []).length;
  const answerCount = (normalized.match(/\bcevap\b/g) || []).length;
  return questionCount > 0 && answerCount > 0;
};

const signalsPendingDocumentCreation = (message: Message): boolean => {
  if (!message.questions?.length) return false;

  const combined = normalizeContinuationText([
    message.text || '',
    message.actionSummary || '',
  ].join(' '));
  const hasDocumentTarget = DOCUMENT_TARGETS.some(target => combined.includes(target));
  const hasDocumentAction = DOCUMENT_ACTION_STEMS.some(stem => combined.includes(stem));

  return hasDocumentTarget && hasDocumentAction;
};

const latestAssistantWithQuestions = (messages: Message[]): Message | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate.role === 'user') return undefined;
    if (candidate.role === 'model' && candidate.questions?.length) return candidate;
  }
  return undefined;
};

/**
 * Carries an explicitly signalled document workflow over the clarification turn.
 *
 * The assistant may first ask structured questions and promise to create the BA
 * document after the answers. The following user message contains only the
 * answers, so the normal single-message document classifier cannot see the
 * original artifact intent. This resolver uses persisted conversation messages,
 * which means the continuation also survives a page refresh.
 */
export function inferDocumentContinuationMode(input: {
  message: string;
  recentMessages: Message[];
  document?: DocumentData | null;
}): AssistantDocumentRequestMode | undefined {
  if (input.document?.businessAnalysis?.content?.trim()) return undefined;
  if (!isDocumentContinuationAnswerCandidate(input.message)) return undefined;

  const previousAssistant = latestAssistantWithQuestions(input.recentMessages);
  if (!previousAssistant || !signalsPendingDocumentCreation(previousAssistant)) return undefined;

  return 'create';
}
