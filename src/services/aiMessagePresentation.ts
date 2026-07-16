import { parse as parsePartialJson } from 'partial-json';
import type { DocumentData, Question } from '../types';

export interface ChatDisplayParts {
  text: string;
  thinking?: string;
  questions?: Question[];
  actionSummary?: string;
}

function stripCodeFences(raw: string): string {
  let value = raw.trim();
  const match = value.match(/^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/);
  if (match) value = match[1].trim();
  return value;
}

export function sanitizeAiDisplayText(text: string): ChatDisplayParts {
  if (!text) return { text: '' };
  const trimmed = stripCodeFences(text);
  if (!trimmed.startsWith('{')) return { text };

  try {
    const parsed = parsePartialJson(trimmed) as Record<string, unknown>;
    return {
      text: typeof parsed?.message === 'string' ? parsed.message : '',
      thinking: typeof parsed?.thinking === 'string' ? parsed.thinking : undefined,
      questions: Array.isArray(parsed?.questions) ? parsed.questions as Question[] : undefined,
      actionSummary: typeof parsed?.actionSummary === 'string' ? parsed.actionSummary : undefined,
    };
  } catch {
    return { text: '' };
  }
}

export function hasDocumentIntent(text: string): boolean {
  return /dok[üu]man|kavramsal tasar[ıi]m|iş analizi|is analizi|gereksinim|bpmn|ak[ıi]ş|toast|validasyon|modal|rapor/i.test(text);
}

export function ensureDocumentActionSummary(
  text: string,
  options: {
    changedSections: string[];
    score?: number;
    scoreExplanation?: string;
    document?: DocumentData | null;
  },
): string {
  const current = text?.trim() || '';
  if (/ne yapt[ıi]m|ne yaptim/i.test(current)) return current;

  const findings = (options.document?.qualityAssessment?.findings || [])
    .slice(0, 3)
    .map(item => item.message);
  return [
    current,
    '',
    '**Ne yaptim?**',
    `- Sag panelde guncellenen alanlar: ${options.changedSections.join(', ') || 'Dokuman icerigi'}.`,
    typeof options.score === 'number' ? `- Kalite puani: ${options.score}/100.` : '',
    options.scoreExplanation ? `- Puan nedeni: ${options.scoreExplanation}` : '',
    findings.length ? `- Oncelikli bulgular: ${findings.join('; ')}` : '',
  ].filter(Boolean).join('\n');
}
