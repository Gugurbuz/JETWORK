export type AgenticGoldenCategory =
  | 'exact_technical'
  | 'broad_analysis'
  | 'follow_up_continuity'
  | 'artifact_completion'
  | 'current_web'
  | 'memory_correction'
  | 'mixed_capabilities'

export interface AgenticRuntimeV2GoldenScenario {
  id: string
  category: AgenticGoldenCategory
  turns: string[]
  requiredCapabilities: string[]
  forbiddenBehaviors: string[]
  assertions: string[]
}

/**
 * P6 release-gate contract for Agent Controller V2. These scenarios describe
 * behavior, not hard-coded routes: discovery may return candidates, but the
 * controller remains the semantic decision authority.
 */
export const AGENTIC_RUNTIME_V2_GOLDEN_SCENARIOS: AgenticRuntimeV2GoldenScenario[] = [
  {
    id: 'agent-v2-01-exact-technical-evidence',
    category: 'exact_technical',
    turns: ['ZCRM2-586 mesajı hangi durumda üretiliyor?'],
    requiredCapabilities: ['knowledge'],
    forbiddenBehaviors: ['answer_without_verified_detail', 'keyword_route'],
    assertions: ['verified_evidence_required', 'source_provenance_required'],
  },
  {
    id: 'agent-v2-02-broad-analysis-multi-source',
    category: 'broad_analysis',
    turns: ['CRM teklif kayıt akışındaki riskleri, bağımlılıkları ve iyileştirme alanlarını analiz et.'],
    requiredCapabilities: ['knowledge', 'critic'],
    forbiddenBehaviors: ['single_search_force_synthesis', 'domain_keyword_route'],
    assertions: ['coverage_observation_present', 'conflicts_visible_when_present'],
  },
  {
    id: 'agent-v2-03-follow-up-resolved-state',
    category: 'follow_up_continuity',
    turns: ['Önce internal canary ile çıkacağız.', 'Tamam, kaldığımız yerden rollout planına devam et.'],
    requiredCapabilities: ['resolved_context'],
    forbiddenBehaviors: ['full_history_required', 'stale_decision_resurrection'],
    assertions: ['latest_decision_preserved', 'continuation_without_reasking'],
  },
  {
    id: 'agent-v2-04-docx-completion-invariant',
    category: 'artifact_completion',
    turns: ['Bu analizi Enerjisa formatında Word dokümanı olarak oluştur.'],
    requiredCapabilities: ['load_document_contract', 'create_document_file', 'artifact_verifier'],
    forbiddenBehaviors: ['claim_completion_before_executor', 'claim_completion_before_reload'],
    assertions: ['executor_success_required', 'reload_required', 'integrity_required', 'persistence_required'],
  },
  {
    id: 'agent-v2-05-current-web-decision',
    category: 'current_web',
    turns: ['İYS entegrasyon dokümanına ihtiyacım var güncel'],
    requiredCapabilities: ['web'],
    forbiddenBehaviors: [
      'static_knowledge_presented_as_current',
      'web_keyword_route',
      'legacy_semantic_plan_controls_capability',
      'top_k_hides_web',
      'generic_grounding_failure_before_recovery',
    ],
    assertions: [
      'fresh_source_required',
      'controller_selects_web',
      'neutral_v2_advisory_plan',
      'foundational_web_available',
    ],
  },
  {
    id: 'agent-v2-06-user-correction-wins',
    category: 'memory_correction',
    turns: ['Production rollout doğrudan %100 olsun.', 'Düzeltme: önce internal canary, sonra 10-25-50-100 gidelim.'],
    requiredCapabilities: ['resolved_context', 'project_memory'],
    forbiddenBehaviors: ['assistant_hypothesis_persisted', 'old_decision_resurrected'],
    assertions: ['correction_supersedes_old_version', 'user_source_required_for_decision'],
  },
  {
    id: 'agent-v2-07-mixed-research-artifact',
    category: 'mixed_capabilities',
    turns: ['Kaynakları incele, mevcut mimariyle karşılaştır, eksikleri çıkar ve sonucu Word dokümanı olarak üret.'],
    requiredCapabilities: ['capability_discovery', 'knowledge', 'critic', 'load_document_contract', 'create_document_file', 'artifact_verifier'],
    forbiddenBehaviors: ['artifact_keyword_route', 'fixed_capability_sequence'],
    assertions: ['controller_replans_after_observations', 'artifact_completion_invariant'],
  },
]
