import { describe, expect, it } from 'vitest';
import type { AiTurnDecision } from '../aiTurnDecision';
import {
  buildAdaptiveReasoningPlan,
  renderAdaptiveReasoningInstruction,
} from '../adaptiveReasoningPolicy';
import { evaluateAdaptiveReasoningCritique } from '../adaptiveReasoningCritic';
import { ARTIFACT_PROFILES } from '../artifactProfiles';

function decision(overrides: Partial<AiTurnDecision> = {}): AiTurnDecision {
  return {
    action: 'draft_document',
    artifactMode: 'conceptual_analysis',
    artifactProfile: ARTIFACT_PROFILES.conceptual_design_standard,
    sourcePolicy: {
      requiresExternalResearch: false,
      officialSourceRequired: false,
      canClaimVerified: false,
      sourceSensitive: false,
    },
    questionPolicy: {
      shouldAsk: false,
      reason: 'test',
      maxQuestions: 0,
      questionType: 'none',
    },
    documentPolicy: {
      shouldUpdateDocument: true,
      templateProfile: 'conceptual_design_standard',
      allowAssumptions: true,
      allowAutoRepair: false,
      allowTemplateNormalization: true,
      forceDocumentGeneration: true,
      visibleSections: ['businessAnalysis', 'review'],
    },
    executionPolicy: {
      operation: 'generate_new_artifact',
      targetSection: null,
      requiresConfirmation: false,
    },
    qualityPolicy: {
      minimumAcceptableScore: 78,
      blockOnContextLeakage: true,
      validationOnlyByDefault: true,
    },
    confidence: 80,
    reason: 'test',
    trace: [],
    ...overrides,
  };
}

describe('adaptiveReasoningPolicy', () => {
  it('selects dependency, constraint and cross-source reasoning for an integration analysis', () => {
    const plan = buildAdaptiveReasoningPlan({
      userMessage: 'SAP CRM sözleşmesinden IS-U sistemine RFC ile tüketim kırılımı gönderilecek. Kavramsal analiz hazırla.',
      hasDocument: true,
      knowledgeSourceCount: 3,
      turnDecision: decision(),
    });
    const capabilities = plan.capabilities.map(item => item.id);

    expect(capabilities).toEqual(expect.arrayContaining([
      'problem_decomposition',
      'dependency_planning',
      'contradiction_gap_detection',
      'constraint_tracking',
      'cross_source_synthesis',
      'independent_critique',
    ]));
  });

  it('requires testable hypotheses for diagnosis instead of accepting the first cause', () => {
    const plan = buildAdaptiveReasoningPlan({
      userMessage: 'C4C şifre sıfırlama e-postası gelmiyor, kök nedeni analiz et.',
    });
    const hypothesis = plan.capabilities.find(item => item.id === 'hypothesis_testing');

    expect(hypothesis?.objective).toContain('kontrol yöntemi');
    expect(hypothesis?.objective).toContain('beklenen kanıt');
  });

  it('adds alternatives, constraints and legacy-record reasoning to a rule decision', () => {
    const plan = buildAdaptiveReasoningPlan({
      userMessage: 'Kamu olmayan müşteride seçenek gizlensin mi pasif mi olsun? Eski belgeler ve yetki kuralını da değerlendir.',
      turnDecision: decision({ action: 'answer_only' }),
    });
    const capabilities = plan.capabilities.map(item => item.id);

    expect(capabilities).toContain('alternative_evaluation');
    expect(capabilities).toContain('constraint_tracking');
  });

  it('selects formal reasoning for formulas, thresholds and boundary values', () => {
    const plan = buildAdaptiveReasoningPlan({
      userMessage: 'Kârlılık %3 ise normal onay, 0 ile %3 arasındaysa yönetici onayı; sınırları test et.',
    });

    expect(plan.capabilities.map(item => item.id)).toContain('formal_reasoning');
  });

  it('keeps a simple chat turn free from a fixed analysis template', () => {
    const plan = buildAdaptiveReasoningPlan({
      userMessage: 'Merhaba',
      turnDecision: decision({
        action: 'answer_only',
        artifactMode: 'none',
        artifactProfile: ARTIFACT_PROFILES.none,
        documentPolicy: {
          shouldUpdateDocument: false,
          templateProfile: 'none',
          allowAssumptions: false,
          allowAutoRepair: false,
          allowTemplateNormalization: false,
          forceDocumentGeneration: false,
          visibleSections: ['businessAnalysis', 'review'],
        },
      }),
    });

    expect(plan.capabilities).toEqual([]);
    expect(renderAdaptiveReasoningInstruction(plan)).toContain('gereksiz analiz sablonu');
  });

  it('builds a valid ordered dependency graph', () => {
    const plan = buildAdaptiveReasoningPlan({
      userMessage: 'Ekteki log ve kodu incele, 502 hatası için alternatif çözümü seç, düzelt, test et ve PR hazırla.',
      hasDocument: true,
      knowledgeSourceCount: 2,
      turnDecision: decision(),
    });
    const seen = new Set<string>();

    for (const step of plan.steps) {
      expect(step.dependsOn.every(id => seen.has(id))).toBe(true);
      seen.add(step.id);
    }
    expect(new Set(plan.steps.map(step => step.capability)).size).toBe(plan.steps.length);
  });

  it('critic rejects untestable first-cause diagnosis and accepts evidence-driven hypotheses', () => {
    const plan = buildAdaptiveReasoningPlan({
      userMessage: 'Şifre sıfırlama e-postası gelmiyor, hata nedenini analiz et.',
      turnDecision: decision(),
    });
    const weak = evaluateAdaptiveReasoningCritique({
      plan,
      sourceText: 'Şifre sıfırlama e-postası gelmiyor.',
      document: {
        businessAnalysis: {
          content: 'Muhtemelen güvenlik politikası engelliyor.',
          status: 'DRAFT',
          flags: [],
        },
        review: {
          content: 'Açık konu bulunmadı.',
          status: 'DRAFT',
          flags: [],
        },
      },
    });
    const strong = evaluateAdaptiveReasoningCritique({
      plan,
      sourceText: 'Şifre sıfırlama e-postası gelmiyor.',
      document: {
        businessAnalysis: {
          content: 'Hipotez: hesap kilitli. Nasıl kontrol edilir: kullanıcı durumu incelenir. Beklenen kanıt: Locked veya Inactive durumu.',
          status: 'DRAFT',
          flags: [],
        },
        review: {
          content: 'Açık konu bulunmadı.',
          status: 'DRAFT',
          flags: [],
        },
      },
    });

    expect(weak.findings.map(item => item.id)).toContain('AR-HYPOTHESIS');
    expect(strong.findings.map(item => item.id)).not.toContain('AR-HYPOTHESIS');
  });

  it('critic preserves numeric thresholds and legacy-record constraints', () => {
    const plan = buildAdaptiveReasoningPlan({
      userMessage: 'Eski belgelerde kârlılık %3 eşiğini koru ve sınır davranışını yaz.',
      turnDecision: decision(),
    });
    const critique = evaluateAdaptiveReasoningCritique({
      plan,
      sourceText: 'Eski belgelerde kârlılık %3 eşiğini koru.',
      document: {
        businessAnalysis: {
          content: 'Yeni teklifler için kârlılık kontrolü yapılır.',
          status: 'DRAFT',
          flags: [],
        },
        review: {
          content: 'Varsayım ve açık konu bulunmadı.',
          status: 'DRAFT',
          flags: [],
        },
      },
    });

    expect(critique.findings.map(item => item.id)).toEqual(expect.arrayContaining([
      'AR-LEGACY',
      'AR-NUMERIC-FIDELITY',
    ]));
  });
});
