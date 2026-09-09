import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { AGENT_CONTROLLER_INSTRUCTION } from '../../../supabase/functions/_shared/agent/controllerPolicy'
import { buildResolvedConversationInstruction } from '../../../supabase/functions/_shared/resolvedConversationContext'

const reasoningEngineSource = readFileSync(
  new URL('../../../supabase/functions/_shared/reasoningEngine.ts', import.meta.url),
  'utf8',
)

describe('direct-core controller continuity contract', () => {
  it('keeps runtime plan context advisory and leaves semantic resolution to the controller', () => {
    const runtimeContext = buildResolvedConversationInstruction({ resolvedRequest: 'Teklifteki' })

    expect(runtimeContext).toContain('Runtime plan hedef adayı: Teklifteki')
    expect(runtimeContext).toContain('semantik otorite değildir')
    expect(runtimeContext).toContain('tek başına yeni görev veya konu reseti sayma')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('direct-core/neutral fallback')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('provider continuation')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Goal alanını kullanıcı mesajından daha yüksek öncelikli')
  })

  it('does not let the neutral fallback redefine the semantic goal as the latest raw utterance', () => {
    expect(reasoningEngineSource).toContain('agent-controller-v2-core-neutral-context-fallback-v2')
    expect(reasoningEngineSource).toContain('semantik hedef burada tanımlanmaz')
    expect(reasoningEngineSource).not.toContain("goal: currentMessage || 'Kullanıcı talebini doğru ve güvenli biçimde yanıtla.'")
  })

  it('defines the green-energy three-turn example as one evolving task', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('yeşil enerji kontrolü')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('"Teklifteki"')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('"Sen bulcaksın"')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('üç bağımsız görev değildir')
  })

  it('requires evidence-economy and public semantic progress without deterministic routing', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('aynı controller roundunda paralel')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Güçlü candidate varken')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('report_progress(kind=finding)')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Verified observation zaten mesaj kodu')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Runtime/bridge yalnız authorization')
  })

  it('requires final synthesis to assimilate verified findings instead of re-asking them', () => {
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('finding ile belirli bir teknik referansı')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('final cevap finding ile çelişemez')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('Final answer ile current-turn evidence arasında assimilation zorunludur')
    expect(AGENT_CONTROLLER_INSTRUCTION).toContain('yalnız gerçek ürün/iş kararı kaldığında')
  })
})
