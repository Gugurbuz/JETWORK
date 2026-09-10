from pathlib import Path

# 1) Runtime semantic grounding is no longer allowed to veto/finalize answers.
core_path = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
core = core_path.read_text()
flag_marker = "const AGENTIC_CONTROLLER_ENABLED = String(Deno.env.get('ASSISTANT_AGENTIC_CONTROLLER') ?? 'true')\n  .trim().toLocaleLowerCase('en-US') !== 'false'\n"
flag_addition = flag_marker + "\n// Semantic truth/evidence sufficiency belongs to the Controller LLM. Runtime keeps\n// only mechanical provenance/persistence/security responsibilities and must not\n// replace a model answer via regex/identifier-based grounding adjudication.\nconst RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED = false\n"
if 'RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED' not in core:
    if flag_marker not in core:
        raise SystemExit('AGENTIC_CONTROLLER_ENABLED marker not found')
    core = core.replace(flag_marker, flag_addition, 1)
old_grounding = """            const groundingCoverage = evaluateGroundedTechnicalClaims({ text: roundText, plan, sources, toolResults: [...toolResultCache.values()], currentUserText: message })
            const groundingBlocked = shouldFailClosedGroundedAnswer({ plan, coverage: groundingCoverage })
"""
new_grounding = """            const groundingCoverage = RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED
              ? evaluateGroundedTechnicalClaims({ text: roundText, plan, sources, toolResults: [...toolResultCache.values()], currentUserText: message })
              : {
                  ok: true,
                  verifiedKnowledgeEvidence: [...toolResultCache.values()].some(resultHasVerifiedKnowledgeEvidence),
                  unsupportedIdentifiers: [],
                  messageTextMismatches: [],
                  unsupportedClaims: [],
                }
            const groundingBlocked = RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED
              && shouldFailClosedGroundedAnswer({ plan, coverage: groundingCoverage })
"""
if new_grounding not in core:
    if old_grounding not in core:
        raise SystemExit('grounding finalization marker not found')
    core = core.replace(old_grounding, new_grounding, 1)
core_path.write_text(core)

# 2) Make prior verified refs explicit continuity pointers owned semantically by Controller.
policy_path = Path('supabase/functions/_shared/agent/controllerPolicy.ts')
policy = policy_path.read_text()
followup_marker = "  'Yeni kullanıcı mesajını tek başına yeni hedef sanma. Kısa takip, düzeltme, reddetme, kapsam daraltma/genişletme veya \"sen bul\" gibi delegasyon ifadelerini önceki çözülmüş görevle birleştir. Kullanıcının son mesajı önceki bağlamı değiştiriyorsa yeni resolved goal bunu açıkça yansıtsın.',\n"
followup_addition = followup_marker + "  'Önceki turnlerde exact/detail araçlarıyla doğrulanmış kanıt referansları varsa bunları konuşma sürekliliğinin provenance pointerları olarak kullan. Aynı teknik konunun follow-upında sıfırdan broad search ile başlamadan önce bu canonical reflerin hedef için hâlâ anlamlı olup olmadığını değerlendir; ayrıntı gerekiyorsa uygun exact/detail capability ile refi yeniden aç. Hangi refi yeniden kullanacağına, yeniden retrieval gerekip gerekmediğine ve neyin yeterli kanıt olduğuna yalnız sen karar verirsin; runtime bu semantik kararı vermez.',\n"
if 'Önceki turnlerde exact/detail araçlarıyla doğrulanmış kanıt referansları' not in policy:
    if followup_marker not in policy:
        raise SystemExit('controller follow-up marker not found')
    policy = policy.replace(followup_marker, followup_addition, 1)
runtime_marker = "  'Runtime/bridge yalnız authorization, RLS/permission, schema validation, timeout, idempotency, tool/cost/token bütçesi, provenance, persistence, safe result-size ve lifecycle eventleri gibi mekanik sınırları uygular; ne yapılacağını semantik olarak belirlemez.',\n"
runtime_addition = runtime_marker + "  'Runtime doğal dil iddialarını regex, identifier whitelist veya benzeri heuristiklerle doğru/yanlış diye veto edip kullanıcı cevabını generic bir fail-closed metinle değiştirmez. Evidence yeterliliği, çelişki, belirsizlik ve stop/final kararı Controller LLM\'e aittir; runtime yalnız gerçek tool provenanceını ve citation/source bütünlüğünü mekanik olarak korur.',\n"
if 'Runtime doğal dil iddialarını regex' not in policy:
    if runtime_marker not in policy:
        raise SystemExit('controller runtime marker not found')
    policy = policy.replace(runtime_marker, runtime_addition, 1)
policy_path.write_text(policy)

# 3) Clarify resolved-context provenance semantics for cross-turn evidence reuse.
resolved_path = Path('supabase/functions/_shared/context/resolvedContext.ts')
resolved = resolved_path.read_text()
resolved = resolved.replace(
    "    'Bu blok yalnız konuşma/görev sürekliliği içindir; kurumsal gerçek veya citation değildir.',\n",
    "    'Bu blok konuşma/görev sürekliliği içindir. İçindeki önceki doğrulanmış kanıt referansları geçmiş exact/detail retrieval provenansını gösteren pointerlardır; ref metni tek başına yeni bir iddia/citation değildir.',\n",
    1,
)
resolved = resolved.replace(
    "    seed.verifiedFactRefs?.length ? `Önceki doğrulanmış kanıt referansları (iddia değil): ${seed.verifiedFactRefs.map(value => cleanText(value, 200)).filter(Boolean).slice(0, 10).join(', ')}` : '',\n",
    "    seed.verifiedFactRefs?.length ? `Önceki doğrulanmış evidence provenance refleri: ${seed.verifiedFactRefs.map(value => cleanText(value, 200)).filter(Boolean).slice(0, 10).join(', ')}` : '',\n",
    1,
)
old_tail = "    'Yeni kullanıcı mesajı ve kullanıcı düzeltmeleri eski sohbetten üstündür. Reddedilmiş kapsam/hipotezleri kullanıcı yeniden istemedikçe geri getirme. Teknik/kurumsal iddialar için bu blok yerine gerçek knowledge/web kanıtı kullan.',\n"
new_tail = "    'Yeni kullanıcı mesajı ve kullanıcı düzeltmeleri eski sohbetten üstündür. Reddedilmiş kapsam/hipotezleri kullanıcı yeniden istemedikçe geri getirme. Follow-up aynı teknik konuya devam ediyorsa önceki doğrulanmış refleri sıfırdan broad arama yapmak yerine yeniden açılabilir başlangıç noktaları olarak değerlendir; ayrıntı gerekiyorsa uygun exact/detail capability ile refi yeniden hydrate et. Hangi refi kullanacağına ve yeniden retrieval gerekip gerekmediğine Controller karar verir.',\n"
if old_tail not in resolved and new_tail not in resolved:
    raise SystemExit('resolved context tail marker not found')
resolved = resolved.replace(old_tail, new_tail, 1)
resolved_path.write_text(resolved)

# 4) Regression tests for the exact production class of failure.
test_path = Path('src/services/__tests__/controllerOwnedEvidenceContinuity.test.ts')
test_path.write_text("""import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildResolvedConversationInstruction } from '../../../supabase/functions/_shared/resolvedConversationContext'
import { buildSemanticExecutionPlan } from '../../../supabase/functions/_shared/semanticOrchestrator'

const coreSource = readFileSync(new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url), 'utf8')
const policySource = readFileSync(new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url), 'utf8')

describe('controller-owned evidence continuity', () => {
  it('disables runtime semantic grounding as a final-answer authority', () => {
    expect(coreSource).toContain('const RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED = false')
    expect(coreSource).toContain('const groundingCoverage = RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED')
    expect(coreSource).toContain('const groundingBlocked = RUNTIME_SEMANTIC_GROUNDING_GATE_ENABLED')
    expect(policySource).toContain('Runtime doğal dil iddialarını regex')
  })

  it('exposes prior verified refs as rehydratable provenance, not as hidden semantic routing', () => {
    const instruction = buildResolvedConversationInstruction({
      resolvedRequest: 'Enerjisa LRT detayını açıklamak',
      activeEntities: ['LRT'],
      verifiedFactRefs: ['method:unscoped_class/check_lrtv3'],
    })
    expect(instruction).toContain('method:unscoped_class/check_lrtv3')
    expect(instruction).toContain('evidence provenance refleri')
    expect(instruction).toContain('yeniden açılabilir başlangıç noktaları')
    expect(policySource).toContain('canonical reflerin hedef için hâlâ anlamlı olup olmadığını değerlendir')
  })

  it('carries CHECK_LRTV3 provenance into an Enerjisa follow-up resolved state', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      message: 'Enerjisadaki detayı nedir',
      conversation: [
        { role: 'user', content: 'Lrt ne demek' },
        { role: 'assistant', content: 'LRT için Enerjisa ve CHECK_LRTV3 bağlamını araştırdım.' },
      ],
      priorExecution: {
        intent: 'analysis',
        complexity: 'medium',
        knowledgeUsed: true,
        resolvedRequest: 'LRT kısaltmasının Enerjisa bağlamındaki anlamını doğrulamak',
        activeEntities: ['LRT'],
        verifiedFactRefs: ['method:unscoped_class/check_lrtv3'],
      },
    })

    expect(result.plan.conversationState?.verifiedFactRefs).toContain('method:unscoped_class/check_lrtv3')
    expect(result.plan.conversationState?.resolvedRequest || result.plan.goal).toMatch(/LRT|Enerjisa/i)
  })
})
""")
