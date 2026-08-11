import { describe, expect, it } from 'vitest';
import {
  isArtifactMaturationContext,
  looksLikeCompletedEnerjisaArtifact,
  parseAssistantPresentationMetadata,
} from '../assistantPresentationMetadata';

describe('assistant presentation metadata', () => {
  it('keeps normal Q&A free of work-summary and action-summary chrome', () => {
    const parsed = parseAssistantPresentationMetadata(`
Kısa kullanıcı cevabı burada.

<jetwork_meta>
{
  "workSummary": [
    "Talebi mevcut sohbet bağlamıyla karşılaştırdım.",
    "Kurumsal bilgi bankasında ilgili teknik kayıtları kontrol ettim."
  ],
  "questions": [
    {
      "id": "q1",
      "text": "Ürün kodu da değişmeli mi?",
      "options": ["Evet", "Hayır"]
    }
  ],
  "actionSummary": "Sonucu teknik kanıtla eşleştirip cevapladım."
}
</jetwork_meta>
    `);

    expect(parsed.visibleText).toBe('Kısa kullanıcı cevabı burada.');
    expect(parsed.workSummary).toBeUndefined();
    expect(parsed.questions).toEqual([
      {
        id: 'q1',
        text: 'Ürün kodu da değişmeli mi?',
        options: ['Evet', 'Hayır'],
      },
    ]);
    expect(parsed.actionSummary).toBeUndefined();
  });

  it('keeps operational metadata available for explicit artifact maturation', () => {
    const parsed = parseAssistantPresentationMetadata(`
Dokümanı tamamlamak için iki kararı netleştirmem gerekiyor.
<jetwork_meta>
${JSON.stringify({
  workSummary: ['Mevcut dokümanı kontrol ettim.'],
  questions: [{ id: 'q1', text: 'Offline kullanım gerekli mi?', options: ['Evet', 'Hayır'] }],
  actionSummary: 'Cevabından sonra dokümanı oluşturmaya devam edeceğim.',
})}
</jetwork_meta>
    `);

    expect(parsed.workSummary).toContain('Mevcut dokümanı kontrol ettim.');
    expect(parsed.actionSummary).toBe('Cevabından sonra dokümanı oluşturmaya devam edeceğim.');
    expect(parsed.questions).toEqual([
      { id: 'q1', text: 'Offline kullanım gerekli mi?', options: [] },
    ]);
  });

  it('strips model-suggested options from artifact maturation questions', () => {
    const parsed = parseAssistantPresentationMetadata(`
Dokümanı tamamlamak için birkaç kararı netleştirmem gerekiyor.
<jetwork_meta>
${JSON.stringify({
  questions: [
    { id: 'q1', text: 'Mobil uygulamada hangi roller işlem yapacak?', options: ['Saha çalışanı', 'Yönetici'] },
    { id: 'q2', text: 'Offline kullanım gerekli mi?', options: ['Evet', 'Hayır'] },
  ],
  actionSummary: 'Yanıtlarından sonra iş analizi dokümanını hazırlamaya devam edeceğim.',
})}
</jetwork_meta>
    `);

    expect(parsed.questions).toEqual([
      { id: 'q1', text: 'Mobil uygulamada hangi roller işlem yapacak?', options: [] },
      { id: 'q2', text: 'Offline kullanım gerekli mi?', options: [] },
    ]);
  });

  it('suppresses stale questions once a complete Enerjisa artifact is present', () => {
    const document = `
# İHTİYAÇ ANALİZİ
## 1. ANALİZ KAPSAMI
## 4. FONKSİYONEL GEREKSİNİMLER (FR)
## 8. FONKSİYONEL TASARIM DOKÜMANLARI
`;
    expect(looksLikeCompletedEnerjisaArtifact(document)).toBe(true);

    const parsed = parseAssistantPresentationMetadata(`
${document}
<jetwork_meta>
${JSON.stringify({
  questions: [{ id: 'q1', text: 'Başka bir detay ekleyelim mi?', options: ['Evet', 'Hayır'] }],
  actionSummary: 'Dokümanı oluşturdum.',
})}
</jetwork_meta>
    `);

    expect(parsed.questions).toBeUndefined();
    expect(parsed.actionSummary).toBe('Dokümanı oluşturdum.');
  });

  it('detects artifact maturation context without treating ordinary analysis as artifact work', () => {
    expect(isArtifactMaturationContext({
      visibleText: 'Dokümanı tamamlamak için iki bilgiye ihtiyacım var.',
      actionSummary: 'Cevabından sonra dokümanı oluşturacağım.',
    })).toBe(true);
    expect(isArtifactMaturationContext({
      visibleText: 'Analizi tamamladım ve sonucu aşağıda özetledim.',
      actionSummary: 'Teknik analizi yanıtladım.',
    })).toBe(false);
  });

  it('hides an incomplete metadata block while streaming', () => {
    expect(parseAssistantPresentationMetadata(`Yanıt tamamlandı.\n<jetwork_meta>{"workSummary":`).visibleText)
      .toBe('Yanıt tamamlandı.');
  });

  it('strips metadata even when the model emits it before the answer', () => {
    const parsed = parseAssistantPresentationMetadata(`
<jetwork_meta>{ "workSummary": [], "actionSummary": "" }</jetwork_meta>
ZCL_ORDER_SAVE_QUOTATIONS->CHECK_ZTKS metodu iki hata mesajı üretir.
    `);

    expect(parsed.visibleText).toBe('ZCL_ORDER_SAVE_QUOTATIONS->CHECK_ZTKS metodu iki hata mesajı üretir.');
    expect(parsed.visibleText).not.toContain('<jetwork_meta>');
    expect(parsed.workSummary).toBeUndefined();
    expect(parsed.actionSummary).toBeUndefined();
  });

  it('keeps legacy answers unchanged when metadata is absent', () => {
    expect(parseAssistantPresentationMetadata('Normal cevap').visibleText).toBe('Normal cevap');
  });

  it('does not let malformed metadata break the visible answer', () => {
    const parsed = parseAssistantPresentationMetadata(`
Normal cevap
<jetwork_meta>
{not-json}
</jetwork_meta>
    `);

    expect(parsed.visibleText).toBe('Normal cevap');
    expect(parsed.workSummary).toBeUndefined();
    expect(parsed.questions).toBeUndefined();
  });

  it('caps interactive questions and options', () => {
    const questions = Array.from({ length: 5 }, (_, index) => ({
      text: `Soru ${index + 1}?`,
      options: ['A', 'B', 'C', 'D', 'E'],
    }));
    const parsed = parseAssistantPresentationMetadata(`
Yanıt
<jetwork_meta>${JSON.stringify({ questions })}</jetwork_meta>
    `);

    expect(parsed.questions).toHaveLength(3);
    expect(parsed.questions?.[0].options).toHaveLength(4);
  });
});
