import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DocumentData } from '../../types';
import { resolveAssistantDocumentRequestMode } from '../assistantDocumentIntent';
import {
  routeReasoningRequest,
  routingSurfaceFromMessage,
} from '../../../supabase/functions/_shared/reasoningEngine';

const gatewaySource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-v2/index.ts', import.meta.url),
  'utf8',
);
const providerSource = readFileSync(
  new URL('../../../supabase/functions/_shared/modelProviders.ts', import.meta.url),
  'utf8',
);
const reasoningSource = readFileSync(
  new URL('../../../supabase/functions/_shared/reasoningEngine.ts', import.meta.url),
  'utf8',
);
const settingsSource = readFileSync(
  new URL('../../store/useSettingsStore.ts', import.meta.url),
  'utf8',
);

const existingDocument = {
  businessAnalysis: {
    content: '<h1>İHTİYAÇ ANALİZİ</h1><p>Mevcut doküman.</p>',
    status: 'DRAFT',
    flags: [],
  },
  review: {
    content: '',
    status: 'DRAFT',
    flags: [],
  },
} as DocumentData;

describe('provider, evidence and intent integrity', () => {
  it('does not treat Turkish inflections as document edit commands', () => {
    expect(resolveAssistantDocumentRequestMode(
      'Teklife cost eklerken aldım hatayı',
      existingDocument,
    )).toBe('none');
    expect(resolveAssistantDocumentRequestMode(
      'Teklif oluştururken uyumsuz hata alıyorum',
      existingDocument,
    )).toBe('none');
  });

  it('routes offer save mismatch questions through corporate technical diagnosis', () => {
    expect(routeReasoningRequest('Teklif kaydederken uyumsuz hatası alıyorum')).toMatchObject({
      intent: 'sap_diagnosis',
      knowledgeRequired: true,
      verificationRequired: true,
      webMode: 'none',
    });
  });

  it('keeps generated document/template text out of explicit web intent', () => {
    const expandedMessage = [
      'Kurumsal yapıda kavramsal tasarım dokümanı hazırla.',
      '',
      '[Sistem yönlendirmesi: Kullanıcı açıkça düzenlenebilir bir Enerjisa ihtiyaç analizi dokümanı istiyor.]',
      'Mevcut dokümanda güncel fiyat ve bugün ifadeleri bulunuyor.',
    ].join('\n');

    expect(routingSurfaceFromMessage(expandedMessage).current).toBe(
      'Kurumsal yapıda kavramsal tasarım dokümanı hazırla.',
    );
    expect(routeReasoningRequest(expandedMessage)).toMatchObject({
      intent: 'document',
      webMode: 'none',
    });
  });

  it('inherits a substantive technical subject for an ambiguous follow-up', () => {
    const followUp = [
      '?',
      '',
      '[JETWORK_ROUTING_CONTEXT]',
      'ZCRM2-545 hata kodu nedir',
      '[END_JETWORK_ROUTING_CONTEXT]',
    ].join('\n');

    expect(routeReasoningRequest(followUp)).toMatchObject({
      intent: 'sap_diagnosis',
      knowledgeRequired: true,
      verificationRequired: true,
    });
  });

  it('does not reinterpret internal price wording as an external web request', () => {
    expect(routeReasoningRequest('Güncel fiyat kodu teklifte uyumsuz görünüyor')).toMatchObject({
      knowledgeRequired: true,
      webMode: 'none',
    });
  });

  it('keeps deterministic web policy authoritative over the planner', () => {
    expect(reasoningSource).toContain('webMode: input.route.webMode');
    expect(reasoningSource).not.toContain("webMode: input.route.webMode === 'required' ? 'required' : proposed.webMode");
  });

  it('blocks hidden OpenAI web use when the user explicitly selected Gemini', () => {
    expect(gatewaySource).toContain('GEMINI_PROVIDER_LOCK_WEB_UNAVAILABLE');
    expect(gatewaySource).toContain('isExplicitGeminiModel(requestedModel)');
    expect(gatewaySource).toContain('EXPLICIT_WEB_PATTERN.test(normalizedRoutingMessage)');
    expect(gatewaySource).toContain('Web araştırması için Otomatik veya OpenAI modelini seçin.');
  });

  it('attaches previous user context only for ambiguous follow-up routing', () => {
    expect(gatewaySource).toContain('previousSubstantiveUserMessage');
    expect(gatewaySource).toContain('[JETWORK_ROUTING_CONTEXT]');
    expect(gatewaySource).toContain('[END_JETWORK_ROUTING_CONTEXT]');
    expect(gatewaySource).toContain('AMBIGUOUS_FOLLOW_UP_PATTERN');
  });

  it('promotes substantive Flash Lite execution to Gemini Pro while leaving trivial fast path separate', () => {
    expect(providerSource).toContain("GEMINI_SUBSTANTIVE_MODEL = 'gemini-3.1-pro-preview'");
    expect(providerSource).toContain('!trivialConversation && input.model === GEMINI_FLASH_LITE_MODEL');
    expect(providerSource).toContain('model: executionModel');
    expect(gatewaySource).toContain("reason: 'flash_lite_substantive_promoted_to_pro'");
    expect(settingsSource).toContain('normalizeSelectableModel');
    expect(settingsSource).toContain('model === FLASH_LITE_MODEL ? GEMINI_PRO_MODEL');
  });

  it('requires exact evidence for exact Gemini SAP/CRM identifiers', () => {
    expect(providerSource).toContain('[JETWORK KANIT BÜTÜNLÜĞÜ - ZORUNLU]');
    expect(providerSource).toContain('yakın kodlar veya benzer SAP süreçleri o kimlik için kanıt değildir');
    expect(providerSource).toContain('class, method, mesaj metni, tetikleyici veya çözüm uydurma');
  });
});