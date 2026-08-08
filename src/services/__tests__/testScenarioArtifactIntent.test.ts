import { describe, expect, it } from 'vitest';
import { resolveAssistantDocumentRequestMode } from '../assistantDocumentIntent';

describe('test scenario artifact intent', () => {
  it.each([
    'Negatif, sınır değer, yetki ve entegrasyon hata test senaryolarını tablo halinde hazırla.',
    'Bu süreç için test senaryosu oluştur',
    'Given When Then test case üret',
  ])('routes an explicit test artifact request to Canvas: %s', message => {
    expect(resolveAssistantDocumentRequestMode(message, null)).toBe('create');
  });

  it.each([
    'Test senaryoları neden gerekli?',
    'Bu test case hakkında ne düşünüyorsun?',
    'Test senaryolarını açıkla',
  ])('keeps non-creation test discussion in chat: %s', message => {
    expect(resolveAssistantDocumentRequestMode(message, null)).toBe('none');
  });
});
