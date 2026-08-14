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
  it('treats a supplied structured requirement as analysis input instead of SAP diagnosis evidence lookup', async () => {
    const result = await buildSemanticExecutionPlan({
      provider: 'gemini',
      model: 'gemini-3.1-pro-preview',
      message: suppliedRequirementText,
      conversation: [],
    });

    expect(result.plan.intent).toBe('analysis');
    expect(result.plan.knowledgeRequired).toBe(false);
    expect(result.plan.enterpriseGroundingRequired).toBe(false);
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
      .toBe('Talebin kapsamı değerlendiriliyor...');
  });

  it('bounds empty Gemini knowledge searches and keeps one no-tool blank-final recovery', () => {
    const providerSource = readFileSync(
      new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
      'utf8',
    );

    expect(providerSource).toContain('MAX_EMPTY_KNOWLEDGE_SEARCHES = 2');
    expect(providerSource).toContain('countEmptyKnowledgeSearches');
    expect(providerSource).toContain('emptyKnowledgeSearches >= MAX_EMPTY_KNOWLEDGE_SEARCHES');
    expect(providerSource).toContain('gemini_empty_knowledge_forced_synthesis');
    expect(providerSource).toContain('gemini_empty_final_retry');
    expect(providerSource).toContain('tools: []');
    expect(providerSource).toContain('allowTools: false');
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