import { describe, expect, it } from 'vitest';
import { routeReasoningRequest } from '../../../supabase/functions/_shared/reasoningEngine';

describe('production reasoning calibration regressions', () => {
  it('keeps exploratory follow-up questions in chat instead of document intent', () => {
    const route = routeReasoningRequest(
      'Sistemde daha önce yaratılmış üzerinde bakanlık bilgisi dolu olmayan boş olan maliyet belgeleri için nasıl davranacak burayı hayal edemiyorum',
    );

    expect(route.intent).not.toBe('document');
  });

  it('keeps a design follow-up out of document generation unless the user asks for a document action', () => {
    const route = routeReasoningRequest(
      'Bakımı SM 30 işlem koduyla son kullanıcıya bırakamayız çünkü SM 30 işlem kodu fonksiyonellere özel. İş biriminin bu tablonun bakımını yapacağı bir transaction kod oluşturulmalı.',
    );

    // The production regression is accidental artifact/document routing. The
    // deterministic router may legitimately classify this compact follow-up as
    // simple_answer or analysis depending on its explicit technical anchors.
    expect(route.intent).not.toBe('document');
  });

  it('still routes an explicit document command to the document runtime', () => {
    const route = routeReasoningRequest('Tamam, iş analizi dokümanını oluştur.');

    expect(route.intent).toBe('document');
    expect(route.complexity).toBe('high');
    expect(route.knowledgeRequired).toBe(true);
  });
});
