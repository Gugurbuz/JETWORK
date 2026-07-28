import { describe, expect, it } from 'vitest';
import { buildAiTurnDecision } from '../aiTurnDecision';

const baseInput: any = {
  userMessage: 'uygula',
  document: {
    businessAnalysis: { content: 'Existing document', status: 'DRAFT', flags: [] },
  },
  classification: {
    primaryIntent: 'conversation',
    subIntent: 'ask_how_to',
    documentImpact: 'none',
    operation: 'none',
    riskLevel: 'low',
    requiresClarification: false,
    requiresPreview: false,
    requiresResearch: false,
    shouldRunBaAgentLoop: false,
    confidence: 0.9,
    reason: 'fixture',
  },
  behaviorDecision: {
    mode: 'chat_only',
    domain: 'generic_ba',
    shouldUpdateDocument: false,
    shouldUseResearch: false,
  },
  cognitiveFrame: {
    action: 'answer_only',
    artifactMode: 'conceptual_analysis',
    confidence: 90,
    informationGaps: [],
  },
  sourceReport: {
    confidence: 10,
    domainHints: [],
    systems: [],
    integrations: [],
    processes: [],
  },
  discoverySignals: {},
  pendingOperationLookupPerformed: true,
};

describe('AiTurnDecision pending operation routing', () => {
  it('executes only when a pending operation exists', () => {
    const decision = buildAiTurnDecision({ ...baseInput, pendingOperation: { id: 'op-1' } });
    expect(decision.action).toBe('execute_confirmed_change');
    expect(decision.documentPolicy.shouldUpdateDocument).toBe(true);
  });

  it('does not treat a bare apply command as a new document change', () => {
    const decision = buildAiTurnDecision({ ...baseInput, pendingOperation: null });
    expect(decision.action).toBe('pending_operation_missing');
    expect(decision.documentPolicy.shouldUpdateDocument).toBe(false);
  });
});

describe('AiTurnDecision artifact precedence', () => {
  it('keeps an explicit conceptual request in the corporate profile even if upstream focus drifted to review', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: [
        'Problem: Talepler farkli kanallarda izlenemiyor.',
        'KPI: Tamamlanma suresi olculecek; hedef deger acik konu.',
        'Kurumsal yapida kavramsal tasarim dokumani hazirla.',
      ].join('\n'),
      document: null,
      classification: {
        ...baseInput.classification,
        primaryIntent: 'quality_review',
        subIntent: 'generate_review_report',
        documentImpact: 'updates_document',
        operation: 'replace_or_create_section',
        baAgentFocus: 'review',
      },
      behaviorDecision: {
        ...baseInput.behaviorDecision,
        mode: 'draft_with_assumptions',
        shouldUpdateDocument: true,
      },
      cognitiveFrame: {
        ...baseInput.cognitiveFrame,
        action: 'draft_now',
        artifactMode: 'conceptual_analysis',
      },
      sourceReport: {
        ...baseInput.sourceReport,
        processes: ['Talebin alinmasi', 'Uygunluk kontrolu'],
      },
    });

    expect(decision.action).toBe('draft_document');
    expect(decision.artifactMode).toBe('conceptual_analysis');
    expect(decision.artifactProfile.id).toBe('conceptual_design_process_heavy');
  });

  it('honors an explicit document request even when the cognitive frame prefers discovery', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: 'Talep yönetimi için kavramsal tasarım hazırla: başvuru, doğrulama, atama, çözüm ve kapanış.',
      document: null,
      pendingOperationLookupPerformed: false,
      classification: {
        ...baseInput.classification,
        primaryIntent: 'analysis_generation',
        subIntent: 'generate_business_analysis',
        documentImpact: 'updates_document',
      },
      behaviorDecision: {
        ...baseInput.behaviorDecision,
        mode: 'ask_clarifying_questions',
        shouldUpdateDocument: false,
      },
      cognitiveFrame: {
        ...baseInput.cognitiveFrame,
        action: 'ask_first',
      },
    });

    expect(decision.action).toBe('draft_document');
  });

  it('honors an explicit document request even when the classifier asks for clarification', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: 'Talep yönetimi için kavramsal tasarım hazırla.',
      document: null,
      classification: {
        ...baseInput.classification,
        requiresClarification: true,
        clarificationQuestions: ['Onay akışı nedir?'],
        documentImpact: 'updates_document',
      },
      behaviorDecision: {
        ...baseInput.behaviorDecision,
        mode: 'ask_clarifying_questions',
      },
      cognitiveFrame: {
        ...baseInput.cognitiveFrame,
        action: 'ask_first',
      },
    });

    expect(decision.action).toBe('draft_document');
  });

  it('asks before overriding a protected manual-change decision', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: 'Artık manuel değişiklik de yapılabilsin.',
      pendingOperationLookupPerformed: false,
      document: {
        businessAnalysis: {
          content: 'Müşteri tipi yalnız CRM tarafından belirlenir; manuel değiştirilemez.',
          status: 'DRAFT',
          flags: [],
        },
      },
    });

    expect(decision.action).toBe('ask_questions');
  });

  it('does not mistake a review source-risk note for a research request', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: 'Yalnız Review bölümüne kaynak riski ekle.',
      pendingOperationLookupPerformed: false,
      classification: {
        ...baseInput.classification,
        primaryIntent: 'quality_review',
        subIntent: 'generate_review_report',
        documentImpact: 'updates_document',
        targetSection: 'review',
      },
      behaviorDecision: {
        ...baseInput.behaviorDecision,
        mode: 'update_existing_document',
        shouldUpdateDocument: true,
      },
      cognitiveFrame: {
        ...baseInput.cognitiveFrame,
        action: 'draft_now',
      },
    });

    expect(decision.action).toBe('revise_document');
  });

  it('asks for evidence instead of previewing an unsupported verified API claim', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: 'Findeks entegrasyonu için bildiğin API alanlarını kesinmiş gibi dokümana yaz.',
      document: null,
      classification: {
        ...baseInput.classification,
        riskLevel: 'high',
        requiresPreview: true,
        documentImpact: 'requires_user_confirmation',
      },
      sourceReport: {
        ...baseInput.sourceReport,
        domainHints: ['findeks'],
        integrations: ['API'],
      },
    });

    expect(decision.action).toBe('ask_questions');
  });

  it('does not let generic clarification override an explicit existing-artifact update', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: 'Yalnız bildirim kanalına mobil push seçeneğini ekle.',
      pendingOperationLookupPerformed: false,
      classification: {
        ...baseInput.classification,
        requiresClarification: true,
        documentImpact: 'updates_document',
      },
      behaviorDecision: {
        ...baseInput.behaviorDecision,
        mode: 'update_existing_document',
        shouldUpdateDocument: true,
      },
      sourceReport: {
        ...baseInput.sourceReport,
        systems: ['CRM'],
        integrations: ['Harici API'],
      },
    });

    expect(decision.action).toBe('revise_document');
  });

  it('updates selected text before considering generic clarification', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: 'Bu metni aktif dile çevir ve hata davranışını ekle.',
      hasSelectedText: true,
      classification: {
        ...baseInput.classification,
        primaryIntent: 'selected_text_editing',
        documentImpact: 'updates_selected_text',
        requiresClarification: true,
      },
    });

    expect(decision.action).toBe('update_selected_text');
  });

  it('allows a source-sensitive draft when the user explicitly accepts assumptions', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: 'Gerçek: kaynak sistem SAP CRM. Bildirim servisi seçilmedi. Varsayımla analiz hazırla.',
      document: null,
      classification: {
        ...baseInput.classification,
        documentImpact: 'updates_document',
        requiresClarification: true,
      },
      sourceReport: {
        ...baseInput.sourceReport,
        domainHints: ['sap'],
        integrations: ['SAP CRM'],
      },
    });

    expect(decision.action).toBe('draft_document');
  });

  it('captures an explicit decision in the artifact even if the classifier calls it memory-only', () => {
    const decision = buildAiTurnDecision({
      ...baseInput,
      userMessage: 'Karar: müşteri tipini yalnız CRM belirler.',
      document: null,
      classification: {
        ...baseInput.classification,
        primaryIntent: 'memory_decision',
        subIntent: 'save_business_rule',
        documentImpact: 'updates_memory_only',
      },
    });

    expect(decision.action).toBe('draft_document');
  });
});
