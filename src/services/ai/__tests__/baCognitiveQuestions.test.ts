import { describe, expect, it } from 'vitest';
import { buildBaCognitiveQuestionItems, type BaCognitiveFrame } from '../baCognitiveFrame';

function frameWithGap(topic: string, question: string): BaCognitiveFrame {
  return {
    informationGaps: [{
      topic,
      question,
      impact: 'high',
      reversibility: 'expensive',
      canAssume: false,
      reason: 'Yanlış karar sonraki tasarımı değiştirir.',
    }],
  } as BaCognitiveFrame;
}

describe('BA cognitive question presentation', () => {
  it('matches system ownership options to a system gap', () => {
    const [item] = buildBaCognitiveQuestionItems(
      frameWithGap('Kaynak ve hedef sistem sahipliği', 'Kaynak sistem, hedef sistem ve ana veri sahibi hangi uygulamadır?'),
    );

    expect(item.options).toContain('Mevcut operasyon sistemi kaynak');
    expect(item.options).not.toContain('Uyum/risk azaltma');
  });

  it('matches document options to a mandatory-document gap', () => {
    const [item] = buildBaCognitiveQuestionItems(
      frameWithGap('Zorunlu belge ve evraklar', 'Hangi belge olmadan süreç ilerleyemez?'),
    );

    expect(item.options).toContain('Zorunlu belge olmadan ilerlemesin');
    expect(item.options).not.toContain('Kullanici baslatir, sistem kontrollu ilerler');
  });

  it('does not expose internal impact or reversibility codes', () => {
    const [item] = buildBaCognitiveQuestionItems(
      frameWithGap('Ana süreç', 'Ana süreç hangi tetikleyiciyle başlar?'),
    );

    expect(item.text).toContain('Neden önemli:');
    expect(item.text).not.toMatch(/Etki=|geri donus=/);
  });
});
