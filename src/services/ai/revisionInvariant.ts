import type { DocumentData } from '../../types';

export interface RevisionInvariantResult {
  allowed: boolean;
  violations: string[];
  existingIdentity: string;
  candidateIdentity: string;
}

const GENERIC_HEADINGS = [
  'kavramsal tasarim raporu',
  'is analizi',
  'ba analiz',
  'business analysis',
  'amac ve kapsam',
];

function text(value = ''): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d|tr|div|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalize(value = ''): string {
  return text(value)
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function identityFromDocument(document: DocumentData): string {
  const content = document.businessAnalysis?.content || '';
  const plain = text(content);
  const labeled = plain
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => /^(proje ad[ıi]|proje ismi|project name)\s*[:\-]/i.test(line));
  if (labeled) return labeled.replace(/^[^:\-]+[:\-]\s*/, '').trim();

  const headings = [
    ...Array.from(content.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)).map(match => text(match[1] || '')),
    ...Array.from(content.matchAll(/^#{1,3}\s+(.+)$/gim)).map(match => match[1].trim()),
  ].filter(Boolean);
  return headings.find(heading => !GENERIC_HEADINGS.includes(normalize(heading)))
    || headings[0]
    || plain.split('\n').find(Boolean)
    || '';
}

function stableCodes(document: DocumentData): string[] {
  const all = [
    document.businessAnalysis?.content || '',
    document.review?.content || '',
  ].join('\n');
  return Array.from(new Set(
    text(all).match(/\b[A-ZÇĞİÖŞÜ]{1,12}[-_]?\d{2,}\b/g) || [],
  ));
}

function identityTokens(value: string): string[] {
  const stop = new Set(['proje', 'analiz', 'dokuman', 'kavramsal', 'tasarim', 'raporu', 'sistemi']);
  return normalize(value)
    .split(/\s+/)
    .filter(token => token.length >= 3 && !stop.has(token));
}

function overlap(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 1;
  const rightSet = new Set(right);
  return left.filter(token => rightSet.has(token)).length / left.length;
}

function lockedConstraintLines(document: DocumentData): string[] {
  return text(document.businessAnalysis?.content || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => (
      /^\s*(k[ıi]s[ıi]t|constraint)\s*[:\-]/i.test(line)
      || /\b(de[gğ]i[sş]meden kal[ıi]r|etkilenmesin|etkilenmez|korunmal[ıi]|kapsam d[ıi][sş][ıi])\b/i.test(line)
    ))
    .slice(0, 12);
}

function explicitlyChangesBackbone(userMessage: string): boolean {
  return /\b(proje ad[ıi]n[ıi]|proje ismini|yeniden adland[ıi]r|ad[ıi]n[ıi] de[gğ]i[sş]tir|kapsam[ıi] de[gğ]i[sş]tir|kapsam[ıi] yeniden yaz|ama[cç] de[gğ]i[sş]|yeni proje olarak|ba[sş]tan yeni dok[uü]man)\b/i.test(userMessage);
}

export function evaluateRevisionInvariant(input: {
  existing: DocumentData;
  candidate: DocumentData;
  userMessage: string;
}): RevisionInvariantResult {
  const existingIdentity = identityFromDocument(input.existing);
  const candidateIdentity = identityFromDocument(input.candidate);
  if (explicitlyChangesBackbone(input.userMessage)) {
    return { allowed: true, violations: [], existingIdentity, candidateIdentity };
  }

  const violations: string[] = [];
  const candidateText = normalize([
    input.candidate.businessAnalysis?.content || '',
    input.candidate.review?.content || '',
  ].join('\n'));

  const missingCodes = stableCodes(input.existing)
    .filter(code => !candidateText.includes(normalize(code)));
  if (missingCodes.length > 0) {
    violations.push(`Kilitli proje kodu kayboldu: ${missingCodes.join(', ')}`);
  }

  const existingTokens = identityTokens(existingIdentity);
  const candidateTokens = identityTokens(candidateIdentity);
  if (
    existingTokens.length >= 2
    && candidateTokens.length >= 2
    && overlap(existingTokens, candidateTokens) < 0.5
  ) {
    violations.push(`Proje kimliği değişti: "${existingIdentity}" → "${candidateIdentity}"`);
  }

  const missingConstraints = lockedConstraintLines(input.existing)
    .filter(line => {
      const tokens = identityTokens(line);
      return tokens.length >= 2 && overlap(tokens, identityTokens(candidateText)) < 0.6;
    });
  if (missingConstraints.length > 0) {
    violations.push(`Kilitli kapsam/kısıt kayboldu: ${missingConstraints.slice(0, 3).join(' | ')}`);
  }

  return {
    allowed: violations.length === 0,
    violations,
    existingIdentity,
    candidateIdentity,
  };
}
