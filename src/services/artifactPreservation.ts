import type { DocumentData, SectionData } from '../types';

const normalize = (value = ''): string => value
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\u0131/g, 'i')
  .replace(/\s+/g, ' ')
  .trim();

const toPlainLines = (content = ''): string[] => content
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<\/(?:p|li|h[1-6]|tr|div|section)>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .split(/\n+/)
  .map(line => line.trim())
  .filter(Boolean);

const protectedHeading = (value: string): boolean => (
  /\b(karar\w*|is kurallar\w*|is kurali|onayli kapsam|kapsam disi|kisit\w*|zorunlu kural)\b/.test(normalize(value))
);

const decisionLike = (value: string): boolean => (
  /\b(karar\w*|yalniz|sadece|kapsam disi|degistirilemez|tamamlaninca|kez|limit\w*|ana .{0,24} sistem\w*|uygulan\w*|gerek\w*|zorunlu|onay\w*)\b/.test(normalize(value))
);

function protectedStatements(section?: SectionData): string[] {
  const lines = toPlainLines(section?.content || '');
  let inProtectedSection = false;
  const statements: string[] = [];

  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      inProtectedSection = protectedHeading(heading[1]);
      continue;
    }
    const cleaned = line.replace(/^[-*]\s+/, '').trim();
    if (
      cleaned.length >= 8
      && cleaned.length <= 500
      && (inProtectedSection || decisionLike(cleaned))
    ) {
      statements.push(cleaned);
    }
  }
  return Array.from(new Set(statements));
}

function supersededByRequest(statement: string, userMessage: string): boolean {
  const request = normalize(userMessage);
  if (!/\b(artik|yerine|degistir|guncelle|bundan sonra|yeni karar)\b/.test(request)) return false;

  const stopWords = new Set(['olan', 'olarak', 'icin', 've', 'veya', 'artık', 'artik', 'karar']);
  const statementTokens = new Set(
    normalize(statement).split(/[^a-z0-9]+/).filter(token => token.length >= 4 && !stopWords.has(token)),
  );
  const requestTokens = normalize(userMessage)
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 4 && !stopWords.has(token));
  return requestTokens.filter(token => statementTokens.has(token)).length >= 2;
}

export function preserveArtifactDecisions(
  existing: DocumentData | null,
  proposed: DocumentData,
  userMessage: string,
  targetSection?: string | null,
): DocumentData {
  const explicitUserStatements = Array.from(userMessage.matchAll(
    /(?:^|\n)\s*(?:karar|kural|gereksinim|kısıt|kisit)\s*:\s*([^\n]+)/gi,
  )).map(match => match[1].trim()).filter(Boolean);
  const merged: DocumentData = existing ? { ...existing, ...proposed } : { ...proposed };
  if (!existing && !explicitUserStatements.length) return proposed;
  if (targetSection === 'review' && existing) {
    if (existing.businessAnalysis) merged.businessAnalysis = existing.businessAnalysis;
    if (existing.code) merged.code = existing.code;
    if (existing.test) merged.test = existing.test;
    if (existing.bpmn) merged.bpmn = existing.bpmn;
    const requestTrace = userMessage.trim().replace(/\s+/g, ' ');
    const review = merged.review || existing.review;
    if (review) {
      const reviewParts = [review.content.trim()];
      const normalizedReview = normalize(review.content);
      if (
        !/\bvarsayim\b/.test(normalizedReview)
        || !/\bacik konu\b/.test(normalizedReview)
        || !/\bdogrulanmis gercek\b/.test(normalizedReview)
      ) {
        reviewParts.push(
          '## Kanıt Sınıfları',
          '- DOĞRULANMIŞ GERÇEK · VARSAYIM · AÇIK KONU',
        );
      }
      if (
        requestTrace.length >= 8
        && requestTrace.length <= 500
        && !normalizedReview.includes(normalize(requestTrace))
      ) {
        reviewParts.push(
          '## Talep İzlenebilirliği',
          `- Kullanıcı talebi: ${requestTrace}`,
        );
      }
      merged.review = {
        ...review,
        content: reviewParts.filter(Boolean).join('\n\n'),
      };
    }
    return merged;
  }

  const existingStatements = [
    ...(existing ? protectedStatements(existing.businessAnalysis) : []),
    ...explicitUserStatements,
  ];
  const proposedText = normalize(proposed.businessAnalysis?.content || '');
  const requestTrace = userMessage.trim().replace(/\s+/g, ' ');
  const shouldTraceRequest = explicitUserStatements.length === 0
    && requestTrace.length >= 8
    && requestTrace.length <= 500
    && !proposedText.includes(normalize(requestTrace));
  const missing = existingStatements
    .filter(statement => !proposedText.includes(normalize(statement)))
    .filter(statement => !supersededByRequest(statement, userMessage))
    .slice(0, 20);
  if (!missing.length && !shouldTraceRequest) return merged;

  const incoming = proposed.businessAnalysis || existing?.businessAnalysis;
  if (!incoming) return merged;
  merged.businessAnalysis = {
    ...incoming,
    content: [
      incoming.content.trim(),
      ...(missing.length
        ? ['## Korunan Mevcut Kararlar', ...missing.map(statement => `- ${statement}`)]
        : []),
      ...(shouldTraceRequest
        ? ['## Talep İzlenebilirliği', `- Kullanıcı talebi: ${requestTrace}`]
        : []),
    ].filter(Boolean).join('\n\n'),
  };
  return merged;
}
