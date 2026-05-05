// Central intent taxonomy for JETWORK Single Chat Orchestrator.

export type PrimaryIntent =
  | 'conversation'
  | 'requirement_intake'
  | 'analysis_generation'
  | 'document_editing'
  | 'selected_text_editing'
  | 'quality_review'
  | 'research'
  | 'memory_decision'
  | 'workflow'
  | 'system_fallback';

export type DocumentImpact =
  | 'none'
  | 'suggests_update'
  | 'updates_document'
  | 'updates_selected_text'
  | 'updates_memory_only'
  | 'workflow_action_only'
  | 'requires_user_confirmation';

export type DocumentOperation =
  | 'none'
  | 'create_section'
  | 'replace_or_create_section'
  | 'append_to_section'
  | 'replace_section'
  | 'patch_section'
  | 'patch_selected_node'
  | 'extract_to_another_section'
  | 'move_content'
  | 'remove_content'
  | 'update_status'
  | 'update_flags'
  | 'update_quality_score'
  | 'generate_new_artifact'
  | 'create_version'
  | 'restore_version';

export type DocumentSectionKey =
  | 'businessAnalysis'
  | 'code'
  | 'test'
  | 'bpmn'
  | 'review';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ResearchType = 'internal' | 'web' | 'uploaded_files' | 'workspace_history';

export type BaAgentFocus =
  | 'business_analysis'
  | 'technical_analysis'
  | 'test'
  | 'flow'
  | 'review'
  | 'quality';

export type SubIntent =
  // 6.1 Conversation
  | 'ask_explanation'
  | 'ask_opinion'
  | 'ask_comparison'
  | 'ask_how_to'
  | 'ask_summary'
  | 'ask_definition'
  | 'small_talk'
  | 'help_usage'
  // 6.2 Requirement intake
  | 'start_new_requirement'
  | 'add_requirement_detail'
  | 'answer_clarification'
  | 'identify_missing_information'
  | 'convert_raw_idea_to_scope'
  | 'define_problem_statement'
  | 'define_target_outcome'
  | 'capture_business_rule'
  | 'capture_constraint'
  | 'capture_assumption'
  // 6.3 Analysis generation
  | 'generate_business_analysis'
  | 'generate_technical_analysis'
  | 'generate_user_stories'
  | 'generate_acceptance_criteria'
  | 'generate_functional_requirements'
  | 'generate_non_functional_requirements'
  | 'generate_business_rules'
  | 'generate_data_mapping'
  | 'generate_integration_analysis'
  | 'generate_api_contract'
  | 'generate_error_scenarios'
  | 'generate_test_cases'
  | 'generate_flow_diagram'
  | 'generate_bpmn'
  | 'generate_mermaid'
  | 'generate_review_report'
  | 'generate_release_notes'
  | 'generate_developer_handoff'
  // 6.4 Document editing
  | 'revise_section'
  | 'append_to_section'
  | 'replace_section'
  | 'rewrite_section'
  | 'expand_section'
  | 'shorten_section'
  | 'restructure_section'
  | 'merge_sections'
  | 'split_section'
  | 'move_content'
  | 'remove_content'
  | 'normalize_format'
  | 'convert_to_table'
  | 'convert_to_bullets'
  | 'convert_to_user_story_format'
  | 'convert_to_corporate_language'
  | 'make_more_technical'
  | 'make_more_business_friendly'
  | 'localize_language'
  // 6.5 Selected text editing
  | 'improve_selected_text'
  | 'rewrite_selected_text'
  | 'expand_selected_text'
  | 'shorten_selected_text'
  | 'make_selected_text_corporate'
  | 'make_selected_text_clearer'
  | 'make_selected_text_technical'
  | 'extract_tests_from_selected_text'
  | 'extract_risks_from_selected_text'
  | 'extract_acceptance_criteria_from_selected_text'
  | 'turn_selected_text_into_user_story'
  | 'explain_selected_text'
  | 'replace_selected_text'
  // 6.6 Quality & review
  | 'review_document_quality'
  | 'find_missing_sections'
  | 'find_inconsistencies'
  | 'find_ambiguities'
  | 'find_assumptions'
  | 'find_risks'
  | 'find_open_questions'
  | 'check_testability'
  | 'check_traceability'
  | 'check_acceptance_criteria_quality'
  | 'check_nfr_coverage'
  | 'check_integration_completeness'
  | 'check_data_completeness'
  | 'score_document'
  | 'prepare_review_summary'
  | 'prepare_management_summary'
  // 6.7 Research
  | 'research_internal_knowledge'
  | 'research_uploaded_files'
  | 'research_workspace_history'
  | 'research_web'
  | 'research_best_practice'
  | 'research_api_or_standard'
  | 'research_regulation'
  | 'research_similar_examples'
  | 'summarize_research'
  | 'apply_research_to_document'
  // 6.8 Memory
  | 'save_decision'
  | 'save_requirement'
  | 'save_constraint'
  | 'save_assumption'
  | 'save_business_rule'
  | 'save_term'
  | 'list_decisions'
  | 'list_open_questions'
  | 'resolve_open_question'
  | 'update_decision'
  | 'remove_memory'
  | 'confirm_assumption'
  | 'reject_assumption'
  // 6.9 Workflow
  | 'export_document'
  | 'export_section'
  | 'prepare_download'
  | 'share_document'
  | 'compare_versions'
  | 'restore_version'
  | 'show_change_history'
  | 'show_last_changes'
  | 'approve_section'
  | 'mark_needs_revision'
  | 'mark_review_ready'
  | 'create_new_workspace'
  | 'rename_workspace'
  // 6.10 System fallback
  | 'ambiguous_request'
  | 'unsupported_request'
  | 'zero_touch_requested'
  | 'agent_debate_requested'
  | 'missing_context'
  | 'missing_selection'
  | 'unsafe_document_change'
  | 'invalid_command'
  | 'error_recovery';

export interface IntentClassification {
  primaryIntent: PrimaryIntent;
  subIntent: SubIntent;
  targetSection?: DocumentSectionKey;
  secondaryTargetSection?: DocumentSectionKey;
  operation: DocumentOperation;
  documentImpact: DocumentImpact;
  confidence: number;
  riskLevel: RiskLevel;
  requiresResearch: boolean;
  researchType?: ResearchType;
  requiresClarification: boolean;
  clarificationQuestions?: string[];
  requiresPreview: boolean;
  shouldRunBaAgentLoop: boolean;
  baAgentFocus?: BaAgentFocus;
  reason: string;
}

// Lookup of which SubIntents belong to which PrimaryIntent. Used for fallback
// validation and for mapping default DocumentImpact when the classifier is unsure.
export const PRIMARY_BY_SUB: Record<SubIntent, PrimaryIntent> = {
  ask_explanation: 'conversation',
  ask_opinion: 'conversation',
  ask_comparison: 'conversation',
  ask_how_to: 'conversation',
  ask_summary: 'conversation',
  ask_definition: 'conversation',
  small_talk: 'conversation',
  help_usage: 'conversation',
  start_new_requirement: 'requirement_intake',
  add_requirement_detail: 'requirement_intake',
  answer_clarification: 'requirement_intake',
  identify_missing_information: 'requirement_intake',
  convert_raw_idea_to_scope: 'requirement_intake',
  define_problem_statement: 'requirement_intake',
  define_target_outcome: 'requirement_intake',
  capture_business_rule: 'requirement_intake',
  capture_constraint: 'requirement_intake',
  capture_assumption: 'requirement_intake',
  generate_business_analysis: 'analysis_generation',
  generate_technical_analysis: 'analysis_generation',
  generate_user_stories: 'analysis_generation',
  generate_acceptance_criteria: 'analysis_generation',
  generate_functional_requirements: 'analysis_generation',
  generate_non_functional_requirements: 'analysis_generation',
  generate_business_rules: 'analysis_generation',
  generate_data_mapping: 'analysis_generation',
  generate_integration_analysis: 'analysis_generation',
  generate_api_contract: 'analysis_generation',
  generate_error_scenarios: 'analysis_generation',
  generate_test_cases: 'analysis_generation',
  generate_flow_diagram: 'analysis_generation',
  generate_bpmn: 'analysis_generation',
  generate_mermaid: 'analysis_generation',
  generate_review_report: 'analysis_generation',
  generate_release_notes: 'analysis_generation',
  generate_developer_handoff: 'analysis_generation',
  revise_section: 'document_editing',
  append_to_section: 'document_editing',
  replace_section: 'document_editing',
  rewrite_section: 'document_editing',
  expand_section: 'document_editing',
  shorten_section: 'document_editing',
  restructure_section: 'document_editing',
  merge_sections: 'document_editing',
  split_section: 'document_editing',
  move_content: 'document_editing',
  remove_content: 'document_editing',
  normalize_format: 'document_editing',
  convert_to_table: 'document_editing',
  convert_to_bullets: 'document_editing',
  convert_to_user_story_format: 'document_editing',
  convert_to_corporate_language: 'document_editing',
  make_more_technical: 'document_editing',
  make_more_business_friendly: 'document_editing',
  localize_language: 'document_editing',
  improve_selected_text: 'selected_text_editing',
  rewrite_selected_text: 'selected_text_editing',
  expand_selected_text: 'selected_text_editing',
  shorten_selected_text: 'selected_text_editing',
  make_selected_text_corporate: 'selected_text_editing',
  make_selected_text_clearer: 'selected_text_editing',
  make_selected_text_technical: 'selected_text_editing',
  extract_tests_from_selected_text: 'selected_text_editing',
  extract_risks_from_selected_text: 'selected_text_editing',
  extract_acceptance_criteria_from_selected_text: 'selected_text_editing',
  turn_selected_text_into_user_story: 'selected_text_editing',
  explain_selected_text: 'selected_text_editing',
  replace_selected_text: 'selected_text_editing',
  review_document_quality: 'quality_review',
  find_missing_sections: 'quality_review',
  find_inconsistencies: 'quality_review',
  find_ambiguities: 'quality_review',
  find_assumptions: 'quality_review',
  find_risks: 'quality_review',
  find_open_questions: 'quality_review',
  check_testability: 'quality_review',
  check_traceability: 'quality_review',
  check_acceptance_criteria_quality: 'quality_review',
  check_nfr_coverage: 'quality_review',
  check_integration_completeness: 'quality_review',
  check_data_completeness: 'quality_review',
  score_document: 'quality_review',
  prepare_review_summary: 'quality_review',
  prepare_management_summary: 'quality_review',
  research_internal_knowledge: 'research',
  research_uploaded_files: 'research',
  research_workspace_history: 'research',
  research_web: 'research',
  research_best_practice: 'research',
  research_api_or_standard: 'research',
  research_regulation: 'research',
  research_similar_examples: 'research',
  summarize_research: 'research',
  apply_research_to_document: 'research',
  save_decision: 'memory_decision',
  save_requirement: 'memory_decision',
  save_constraint: 'memory_decision',
  save_assumption: 'memory_decision',
  save_business_rule: 'memory_decision',
  save_term: 'memory_decision',
  list_decisions: 'memory_decision',
  list_open_questions: 'memory_decision',
  resolve_open_question: 'memory_decision',
  update_decision: 'memory_decision',
  remove_memory: 'memory_decision',
  confirm_assumption: 'memory_decision',
  reject_assumption: 'memory_decision',
  export_document: 'workflow',
  export_section: 'workflow',
  prepare_download: 'workflow',
  share_document: 'workflow',
  compare_versions: 'workflow',
  restore_version: 'workflow',
  show_change_history: 'workflow',
  show_last_changes: 'workflow',
  approve_section: 'workflow',
  mark_needs_revision: 'workflow',
  mark_review_ready: 'workflow',
  create_new_workspace: 'workflow',
  rename_workspace: 'workflow',
  ambiguous_request: 'system_fallback',
  unsupported_request: 'system_fallback',
  zero_touch_requested: 'system_fallback',
  agent_debate_requested: 'system_fallback',
  missing_context: 'system_fallback',
  missing_selection: 'system_fallback',
  unsafe_document_change: 'system_fallback',
  invalid_command: 'system_fallback',
  error_recovery: 'system_fallback',
};

export const ALL_SUB_INTENTS = Object.keys(PRIMARY_BY_SUB) as SubIntent[];

// Default DocumentImpact/Operation/Risk when the classifier omits a field.
export interface IntentDefaults {
  impact: DocumentImpact;
  operation: DocumentOperation;
  risk: RiskLevel;
  targetSection?: DocumentSectionKey;
  shouldRunBaAgentLoop?: boolean;
  baAgentFocus?: BaAgentFocus;
}

export const INTENT_DEFAULTS: Partial<Record<SubIntent, IntentDefaults>> = {
  // Conversation
  ask_explanation: { impact: 'none', operation: 'none', risk: 'low' },
  ask_opinion: { impact: 'none', operation: 'none', risk: 'low' },
  ask_comparison: { impact: 'none', operation: 'none', risk: 'low' },
  ask_how_to: { impact: 'none', operation: 'none', risk: 'low' },
  ask_summary: { impact: 'none', operation: 'none', risk: 'low' },
  ask_definition: { impact: 'none', operation: 'none', risk: 'low' },
  small_talk: { impact: 'none', operation: 'none', risk: 'low' },
  help_usage: { impact: 'none', operation: 'none', risk: 'low' },
  // Requirement intake
  start_new_requirement: { impact: 'suggests_update', operation: 'create_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true, baAgentFocus: 'business_analysis' },
  add_requirement_detail: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  answer_clarification: { impact: 'updates_document', operation: 'patch_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  identify_missing_information: { impact: 'suggests_update', operation: 'update_flags', risk: 'low', targetSection: 'review' },
  convert_raw_idea_to_scope: { impact: 'updates_document', operation: 'patch_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  define_problem_statement: { impact: 'updates_document', operation: 'patch_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  define_target_outcome: { impact: 'updates_document', operation: 'patch_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  capture_business_rule: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'businessAnalysis' },
  capture_constraint: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  capture_assumption: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  // Analysis generation
  generate_business_analysis: { impact: 'updates_document', operation: 'replace_or_create_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true, baAgentFocus: 'business_analysis' },
  generate_technical_analysis: { impact: 'updates_document', operation: 'replace_or_create_section', risk: 'medium', targetSection: 'code', shouldRunBaAgentLoop: true, baAgentFocus: 'technical_analysis' },
  generate_user_stories: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  generate_acceptance_criteria: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  generate_functional_requirements: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  generate_non_functional_requirements: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  generate_business_rules: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  generate_data_mapping: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'businessAnalysis', shouldRunBaAgentLoop: true },
  generate_integration_analysis: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'code', shouldRunBaAgentLoop: true, baAgentFocus: 'technical_analysis' },
  generate_api_contract: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'code', shouldRunBaAgentLoop: true, baAgentFocus: 'technical_analysis' },
  generate_error_scenarios: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'test', shouldRunBaAgentLoop: true, baAgentFocus: 'test' },
  generate_test_cases: { impact: 'updates_document', operation: 'replace_or_create_section', risk: 'medium', targetSection: 'test', shouldRunBaAgentLoop: true, baAgentFocus: 'test' },
  generate_flow_diagram: { impact: 'updates_document', operation: 'replace_or_create_section', risk: 'medium', targetSection: 'bpmn', shouldRunBaAgentLoop: true, baAgentFocus: 'flow' },
  generate_bpmn: { impact: 'updates_document', operation: 'replace_or_create_section', risk: 'medium', targetSection: 'bpmn', shouldRunBaAgentLoop: true, baAgentFocus: 'flow' },
  generate_mermaid: { impact: 'updates_document', operation: 'replace_or_create_section', risk: 'medium', targetSection: 'bpmn', shouldRunBaAgentLoop: true, baAgentFocus: 'flow' },
  generate_review_report: { impact: 'updates_document', operation: 'replace_or_create_section', risk: 'medium', targetSection: 'review', shouldRunBaAgentLoop: true, baAgentFocus: 'review' },
  generate_release_notes: { impact: 'updates_document', operation: 'append_to_section', risk: 'low', targetSection: 'review' },
  generate_developer_handoff: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'code', shouldRunBaAgentLoop: true },
  // Document editing
  revise_section: { impact: 'updates_document', operation: 'patch_section', risk: 'medium', shouldRunBaAgentLoop: true },
  append_to_section: { impact: 'updates_document', operation: 'append_to_section', risk: 'low', shouldRunBaAgentLoop: true },
  replace_section: { impact: 'requires_user_confirmation', operation: 'replace_section', risk: 'high', shouldRunBaAgentLoop: true },
  rewrite_section: { impact: 'requires_user_confirmation', operation: 'replace_section', risk: 'high', shouldRunBaAgentLoop: true },
  expand_section: { impact: 'updates_document', operation: 'patch_section', risk: 'medium', shouldRunBaAgentLoop: true },
  shorten_section: { impact: 'updates_document', operation: 'patch_section', risk: 'medium', shouldRunBaAgentLoop: true },
  restructure_section: { impact: 'requires_user_confirmation', operation: 'patch_section', risk: 'high', shouldRunBaAgentLoop: true },
  merge_sections: { impact: 'requires_user_confirmation', operation: 'patch_section', risk: 'high' },
  split_section: { impact: 'requires_user_confirmation', operation: 'patch_section', risk: 'high' },
  move_content: { impact: 'requires_user_confirmation', operation: 'move_content', risk: 'high' },
  remove_content: { impact: 'requires_user_confirmation', operation: 'remove_content', risk: 'high' },
  normalize_format: { impact: 'updates_document', operation: 'patch_section', risk: 'low' },
  convert_to_table: { impact: 'updates_document', operation: 'patch_section', risk: 'low' },
  convert_to_bullets: { impact: 'updates_document', operation: 'patch_section', risk: 'low' },
  convert_to_user_story_format: { impact: 'updates_document', operation: 'patch_section', risk: 'low', targetSection: 'businessAnalysis' },
  convert_to_corporate_language: { impact: 'updates_document', operation: 'patch_section', risk: 'low' },
  make_more_technical: { impact: 'updates_document', operation: 'patch_section', risk: 'medium' },
  make_more_business_friendly: { impact: 'updates_document', operation: 'patch_section', risk: 'low' },
  localize_language: { impact: 'updates_document', operation: 'patch_section', risk: 'low' },
  // Selected text
  improve_selected_text: { impact: 'updates_selected_text', operation: 'patch_selected_node', risk: 'low' },
  rewrite_selected_text: { impact: 'updates_selected_text', operation: 'patch_selected_node', risk: 'medium' },
  expand_selected_text: { impact: 'updates_selected_text', operation: 'patch_selected_node', risk: 'medium' },
  shorten_selected_text: { impact: 'updates_selected_text', operation: 'patch_selected_node', risk: 'low' },
  make_selected_text_corporate: { impact: 'updates_selected_text', operation: 'patch_selected_node', risk: 'low' },
  make_selected_text_clearer: { impact: 'updates_selected_text', operation: 'patch_selected_node', risk: 'low' },
  make_selected_text_technical: { impact: 'updates_selected_text', operation: 'patch_selected_node', risk: 'medium' },
  extract_tests_from_selected_text: { impact: 'updates_document', operation: 'extract_to_another_section', risk: 'medium', targetSection: 'test' },
  extract_risks_from_selected_text: { impact: 'updates_document', operation: 'extract_to_another_section', risk: 'medium', targetSection: 'review' },
  extract_acceptance_criteria_from_selected_text: { impact: 'updates_document', operation: 'extract_to_another_section', risk: 'medium', targetSection: 'businessAnalysis' },
  turn_selected_text_into_user_story: { impact: 'updates_document', operation: 'extract_to_another_section', risk: 'medium', targetSection: 'businessAnalysis' },
  explain_selected_text: { impact: 'none', operation: 'none', risk: 'low' },
  replace_selected_text: { impact: 'updates_selected_text', operation: 'patch_selected_node', risk: 'medium' },
  // Quality
  review_document_quality: { impact: 'updates_document', operation: 'update_quality_score', risk: 'medium', targetSection: 'review', shouldRunBaAgentLoop: true, baAgentFocus: 'quality' },
  find_missing_sections: { impact: 'updates_document', operation: 'update_flags', risk: 'low', targetSection: 'review' },
  find_inconsistencies: { impact: 'updates_document', operation: 'update_flags', risk: 'medium', targetSection: 'review' },
  find_ambiguities: { impact: 'updates_document', operation: 'update_flags', risk: 'medium', targetSection: 'review' },
  find_assumptions: { impact: 'updates_document', operation: 'update_flags', risk: 'low', targetSection: 'review' },
  find_risks: { impact: 'updates_document', operation: 'append_to_section', risk: 'medium', targetSection: 'review', shouldRunBaAgentLoop: true, baAgentFocus: 'review' },
  find_open_questions: { impact: 'updates_document', operation: 'append_to_section', risk: 'low', targetSection: 'review' },
  check_testability: { impact: 'updates_document', operation: 'update_flags', risk: 'medium', targetSection: 'test' },
  check_traceability: { impact: 'updates_document', operation: 'update_flags', risk: 'medium', targetSection: 'test' },
  check_acceptance_criteria_quality: { impact: 'updates_document', operation: 'update_flags', risk: 'medium', targetSection: 'businessAnalysis' },
  check_nfr_coverage: { impact: 'updates_document', operation: 'update_flags', risk: 'medium', targetSection: 'businessAnalysis' },
  check_integration_completeness: { impact: 'updates_document', operation: 'update_flags', risk: 'medium', targetSection: 'code' },
  check_data_completeness: { impact: 'updates_document', operation: 'update_flags', risk: 'medium', targetSection: 'businessAnalysis' },
  score_document: { impact: 'updates_document', operation: 'update_quality_score', risk: 'low', targetSection: 'review' },
  prepare_review_summary: { impact: 'updates_document', operation: 'replace_or_create_section', risk: 'low', targetSection: 'review', shouldRunBaAgentLoop: true, baAgentFocus: 'review' },
  prepare_management_summary: { impact: 'updates_document', operation: 'append_to_section', risk: 'low', targetSection: 'review', shouldRunBaAgentLoop: true },
  // Research
  research_internal_knowledge: { impact: 'suggests_update', operation: 'none', risk: 'medium' },
  research_uploaded_files: { impact: 'suggests_update', operation: 'none', risk: 'medium' },
  research_workspace_history: { impact: 'none', operation: 'none', risk: 'low' },
  research_web: { impact: 'suggests_update', operation: 'none', risk: 'medium' },
  research_best_practice: { impact: 'suggests_update', operation: 'none', risk: 'medium' },
  research_api_or_standard: { impact: 'suggests_update', operation: 'none', risk: 'medium' },
  research_regulation: { impact: 'suggests_update', operation: 'none', risk: 'high' },
  research_similar_examples: { impact: 'suggests_update', operation: 'none', risk: 'medium' },
  summarize_research: { impact: 'none', operation: 'none', risk: 'low' },
  apply_research_to_document: { impact: 'updates_document', operation: 'patch_section', risk: 'medium', shouldRunBaAgentLoop: true },
  // Memory
  save_decision: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  save_requirement: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  save_constraint: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  save_assumption: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  save_business_rule: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  save_term: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  list_decisions: { impact: 'none', operation: 'none', risk: 'low' },
  list_open_questions: { impact: 'none', operation: 'none', risk: 'low' },
  resolve_open_question: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  update_decision: { impact: 'updates_memory_only', operation: 'none', risk: 'medium' },
  remove_memory: { impact: 'updates_memory_only', operation: 'none', risk: 'medium' },
  confirm_assumption: { impact: 'updates_memory_only', operation: 'none', risk: 'low' },
  reject_assumption: { impact: 'updates_memory_only', operation: 'none', risk: 'medium' },
  // Workflow
  export_document: { impact: 'workflow_action_only', operation: 'generate_new_artifact', risk: 'low' },
  export_section: { impact: 'workflow_action_only', operation: 'generate_new_artifact', risk: 'low' },
  prepare_download: { impact: 'workflow_action_only', operation: 'generate_new_artifact', risk: 'low' },
  share_document: { impact: 'workflow_action_only', operation: 'none', risk: 'medium' },
  compare_versions: { impact: 'workflow_action_only', operation: 'none', risk: 'low' },
  restore_version: { impact: 'requires_user_confirmation', operation: 'restore_version', risk: 'high' },
  show_change_history: { impact: 'workflow_action_only', operation: 'none', risk: 'low' },
  show_last_changes: { impact: 'workflow_action_only', operation: 'none', risk: 'low' },
  approve_section: { impact: 'updates_document', operation: 'update_status', risk: 'low' },
  mark_needs_revision: { impact: 'updates_document', operation: 'update_status', risk: 'low' },
  mark_review_ready: { impact: 'updates_document', operation: 'update_status', risk: 'low' },
  create_new_workspace: { impact: 'workflow_action_only', operation: 'none', risk: 'low' },
  rename_workspace: { impact: 'workflow_action_only', operation: 'none', risk: 'low' },
  // System fallback
  ambiguous_request: { impact: 'none', operation: 'none', risk: 'low' },
  unsupported_request: { impact: 'none', operation: 'none', risk: 'low' },
  zero_touch_requested: { impact: 'none', operation: 'none', risk: 'low' },
  agent_debate_requested: { impact: 'none', operation: 'none', risk: 'low' },
  missing_context: { impact: 'none', operation: 'none', risk: 'low' },
  missing_selection: { impact: 'none', operation: 'none', risk: 'low' },
  unsafe_document_change: { impact: 'requires_user_confirmation', operation: 'replace_section', risk: 'high' },
  invalid_command: { impact: 'none', operation: 'none', risk: 'low' },
  error_recovery: { impact: 'none', operation: 'none', risk: 'low' },
};

export const SLASH_COMMAND_MAP: Record<string, { primary: PrimaryIntent; sub: SubIntent; target?: DocumentSectionKey }> = {
  '/analiz': { primary: 'analysis_generation', sub: 'generate_business_analysis', target: 'businessAnalysis' },
  '/story': { primary: 'analysis_generation', sub: 'generate_user_stories', target: 'businessAnalysis' },
  '/test': { primary: 'analysis_generation', sub: 'generate_test_cases', target: 'test' },
  '/flow': { primary: 'analysis_generation', sub: 'generate_flow_diagram', target: 'bpmn' },
  '/bpmn': { primary: 'analysis_generation', sub: 'generate_bpmn', target: 'bpmn' },
  '/mermaid': { primary: 'analysis_generation', sub: 'generate_mermaid', target: 'bpmn' },
  '/risk': { primary: 'quality_review', sub: 'find_risks', target: 'review' },
  '/review': { primary: 'quality_review', sub: 'review_document_quality', target: 'review' },
  '/nfr': { primary: 'analysis_generation', sub: 'generate_non_functional_requirements', target: 'businessAnalysis' },
  '/api': { primary: 'analysis_generation', sub: 'generate_api_contract', target: 'code' },
  '/data': { primary: 'analysis_generation', sub: 'generate_data_mapping', target: 'businessAnalysis' },
  '/ozet': { primary: 'quality_review', sub: 'prepare_management_summary', target: 'review' },
  '/export': { primary: 'workflow', sub: 'export_document' },
  '/ekip': { primary: 'system_fallback', sub: 'zero_touch_requested' },
};
