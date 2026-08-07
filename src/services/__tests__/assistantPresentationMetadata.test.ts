import { describe, expect, it } from 'vitest';
import { parseAssistantPresentationMetadata } from '../assistantPresentationMetadata';

describe('assistant presentation metadata', () => {
  it('separates the visible answer from safe presentation metadata', () => {
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
    expect(parsed.workSummary).toContain('Talebi mevcut sohbet bağlamıyla karşılaştırdım.');
    expect(parsed.questions).toEqual([
      {
        id: 'q1',
        text: 'Ürün kodu da değişmeli mi?',
        options: ['Evet', 'Hayır'],
      },
    ]);
    expect(parsed.actionSummary).toBe('Sonucu teknik kanıtla eşleştirip cevapladım.');
  });

  it('hides an incomplete metadata block while streaming', () => {
    expect(parseAssistantPresentationMetadata(`Yanıt tamamlandı.\n<jetwork_meta>{"workSummary":`).visibleText)
      .toBe('Yanıt tamamlandı.');
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
