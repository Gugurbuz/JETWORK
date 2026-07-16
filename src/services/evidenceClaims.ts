import type { EvidenceClaim } from '../types';

const HTTP_URL_RE = /^https:\/\/[^\s]+$/i;

export interface EvidenceClaimValidation {
  valid: boolean;
  errors: string[];
}

export function validateEvidenceClaim(claim: EvidenceClaim): EvidenceClaimValidation {
  const errors: string[] = [];

  if (!claim.claimId?.trim()) errors.push('claimId is required');
  if (!claim.claim?.trim()) errors.push('claim is required');
  if (!Number.isFinite(claim.confidence) || claim.confidence < 0 || claim.confidence > 1) {
    errors.push('confidence must be between 0 and 1');
  }

  if (claim.status === 'VERIFIED') {
    if (!claim.sourceUrl || !HTTP_URL_RE.test(claim.sourceUrl)) {
      errors.push('VERIFIED requires an https sourceUrl');
    }
    if (!claim.sourceTitle?.trim()) errors.push('VERIFIED requires sourceTitle');
    if (!claim.evidenceExcerpt?.trim()) errors.push('VERIFIED requires evidenceExcerpt');
    if (!claim.retrievedAt || Number.isNaN(Date.parse(claim.retrievedAt))) {
      errors.push('VERIFIED requires a valid retrievedAt timestamp');
    }
  }

  return { valid: errors.length === 0, errors };
}

export function invalidEvidenceClaims(claims: EvidenceClaim[] = []): Array<{
  claim: EvidenceClaim;
  errors: string[];
}> {
  return claims
    .map(claim => ({ claim, validation: validateEvidenceClaim(claim) }))
    .filter(item => !item.validation.valid)
    .map(item => ({ claim: item.claim, errors: item.validation.errors }));
}

export function hasValidEvidenceLedger(claims: EvidenceClaim[] = []): boolean {
  return claims.length > 0 && invalidEvidenceClaims(claims).length === 0;
}

export function sanitizeEvidenceClaims(value: unknown): EvidenceClaim[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(item => item && typeof item === 'object')
    .map((item: any): EvidenceClaim => ({
      claimId: String(item.claimId || '').trim(),
      claim: String(item.claim || '').trim(),
      status: ['VERIFIED', 'INFERRED', 'ASSUMPTION', 'OPEN', 'CONFLICTING'].includes(item.status)
        ? item.status
        : 'OPEN',
      sourceUrl: item.sourceUrl ? String(item.sourceUrl).trim() : undefined,
      sourceTitle: item.sourceTitle ? String(item.sourceTitle).trim() : undefined,
      retrievedAt: item.retrievedAt ? String(item.retrievedAt).trim() : undefined,
      evidenceExcerpt: item.evidenceExcerpt ? String(item.evidenceExcerpt).trim() : undefined,
      confidence: Number.isFinite(Number(item.confidence))
        ? Math.max(0, Math.min(1, Number(item.confidence)))
        : 0,
    }))
    .filter(claim => claim.claimId && claim.claim);
}
