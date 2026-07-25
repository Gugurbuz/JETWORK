import type { DocumentData, SectionData } from '../types';
import type { ArtifactProfile } from './ai/artifactProfiles';
import type { AdaptiveReasoningPlan } from './ai/adaptiveReasoningPolicy';
import { evaluateAdaptiveReasoningCritique } from './ai/adaptiveReasoningCritic';
import { conceptualTemplateCoverage } from './conceptualTemplate';
import { hasValidEvidenceLedger, invalidEvidenceClaims } from './evidenceClaims';

export interface DocumentQualityGateResult {
  canPublishToPanel: boolean;
  score: number;
  reason: string;
  missingSections: string[];
  warnings: string[];
}

export interface DocumentQualityGateContext {
  artifactProfile?: ArtifactProfile;
  sourceProcessTitles?: string[];
  sourceSensitive?: boolean;
  reasoningPlan?: AdaptiveReasoningPlan;
  sourceText?: string;
}

const stripHtml = (value = ''): string => value
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const normalize = (value = ''): string => stripHtml(value)
  .toLocaleLowerCase('tr-TR')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/ı/g, 'i')
  .replace(/ş/g, 's')
  .replace(/ğ/g, 'g')
  .replace(/ü/g, 'u')
  .replace(/ö/g, 'o')
  .replace(/ç/g, 'c')
  .replace(/\s+/g, ' ')
  .trim();

const sectionText = (section?: SectionData): string => stripHtml(section?.content || '');
const hasAny = (value: string, patterns: RegExp[]): boolean => patterns.some(pattern => pattern.test(value));
const hasTable = (value = ''): boolean => /<table[\s>]/i.test(value) || /\|\s*[^\n]+\s*\|/.test(value);
const hasHeading = (value = ''): boolean => /<h[1-4][\s>]/i.test(value) || /^#{1,4}\s+/m.test(value);

function sourceSignalIsRepresented(documentText: string, signal: string): boolean {
  const sourceTokens = normalize(signal).split(/[^a-z0-9]+/).filter(token => token.length >= 3);
  if (sourceTokens.length === 0) return true;
  const normalizedDocument = normalize(documentText);
  const matched = sourceTokens.filter(token => normalizedDocument.includes(token)).length;
  return matched / sourceTokens.length >= (sourceTokens.length <= 2 ? 1 : 0.67);
}

function buildReason(score: number, canPublish: boolean, missing: string[], warnings: string[]): string {
  const mainReason = missing.slice(0, 4).join(', ') || 'kritik eksik bulunmadi';
  const warning = warnings[0] ? ` ${warnings[0]}` : '';
  return `Kalite puani ${score}/100: ${canPublish ? 'taslak paylasilabilir' : 'revizyon gerekli'}. Gerekce: ${mainReason}.${warning}`;
}

/**
 * Read-only quality boundary. This function must never repair, normalize or
 * append document prose. Missing content is returned only as findings.
 */
export function evaluateDocumentQualityGate(
  document: DocumentData | null | undefined,
  context: DocumentQualityGateContext = {},
): DocumentQualityGateResult {
  if (!document?.businessAnalysis?.content?.trim()) {
    return {
      canPublishToPanel: false,
      score: 0,
      reason: 'Yayinlanacak BA analiz dokumani bulunmuyor.',
      missingSections: ['BA Analiz'],
      warnings: [],
    };
  }

  const baRaw = document.businessAnalysis.content;
  const reviewRaw = document.review?.content || '';
  const ba = sectionText(document.businessAnalysis);
  const review = sectionText(document.review);
  const all = `${ba}\n${review}`;
  const normalizedAll = normalize(all);
  const profile = context.artifactProfile;
  const isConceptualProfile = profile?.id === 'conceptual_design_standard'
    || profile?.id === 'conceptual_design_process_heavy';
  const sourceSensitive = context.sourceSensitive ?? hasAny(normalizedAll, [
    /mevzuat/, /kanun/, /api/, /oauth/, /kisisel veri/, /finansal veri/, /entegrasyon/,
  ]);
  const claims = document.evidenceClaims || [];
  const invalidClaims = invalidEvidenceClaims(claims);
  const missingSections: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  const fail = (label: string, penalty: number, warning?: string): void => {
    if (!missingSections.includes(label)) missingSections.push(label);
    score -= penalty;
    if (warning && !warnings.includes(warning)) warnings.push(warning);
  };

  if (ba.length < 800) {
    fail('Karar verilebilir dokuman derinligi', 18, 'Ana analiz, talebin surec ve gereksinimlerini karar verilebilir ayrintida tasimiyor.');
  }
  if (ba.length < 250) {
    fail('Asgari analiz kapsami', 15, 'Cikti, talebi analiz etmek yerine kisa ve genel bir ozet seviyesinde kalmis.');
  }
  if (!hasHeading(baRaw)) fail('Baslik yapisi', 8);
  if (!hasTable(baRaw) && profile?.id !== 'test_scenario') fail('Yapisal tablo kullanimi', 6);

  if (profile && !['none', 'discovery_brief'].includes(profile.id)) {
    const normalizedBa = normalize(ba);
    const missingProfileSections = profile.requiredSections.filter(section => !normalizedBa.includes(normalize(section)));
    if (missingProfileSections.length > 0) {
      fail(`Artifact profili: ${missingProfileSections.join(', ')}`, 14, 'Secilen dokuman profilinin zorunlu bolumleri eksik.');
    }
  }

  if (isConceptualProfile) {
    const coverage = conceptualTemplateCoverage(baRaw);
    if (coverage.missing.length > 0) {
      fail(`Kurumsal Word sablonu: ${coverage.missing.slice(0, 8).join(', ')}`, 18, 'Ilk paylasilan kavramsal tasarim baslik sirasi tam karsilanmiyor.');
    }
    if (!review.trim()) fail('Review', 8, 'Kavramsal dokumanin kaynak, varsayim, risk ve acik konu reviewu bulunmuyor.');
  }

  const sourceProcesses = Array.from(new Set(context.sourceProcessTitles || [])).filter(Boolean);
  const missingProcesses = sourceProcesses.filter(title => !sourceSignalIsRepresented(ba, title));
  if (missingProcesses.length > 0) {
    fail(`Kaynak surec kapsami: ${missingProcesses.slice(0, 6).join(', ')}`, 16, 'Kaynakta bulunan surecler dokumana eksiksiz yansimamis.');
  }

  if (sourceSensitive && !hasValidEvidenceLedger(claims)) {
    fail('Yapisal kanit kaydi', 14, 'Kaynak hassas iddialar metindeki anahtar kelimelerle degil EvidenceClaim kayitlariyla izlenmelidir.');
  }
  if (invalidClaims.length > 0) {
    fail('Gecersiz EvidenceClaim', 18, 'VERIFIED iddialari URL, baslik, alinma zamani ve kanit alintisi olmadan kullanilamaz.');
  }

  const verifiedClaims = claims.filter(claim => claim.status === 'VERIFIED');
  if (verifiedClaims.length > 0 && !verifiedClaims.every(claim => invalidEvidenceClaims([claim]).length === 0)) {
    fail('Kanitsiz VERIFIED iddiasi', 20);
  }

  const adaptiveCritique = evaluateAdaptiveReasoningCritique({
    document,
    plan: context.reasoningPlan,
    sourceText: context.sourceText,
  });
  adaptiveCritique.findings.forEach(finding => {
    if (finding.severity === 'error') {
      fail(`Adaptif muhakeme: ${finding.message}`, 6, finding.recommendedAction);
    } else if (!warnings.includes(finding.message)) {
      warnings.push(finding.message);
      score -= 3;
    }
  });

  score = Math.max(0, Math.min(100, score));
  const canPublishToPanel = score >= 72
    && adaptiveCritique.passed
    && !missingSections.some(item => (
      item.startsWith('Kurumsal Word sablonu')
      || item.startsWith('Kaynak surec kapsami')
      || item === 'Gecersiz EvidenceClaim'
      || item === 'Kanitsiz VERIFIED iddiasi'
    ));

  return {
    canPublishToPanel,
    score,
    reason: buildReason(score, canPublishToPanel, missingSections, warnings),
    missingSections,
    warnings,
  };
}
