import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../../types';
import { ARTIFACT_PROFILES } from '../ai/artifactProfiles';
import { CANONICAL_CONCEPTUAL_SECTIONS } from '../conceptualTemplate';
import { evaluateDocumentQualityGate } from '../documentQualityGate';

function completeConceptualDocument(): DocumentData {
  const headings = CANONICAL_CONCEPTUAL_SECTIONS.map(section => `## ${section}`).join('\n\n');
  return {
    businessAnalysis: {
      content: `${headings}\n\n| Alan | Deger |\n|---|---|\n| Kapsam | Kaynakla tanimlanan kapsam |\n\n${'Kaynakla uyumlu analiz. '.repeat(60)}`,
      status: 'DRAFT',
      flags: [],
    },
    review: {
      content: 'Kaynak, varsayim, risk ve acik konu degerlendirmesi.',
      status: 'DRAFT',
      flags: [],
    },
  };
}

describe('documentQualityGate', () => {
  it('is read-only and never repairs a short document', () => {
    const document: DocumentData = {
      businessAnalysis: { content: '# Supplied draft', status: 'DRAFT', flags: [] },
    };
    const before = JSON.stringify(document);

    const result = evaluateDocumentQualityGate(document, {
      artifactProfile: ARTIFACT_PROFILES.conceptual_design_standard,
    });

    expect(JSON.stringify(document)).toBe(before);
    expect(result.canPublishToPanel).toBe(false);
    expect(document.businessAnalysis.content).not.toMatch(/KPI|retry|audit|SUREC MODELI/);
  });

  it('accepts the canonical conceptual structure without imposing process counts', () => {
    const result = evaluateDocumentQualityGate(completeConceptualDocument(), {
      artifactProfile: ARTIFACT_PROFILES.conceptual_design_standard,
      sourceProcessTitles: [],
      sourceSensitive: false,
    });

    expect(result.canPublishToPanel).toBe(true);
    expect(result.missingSections.join(' ')).not.toMatch(/en az|minimum|adet/i);
  });

  it('blocks VERIFIED claims that do not carry actual source evidence', () => {
    const document = completeConceptualDocument();
    document.evidenceClaims = [{
      claimId: 'CLM-001',
      claim: 'A regulatory deadline applies.',
      status: 'VERIFIED',
      confidence: 0.95,
    }];

    const result = evaluateDocumentQualityGate(document, {
      artifactProfile: ARTIFACT_PROFILES.conceptual_design_standard,
      sourceSensitive: true,
    });

    expect(result.canPublishToPanel).toBe(false);
    expect(result.missingSections).toContain('Gecersiz EvidenceClaim');
  });

  it('requires every explicit source process to be represented', () => {
    const result = evaluateDocumentQualityGate(completeConceptualDocument(), {
      artifactProfile: ARTIFACT_PROFILES.conceptual_design_standard,
      sourceProcessTitles: ['Customer consent revocation'],
    });

    expect(result.canPublishToPanel).toBe(false);
    expect(result.missingSections.some(item => item.startsWith('Kaynak surec kapsami'))).toBe(true);
  });
});
