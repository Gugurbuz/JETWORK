import { PRIMARY_BY_SUB } from './intentTypes';
import { getPrimaryDomainProfile } from '../domainProfiles';
import type {
  BaAgentFocus,
  DocumentImpact,
  DocumentOperation,
  DocumentSectionKey,
  IntentClassification,
  ResearchType,
  RiskLevel,
  SubIntent,
} from './intentTypes';

export interface IntentProfileInput {
  userMessage: string;
  hasDocument?: boolean;
  hasSelectedText?: boolean;
}

export interface DeterministicIntentProfile {
  id: string;
  subIntent: SubIntent;
  confidence: number;
  targetSection?: DocumentSectionKey;
  secondaryTargetSection?: DocumentSectionKey;
  documentImpact?: DocumentImpact;
  operation?: DocumentOperation;
  riskLevel?: RiskLevel;
  requiresResearch?: boolean;
  researchType?: ResearchType;
  requiresClarification?: boolean;
  requiresPreview?: boolean;
  shouldRunBaAgentLoop?: boolean;
  baAgentFocus?: BaAgentFocus;
  bypassModel?: boolean;
  reason: string;
}

function normalizeIntentText(value = ''): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0131/g, 'i')
    .replace(/\u015f/g, 's')
    .replace(/\u011f/g, 'g')
    .replace(/\u00fc/g, 'u')
    .replace(/\u00f6/g, 'o')
    .replace(/\u00e7/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function updatesDocumentProfile(
  id: string,
  subIntent: SubIntent,
  reason: string,
  options: Partial<DeterministicIntentProfile> = {},
): DeterministicIntentProfile {
  return {
    id,
    subIntent,
    confidence: options.confidence ?? 0.92,
    targetSection: options.targetSection ?? 'businessAnalysis',
    documentImpact: options.documentImpact ?? 'updates_document',
    operation: options.operation ?? 'patch_section',
    riskLevel: options.riskLevel ?? 'medium',
    requiresResearch: options.requiresResearch ?? false,
    researchType: options.researchType,
    requiresClarification: false,
    requiresPreview: options.requiresPreview ?? false,
    shouldRunBaAgentLoop: options.shouldRunBaAgentLoop ?? true,
    baAgentFocus: options.baAgentFocus ?? 'business_analysis',
    bypassModel: options.bypassModel ?? true,
    reason,
  };
}

function workflowProfile(
  id: string,
  subIntent: SubIntent,
  reason: string,
  confidence = 0.96,
): DeterministicIntentProfile {
  return {
    id,
    subIntent,
    confidence,
    documentImpact: 'workflow_action_only',
    operation: 'none',
    riskLevel: 'low',
    requiresResearch: false,
    requiresClarification: false,
    requiresPreview: false,
    shouldRunBaAgentLoop: false,
    bypassModel: true,
    reason,
  };
}

function requestsNewConceptualArtifact(text: string): boolean {
  const namesArtifact = /\b(ba analiz|is analiz|kavramsal tasarim|brd|fdd|gereksinim dokumani|proje dokumani)\b/.test(text);
  const asksCreation = /\b(hazirla|olustur|uret|yaz|yazalim|taslakla|cikar)\b/.test(text);
  return namesArtifact && asksCreation;
}

export function detectDeterministicIntentProfile(input: IntentProfileInput): DeterministicIntentProfile | null {
  const text = normalizeIntentText(input.userMessage);
  if (!text) return null;
  const primaryDomainProfile = getPrimaryDomainProfile(input.userMessage);

  if (input.hasSelectedText && /\b(bunu|sunu|burayi|secili metni)\b/.test(text)) {
    if (/\b(acikla|anlat|nedir|ozetle)\b/.test(text)) {
      return {
        id: 'selected_text_explain',
        subIntent: 'explain_selected_text',
        confidence: 0.9,
        documentImpact: 'none',
        operation: 'none',
        riskLevel: 'low',
        requiresClarification: false,
        shouldRunBaAgentLoop: false,
        bypassModel: true,
        reason: 'deterministic:selected_text_explain',
      };
    }
    return {
      id: 'selected_text_edit',
      subIntent: 'improve_selected_text',
      confidence: 0.9,
      documentImpact: 'updates_selected_text',
      operation: 'patch_selected_node',
      riskLevel: 'low',
      requiresClarification: false,
      shouldRunBaAgentLoop: false,
      bypassModel: true,
      reason: 'deterministic:selected_text_edit',
    };
  }

  if (/\b(indir|download|export|disa aktar|docx|word olarak indir|pdf)\b/.test(text)) {
    return workflowProfile('workflow_export', 'export_document', 'deterministic:workflow_export');
  }

  if (/\b(paylas|paylasim|link)\b/.test(text)) {
    return workflowProfile('workflow_share', 'share_document', 'deterministic:workflow_share', 0.88);
  }

  if (/\b(versiyon|degisiklik gecmisi|son degisiklik|history)\b/.test(text)) {
    return workflowProfile('workflow_history', 'show_change_history', 'deterministic:workflow_history', 0.88);
  }

  if (/\b(word format|word sablon|sablona|sablonuna|formatina duzelt|kavramsal format|kurumsal format)\b/.test(text)) {
    return updatesDocumentProfile('quick_word_format', 'normalize_format', 'deterministic:quick_word_format', {
      operation: 'patch_section',
      baAgentFocus: 'business_analysis',
      targetSection: 'businessAnalysis',
    });
  }

  if (/\b(eksikleri tamamla|eksiklerini tamamla|detaylandir|derinlestir|daha dolu|genislet)\b/.test(text)) {
    return updatesDocumentProfile('quick_complete_gaps', 'expand_section', 'deterministic:quick_complete_gaps', {
      operation: 'patch_section',
      baAgentFocus: 'business_analysis',
      targetSection: 'businessAnalysis',
    });
  }

  if (requestsNewConceptualArtifact(text)) {
    return updatesDocumentProfile('document_generation', 'generate_business_analysis', 'deterministic:explicit_conceptual_generation', {
      operation: input.hasDocument ? 'patch_section' : 'replace_or_create_section',
      baAgentFocus: 'business_analysis',
      targetSection: 'businessAnalysis',
      confidence: 0.96,
      bypassModel: true,
    });
  }

  if (/\b(review|acik konu|acik sorular|riskler|kalite puani|kalite raporu)\b/.test(text)
    && /\b(kapat|tamamla|guncelle|hazirla|neden|incele|raporla|duzelt)\b/.test(text)) {
    return updatesDocumentProfile('quick_review_action', 'generate_review_report', 'deterministic:quick_review_action', {
      targetSection: 'review',
      operation: 'patch_section',
      baAgentFocus: 'review',
    });
  }

  if (/\b(uat|test senaryo|test case|kabul kriter|negatif test|pozitif test)\b/.test(text)) {
    return updatesDocumentProfile('analysis_test_focus', 'generate_test_cases', 'deterministic:analysis_test_focus', {
      baAgentFocus: 'test',
      targetSection: 'businessAnalysis',
    });
  }

  if (/\b(bpmn|mermaid|akis diyagram|surec akisi|flow)\b/.test(text)) {
    return updatesDocumentProfile('analysis_flow_focus', 'generate_flow_diagram', 'deterministic:analysis_flow_focus', {
      baAgentFocus: 'flow',
      targetSection: 'businessAnalysis',
    });
  }

  if (/\b(api kontrat|api contract|endpoint|servis sozlesmesi|entegrasyon kontrati)\b/.test(text)) {
    return updatesDocumentProfile('analysis_api_focus', 'generate_api_contract', 'deterministic:analysis_api_focus', {
      baAgentFocus: 'technical_analysis',
      targetSection: 'businessAnalysis',
      requiresResearch: /\b(resmi|guncel|kaynak|dokumantasyon|standard)\b/.test(text),
      researchType: /\b(resmi|guncel|kaynak|dokumantasyon|standard)\b/.test(text) ? 'web' : undefined,
    });
  }

  const sourceResearch = /\b(resmi kaynak|kaynakli|kaynakla|dogrula|guncel|mevzuat|kanun|yonetmelik|best practice|api dokumantasyon|standard)\b/.test(text);
  if (sourceResearch) {
    const documentGeneration = /\b(dokuman|analiz|kavramsal|tasarim|hazirla|olustur|yaz|uygula|isle|ekle)\b/.test(text);
    return documentGeneration
      ? updatesDocumentProfile('research_apply_to_document', 'generate_business_analysis', 'deterministic:research_apply_to_document', {
          requiresResearch: true,
          researchType: 'web',
          baAgentFocus: /\b(api|entegrasyon|sap|crm|iys)\b/.test(text) ? 'technical_analysis' : 'business_analysis',
          targetSection: 'businessAnalysis',
        })
      : {
          id: 'research_web',
          subIntent: 'research_web',
          confidence: 0.9,
          documentImpact: 'suggests_update',
          operation: 'none',
          riskLevel: /\b(mevzuat|kanun|yonetmelik)\b/.test(text) ? 'high' : 'medium',
          requiresResearch: true,
          researchType: 'web',
          requiresClarification: false,
          shouldRunBaAgentLoop: false,
          bypassModel: true,
          reason: 'deterministic:research_web',
        };
  }

  if (primaryDomainProfile?.id === 'sap_crm_iys') {
    return updatesDocumentProfile('domain_sap_crm_iys', 'generate_integration_analysis', 'deterministic:domain_sap_crm_iys', {
      baAgentFocus: 'technical_analysis',
      requiresResearch: true,
      researchType: 'web',
      targetSection: 'businessAnalysis',
      confidence: 0.94,
    });
  }

  if (primaryDomainProfile?.id === 'sap_crm_ai_sales_bot') {
    return updatesDocumentProfile('domain_sap_crm_ai_sales_bot', 'generate_business_analysis', 'deterministic:domain_sap_crm_ai_sales_bot', {
      baAgentFocus: 'business_analysis',
      requiresResearch: true,
      researchType: 'web',
      targetSection: 'businessAnalysis',
      confidence: 0.93,
    });
  }

  if (primaryDomainProfile?.id === 'project_tracking_pemp') {
    return updatesDocumentProfile('domain_project_tracking', 'generate_business_analysis', 'deterministic:domain_project_tracking', {
      baAgentFocus: 'business_analysis',
      targetSection: 'businessAnalysis',
      confidence: 0.9,
    });
  }

  if (/\b(ba analiz|is analiz|kavramsal tasarim|brd|fdd|gereksinim dokumani|proje dokumani)\b/.test(text)) {
    return updatesDocumentProfile('document_generation', 'generate_business_analysis', 'deterministic:document_generation', {
      baAgentFocus: 'business_analysis',
      targetSection: 'businessAnalysis',
      confidence: 0.86,
      bypassModel: false,
    });
  }

  return null;
}

export function applyIntentProfileToClassification(
  classification: IntentClassification,
  profile: DeterministicIntentProfile | null,
): IntentClassification {
  if (!profile) return classification;

  return {
    ...classification,
    primaryIntent: PRIMARY_BY_SUB[profile.subIntent],
    subIntent: profile.subIntent,
    targetSection: profile.targetSection ?? classification.targetSection,
    secondaryTargetSection: profile.secondaryTargetSection ?? classification.secondaryTargetSection,
    documentImpact: profile.documentImpact ?? classification.documentImpact,
    operation: profile.operation ?? classification.operation,
    riskLevel: profile.riskLevel ?? classification.riskLevel,
    requiresResearch: profile.requiresResearch ?? classification.requiresResearch,
    researchType: profile.researchType ?? classification.researchType,
    requiresClarification: profile.requiresClarification ?? classification.requiresClarification,
    requiresPreview: profile.requiresPreview ?? classification.requiresPreview,
    shouldRunBaAgentLoop: profile.shouldRunBaAgentLoop ?? classification.shouldRunBaAgentLoop,
    baAgentFocus: profile.baAgentFocus ?? classification.baAgentFocus,
    confidence: Math.max(classification.confidence, profile.confidence),
    reason: `${classification.reason}; ${profile.reason}`,
  };
}

export function buildIntentProfilePromptContext(profile: DeterministicIntentProfile | null): string {
  if (!profile) return '[DETERMINISTIC INTENT PROFILE]\n- Eslesen deterministik profil yok; classifier serbest degerlendirebilir.';
  return [
    '[DETERMINISTIC INTENT PROFILE]',
    `- Profil: ${profile.id}`,
    `- SubIntent: ${profile.subIntent}`,
    `- Hedef bolum: ${profile.targetSection || 'none'}`,
    `- Dokuman etkisi: ${profile.documentImpact || 'none'}`,
    `- BA odagi: ${profile.baAgentFocus || 'none'}`,
    `- Research: ${profile.requiresResearch ? profile.researchType || 'yes' : 'no'}`,
    `- Soru sorma: ${profile.requiresClarification ? 'evet' : 'hayir'}`,
    `- Guven: ${profile.confidence}`,
    `- Neden: ${profile.reason}`,
  ].join('\n');
}
