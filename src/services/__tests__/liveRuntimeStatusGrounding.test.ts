import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  attachSemanticPlan,
  buildSemanticExecutionPlan,
} from '../../../supabase/functions/_shared/semanticOrchestrator';
import {
  semanticPlanFromMessage,
  type ReasoningPlan,
} from '../../../supabase/functions/_shared/reasoningEngine';
import {
  buildAssistantWorkActivities,
  formatAssistantWorkActivityLabel,
} from '../../components/AssistantWorkIndicator';

const suppliedRequirementText = `
B2B portal update servis güncellemesi
1.1.15 B2B Portal ekranlarındaki müşteri izinleri servisleri güncellenmelidir. Yeni giriş ve güncellemeler aynı kaydet akışından yönetilecektir.
1.1.16 TEİ izinleri müşteri üzerindeki Müşteri İzinleri tabında, grup içi grup dışı bilgileri ilgili kişi üzerindeki Pazarlama İzinlerinde tutulacaktır.
1.1.17 TEİ izinlerini yalnız master kullanıcı güncelleyebilir. Master olmayan bir ilgili kişi TEİ iznini güncellemeye çalıştığında servisten hata mesajı dönülmelidir.
1.1.18 Grup içi grup dışı izinlerini ilgili kişiler güncelleyebilir olmaya devam edecektir.
1.1.19 Güncelleme butona basıldığı anda değil, Kaydet butonu ile tamamlanacaktır ve servisler buna göre güncellenecektir.
1.1.20 Tek veya toplu güncelleme yapılabilir olacaktır. Master değil ise yalnız grup içi grup dışı izinleri güncellenebilir.
1.1.21 İzin alınabilecek bölgeler müşterinin aktif veya pasif sözleşmelerine göre servisten dönecektir.
1.1.22 Bölgeler alfabetik sıralı dönmelidir. Sözleşme durumu alınamazsa bölge gösterilmemelidir.
1.1.23 Sözleşmeden bağımsız girilmiş izin read servisinden dönmelidir.
1.1.24 1294 kampanya ID için mevcut KOHM kuralı devam edecektir.
`;

describe('Live runtime status and grounding regression', () => {
  it('keeps the semantic plan as advisory enterprise context for a supplied structured requirement', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: suppliedRequirementText,
      conversation: [],
    });

    expect(result.plan.intent).toBe('analysis');
    expect(result.plan.knowledgeRequired).toBe(true);
    expect(result.plan.enterpriseGroundingRequired).toBe(true);
    expect(result.plan.webMode).toBe('none');
    expect(result.plan.verificationRequired).toBe(false);
    expect(result.plan.evidenceQueries).toEqual([]);
  });

  it('preserves an explicit semantic decision not to require enterprise grounding', () => {
    const plan: ReasoningPlan = {
      intent: 'sap_diagnosis',
      complexity: 'medium',
      executionMode: 'knowledge',
      goal: 'Kullanıcı talebini değerlendir.',
      knowledgeRequired: true,
      enterpriseGroundingRequired: false,
      webMode: 'none',
      verificationRequired: false,
      creativeMode: false,
      evidenceQueries: [],
      steps: [{
        id: 'primary-agent-loop',
        label: 'Talebi değerlendir',
        toolHint: 'synthesis',
        successCriteria: 'Gerekirse capability kullan.',
      }],
      orchestratorVersion: 'primary-llm-agent-v1',
    };

    const normalized = semanticPlanFromMessage(
      attachSemanticPlan('ZCRM2-545 hangi koşulda alınır?', plan),
    );

    expect(normalized?.enterpriseGroundingRequired).toBe(false);
  });

  it('shows a meaningful live activity from the initial assistant connection phase', () => {
    const activities = buildAssistantWorkActivities({
      isActive: true,
      phaseLabel: 'Asistana bağlanılıyor...',
    });

    expect(activities).toEqual([
      { label: 'Asistana bağlanılıyor...', state: 'active' },
    ]);
    expect(formatAssistantWorkActivityLabel(activities[0].label, false))
      .toBe('Asistana bağlanılıyor...');
  });

  it('uses Gemini Interactions as the V3 semantic-controller provider path', () => {
    const providerSource = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
      'utf8',
    );
    const interactionSource = readFileSync(
      new URL('../../../supabase/functions/_shared/geminiInteractionsAgent.ts', import.meta.url),
      'utf8',
    );
    const controllerPolicy = readFileSync(
      new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),
      'utf8',
    );

    expect(providerSource).toContain('requestGeminiInteractionsResponse')
    expect(providerSource).toContain('AGENT_CONTROLLER_INSTRUCTION')
    expect(providerSource).not.toContain('requestBaseWithEnterpriseEvidenceReplan')
    expect(providerSource).not.toContain('extractSemanticPlanFromItems')
    expect(interactionSource).toContain("GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'")
    expect(interactionSource).toContain("{ type: 'google_search'")
    expect(interactionSource).toContain("{ type: 'url_context' }")
    expect(interactionSource).toContain("{ type: 'code_execution' }")
    expect(interactionSource).toContain("tool_choice: 'validated'")
    expect(controllerPolicy).toContain('semantic controller ve assistant modelisin')
    expect(controllerPolicy).toContain('Her tool observationından sonra')
  });

  it('uses a full model-visible capability surface instead of semantic Top-K routing', () => {
    const runtimeSource = readFileSync(
      new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
      'utf8',
    );
    const surfaceSource = readFileSync(
      new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
      'utf8',
    );

    expect(runtimeSource).toContain('startControllerCapabilitySession({');
    expect(runtimeSource).toContain('capabilitySession?.surface.tools || []');
    expect(runtimeSource).toContain('capabilitySession?.surface.providerWebVisible === true');
    expect(runtimeSource).not.toContain("AGENTIC_CONTROLLER_ENABLED || plan.webMode !== 'none'");
    expect(runtimeSource).toContain("MAX_TOOL_CALLS = boundedIntegerEnv('ASSISTANT_V2_MAX_TOOL_CALLS', 24");
    expect(surfaceSource).toContain("CONTROLLER_CAPABILITY_SURFACE_VERSION = 'controller-capability-surface-v3-full'")
    expect(surfaceSource).toContain('...runtimeTools')
    expect(surfaceSource).toContain('providerWebVisible: true')
    expect(surfaceSource).not.toContain('TOP_K_DEFAULT')
    expect(surfaceSource).not.toContain('discoverIndexedCapabilities')
    expect(surfaceSource).not.toContain('CONTROLLER_TOOL_GUIDANCE')
  });

  it('treats server-side assistant SSE errors as terminal instead of reconnecting the failed turn', () => {
    const recoverySource = readFileSync(
      new URL('../assistantTransportRecovery.ts', import.meta.url),
      'utf8',
    );

    expect(recoverySource).toContain("if (eventName === 'error')");
    expect(recoverySource).toContain('state.completedSeen = true');
    expect(recoverySource).toContain('terminal application event');
  });
});
