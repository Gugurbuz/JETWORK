import { describe, expect, it } from 'vitest';
import { routeReasoningRequest } from '../../../supabase/functions/_shared/reasoningEngine';

describe('Reasoning Engine v2 router', () => {
  it('keeps simple questions on the low-cost direct path', () => {
    expect(routeReasoningRequest('SW adımı ne demek?')).toMatchObject({
      complexity: 'low',
      webMode: 'none',
    });
  });

  it('forces corporate knowledge for SAP/CRM diagnosis', () => {
    expect(routeReasoningRequest('ZCRM_COST 030 hatası neden veriyor, kök nedeni incele')).toMatchObject({
      intent: 'sap_diagnosis',
      knowledgeRequired: true,
      verificationRequired: true,
    });
  });

  it('forces live web research when current external information is requested', () => {
    expect(routeReasoningRequest('OpenAI API web search için güncel resmi dokümanı internette araştır')).toMatchObject({
      intent: 'research',
      webMode: 'required',
      verificationRequired: true,
    });
  });

  it('marks deep architecture work as high-complexity analysis', () => {
    expect(routeReasoningRequest('SAP CRM FICA Billing entegrasyonunu uçtan uca detaylı analiz et ve mimariyi tasarla')).toMatchObject({
      intent: 'analysis',
      complexity: 'high',
      knowledgeRequired: true,
    });
  });

  it('enables creative option comparison for technical decisions', () => {
    expect(routeReasoningRequest('CRM entegrasyonu için alternatif çözümleri karşılaştır ve en iyi yaklaşımı öner')).toMatchObject({
      intent: 'decision',
      knowledgeRequired: true,
      creativeMode: true,
    });
  });

  it('preserves document intent and never makes web mandatory for generated BA documents by default', () => {
    expect(routeReasoningRequest('[Sistem yönlendirmesi: Kullanıcı doküman istedi]\nEnerjisa iş analizi dokümanı oluştur')).toMatchObject({
      intent: 'document',
      complexity: 'high',
      knowledgeRequired: true,
      webMode: 'none',
    });
  });
});
