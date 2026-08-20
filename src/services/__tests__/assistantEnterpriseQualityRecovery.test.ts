import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Assistant enterprise quality recovery contracts', () => {
  it('keeps exact enterprise, technical follow-ups and Cost evidence requests above the Lite floor', () => {
    const gateway = read('../../../supabase/functions/openai-assistant-v2-quality/index.ts');

    expect(gateway).toContain('const TECHNICAL_FOLLOW_UP');
    expect(gateway).toContain('|| TECHNICAL_FOLLOW_UP.test(message)');
    expect(gateway).toContain('(COST_EVIDENCE.test(message) && COST_INTENT.test(message))');
    expect(gateway).toContain("parsed.model = 'gemini-3.5-flash'");
    expect(gateway).toContain("reason: 'enterprise_evidence_quality_floor'");
  });

  it('forces exact message-code questions and verified follow-ups onto authoritative detail evidence', () => {
    const semantic = read('../../../supabase/functions/_shared/semanticOrchestratorQuality.ts');

    expect(semantic).toContain('const exactMessageLookup = Boolean(exactMessage) && !costKnowledge');
    expect(semantic).toContain('const verifiedMessageFollowUp = technicalFollowUp && Boolean(verifiedMessage) && !sourceCodeRequested');
    expect(semantic).toContain("id: boundedExactEvidence ? 'exact-enterprise-detail'");
    expect(semantic).toContain('enterpriseGroundingRequired: true');
    expect(semantic).toContain('verificationRequired: boundedExactEvidence ? false : true');
    expect(semantic).toContain('get_message_detail(messageCode=');
    expect(semantic).toContain('Kaynakta olmayan acronym açılımı');
  });

  it('keeps both Cost-list phrasings scoped to the ZCRM_COST message inventory', () => {
    const semantic = read('../../../supabase/functions/_shared/semanticOrchestratorQuality.ts');

    expect(semantic).toContain('const COST_TERM = /\\bcost\\b/iu');
    expect(semantic).toContain('const COST_EVIDENCE_INTENT');
    expect(semantic).toContain("tool: 'list_knowledge_catalog'");
    expect(semantic).toContain("objectType: 'message'");
    expect(semantic).toContain("prefix: 'ZCRM_COST'");
    expect(semantic).toContain('ZCRM_COST mesajlarını kurumsal bilgi kataloğundan eksiksiz listele');
  });

  it('does not reopen broad verification after an authoritative exact-detail plan is selected', () => {
    const reasoning = read('../../../supabase/functions/_shared/reasoningEngineQuality.ts');

    expect(reasoning).toContain("plan.steps?.some(step => step.id === 'exact-enterprise-detail')");
    expect(reasoning).toContain('plan.enterpriseGroundingRequired === true');
    expect(reasoning).toContain('plan.knowledgeRequired === true');
    expect(reasoning).toContain('verificationRequired: false');
  });

  it('preserves verified identifiers while removing unsupported acronym expansions from streamed exact-detail answers', () => {
    const providers = read('../../../supabase/functions/_shared/modelProvidersExactQuality.ts');
    const guard = read('../../../supabase/functions/_shared/acronymEvidenceGuard.ts');

    expect(providers).toContain("from './acronymEvidenceGuard.ts'");
    expect(providers).toContain('sanitizeUnsupportedAcronymExpansions(chunk, input.evidence)');
    expect(providers).toContain('quality_exact_detail_stream_guard');
    expect(providers).toContain('quality_unsupported_acronym_expansions_removed');
    expect(guard).toContain('supportedByEvidence');
    expect(guard).toContain('normalizeForEvidence');
    expect(guard).toContain('**${acronym}**');
  });
});
