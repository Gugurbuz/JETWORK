import type { Question } from '../types';

export interface AssistantPresentationMetadata {
  visibleText: string;
  workSummary?: string;
  questions?: Question[];
  actionSummary?: string;
}

const META_OPEN = '<jetwork_meta>';
const META_CLOSE = '</jetwork_meta>';

const cleanText = (value: unknown, maxLength: number): string => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
);

const asWorkSummary = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const cleaned = cleanText(value, 2_000);
    return cleaned || undefined;
  }
  if (Array.isArray(value)) {
    const items = value
      .map(item => cleanText(item, 500))
      .filter(Boolean)
      .slice(0, 5);
    return items.length ? items.map(item => `• ${item}`).join('\n') : undefined;
  }
  return undefined;
};

const asQuestions = (value: unknown): Question[] | undefined => {
  if (!Array.isArray(value)) return undefined;

  const questions = value
    .map((item, index): Question | null => {
      if (!item || typeof item !== 'object') return null;
      const candidate = item as Record<string, unknown>;
      const text = cleanText(candidate.text, 500);
      if (!text) return null;
      const options = Array.isArray(candidate.options)
        ? candidate.options
            .map(option => cleanText(option, 160))
            .filter(Boolean)
            .slice(0, 4)
        : [];
      return {
        id: cleanText(candidate.id, 120) || `assistant-question-${index + 1}`,
        text,
        options,
      };
    })
    .filter((question): question is Question => !!question)
    .slice(0, 3);

  return questions.length ? questions : undefined;
};

export function parseAssistantPresentationMetadata(
  rawText: string,
): AssistantPresentationMetadata {
  const lower = rawText.toLocaleLowerCase('tr-TR');
  const openIndex = lower.indexOf(META_OPEN);
  if (openIndex < 0) {
    return { visibleText: rawText.trim() };
  }

  const visibleText = rawText.slice(0, openIndex).trim();
  const closeIndex = lower.indexOf(META_CLOSE, openIndex + META_OPEN.length);
  if (closeIndex < 0) {
    // While the response is still streaming, hide an incomplete metadata block.
    return { visibleText };
  }

  const jsonText = rawText
    .slice(openIndex + META_OPEN.length, closeIndex)
    .trim();

  try {
    const parsed = JSON.parse(jsonText);
    if (!parsed || typeof parsed !== 'object') return { visibleText };
    const metadata = parsed as Record<string, unknown>;
    const workSummary = asWorkSummary(metadata.workSummary);
    const questions = asQuestions(metadata.questions);
    const actionSummary = cleanText(metadata.actionSummary, 1_000) || undefined;

    return {
      visibleText,
      workSummary,
      questions,
      actionSummary,
    };
  } catch {
    // Metadata must never break the user-facing answer.
    return { visibleText };
  }
}
