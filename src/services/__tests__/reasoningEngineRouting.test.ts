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

  it('does not confuse a business control integration with an incident diagnosis', () => {
    expect(routeReasoningRequest('SAP CRM ile FICA arasındaki borç kontrol entegrasyonunu analiz et.')).toMatchObject({
      intent: 'analysis',
      complexity: 'medium',
      knowledgeRequired: true,
    });
  });

  it('recognizes Turkish-inflected process wording in decision requests', () => {
    expect(routeReasoningRequest('Onay süreci için alternatif çözümleri karşılaştır ve en uygun yaklaşımı öner.')).toMatchObject({
      intent: 'decision',
      complexity: 'medium',
      creativeMode: true,
    });
  });

  it('recognizes normalized uçtan uca wording as high complexity', () => {
    expect(routeReasoningRequest('EVERH ters kayıt problemini uçtan uca incele.')).toMatchObject({
      intent: 'sap_diagnosis',
      complexity: 'high',
      webMode: 'if_internal_insufficient',
    });
  });

  it('does not promote every integration mention to high complexity', () => {
    expect(routeReasoningRequest('Mevcut CRM entegrasyon yaklaşımımızla karşılaştırmak için güncel SAP entegrasyon API önerilerini webde araştır.')).toMatchObject({
      intent: 'research',
      complexity: 'medium',
      webMode: 'required',
    });
  });
});
