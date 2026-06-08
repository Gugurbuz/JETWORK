import type { DocumentData, Message } from '../src/types';
import {
  buildBaClarifyingQuestions,
  buildBaDiscoveryState,
  buildBaQualityReviewMarkdown,
  decideBaDiscovery,
  evaluateBaQualityV2,
  isLikelyBaDiscoveryAnswer,
  replaceBaEngineReviewBlock,
} from '../src/modules/ai-ba-engine';
import { buildClassification, normalizeBaClassifierOutput } from '../src/services/ai/intentClassifier';

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertIncludes(value: string, needle: string, message: string): void {
  assert(value.includes(needle), `${message}: expected "${needle}"`);
}

const emptyMessages: Message[] = [];
const vagueRequest = 'Müşteri taleplerini yönetecek bir sistem istiyorum.';
const discoveryState = buildBaDiscoveryState({ userMessage: vagueRequest, messages: emptyMessages, document: null });
const discoveryQuestions = buildBaClarifyingQuestions(discoveryState, 4);

assert(discoveryState.readinessScore < 55, 'Vague request should have low BA readiness');
assert(discoveryState.criticalMissing.length >= 2, 'Vague request should expose critical discovery gaps');
assert(discoveryQuestions.length > 0 && discoveryQuestions.length <= 4, 'Discovery question count should be 1-4');
assert(discoveryQuestions.every((question) => question.options.length >= 2), 'Discovery questions should include quick options');

const askDecision = decideBaDiscovery({
  userMessage: vagueRequest,
  messages: emptyMessages,
  document: null,
  classifierConfidence: 0.42,
});
assert(askDecision.shouldAsk, 'Low-confidence vague request should ask discovery questions');

const forceDecision = decideBaDiscovery({
  userMessage: 'Tamam, mevcut bilgilerle devam et ve taslak oluştur.',
  messages: emptyMessages,
  document: null,
  forceGenerate: true,
});
assert(!forceDecision.shouldAsk, 'Force-generate signal should stop new questions');

const testIntent = normalizeBaClassifierOutput(
  { userMessage: 'Bu kapsam için UAT test senaryolarını oluştur.', document: null, model: 'test-model' },
  buildClassification('generate_test_cases', { reason: 'test_case_request' }),
);
assert(testIntent.subIntent === 'generate_test_cases', 'Force-draft should preserve test generation subIntent');
assert(testIntent.baAgentFocus === 'test', 'Force-draft should preserve test focus');
assert(testIntent.targetSection === 'businessAnalysis', 'Focused test output should land in visible BA tab');

const flowIntent = normalizeBaClassifierOutput(
  { userMessage: 'Süreç akışını Mermaid olarak hazırla.', document: null, model: 'test-model' },
  buildClassification('generate_flow_diagram', { reason: 'flow_request' }),
);
assert(flowIntent.subIntent === 'generate_flow_diagram', 'Force-draft should preserve flow generation subIntent');
assert(flowIntent.baAgentFocus === 'flow', 'Force-draft should preserve flow focus');

const apiIntent = normalizeBaClassifierOutput(
  { userMessage: 'API kontratını ve entegrasyon analizini yaz.', document: null, model: 'test-model' },
  buildClassification('generate_api_contract', { reason: 'api_request' }),
);
assert(apiIntent.subIntent === 'generate_api_contract', 'Force-draft should preserve API generation subIntent');
assert(apiIntent.baAgentFocus === 'technical_analysis', 'Force-draft should preserve technical focus');

const reviewIntent = normalizeBaClassifierOutput(
  { userMessage: 'Riskleri ve review raporunu hazırla.', document: null, model: 'test-model' },
  buildClassification('generate_review_report', { reason: 'review_request' }),
);
assert(reviewIntent.targetSection === 'review', 'Review focused output should land in visible Review tab');
assert(reviewIntent.baAgentFocus === 'review', 'Review focus should be preserved');

const answerText = '**Soru 1:** Kapsam nedir?\n**Cevap:** İlk sürümde talep oluşturma, onay ve raporlama olacak.';
assert(isLikelyBaDiscoveryAnswer(answerText), 'Structured question answer should be detected');

const answeredDecision = decideBaDiscovery({
  userMessage: answerText,
  messages: emptyMessages,
  document: null,
});
assert(!answeredDecision.shouldAsk, 'Discovery answer should move the flow forward');

const sampleDocument: DocumentData = {
  businessAnalysis: {
    status: 'DRAFT',
    flags: [],
    content: [
      '# İş Analizi Dokümanı',
      '## Amaç ve İş Değeri',
      'Problem, müşteri taleplerinin manuel takip edilmesi ve hata riskidir. Hedef, talep süresini azaltmak ve izlenebilirliği artırmaktır.',
      '## Kapsam ve Kapsam Dışı',
      'MVP kapsamı talep oluşturma, onay, durum takibi ve raporlamadır. Kapsam dışı gelişmiş entegrasyonlardır.',
      '## As-Is / To-Be',
      'Mevcut durum e-posta ve Excel ile takip edilir. Hedef durum rol bazlı onay akışı ve raporlanabilir süreçtir.',
      '## Paydaşlar ve Roller',
      '| Paydaş | Rol |',
      '|---|---|',
      '| Operasyon | Kullanıcı |',
      '| Yönetici | Onaycı |',
      '## Gereksinimler',
      '| ID | Gereksinim | Kabul Kriteri |',
      '|---|---|---|',
      '| FR-01 | Kullanıcı talep oluşturabilir. | Talep kayıt numarası üretildiğinde başarılıdır. |',
      '| BR-01 | Onaysız talep tamamlanamaz. | Onay zorunlu alan olarak doğrulanır. |',
      '## Veri Modeli ve Entegrasyon',
      'Varlıklar talep, kullanıcı, onay ve durum tarihçesidir. API entegrasyonu ileride varsayım olarak değerlendirilecektir. Audit log tutulur.',
      '## NFR ve Riskler',
      'NFR: rol bazlı yetki, güvenlik, performans ve audit izlenebilirliği. Risk: entegrasyon kapsamı netleşmemiştir.',
      '## Ekranlar ve Mesajlar',
      'Talep formu, onay ekranı ve rapor ekranı gerekir. Toast, validasyon ve modal mesajları tanımlanmalıdır.',
      '## Açık Sorular',
      'Entegrasyon ihtiyacı ve rapor KPI hedefleri netleşmelidir.',
    ].join('\n'),
  },
  review: {
    status: 'DRAFT',
    flags: [],
    content: '## Review\nKalite, risk ve açık soru kontrolü yapılmalıdır.',
  },
};

const quality = evaluateBaQualityV2(sampleDocument);
assert(quality.sectionScores.length >= 6, 'Quality report should score multiple BA dimensions');
assert(quality.score > 35, 'Representative BA document should receive a non-trivial score');

const reviewBlock = buildBaQualityReviewMarkdown(quality);
assertIncludes(reviewBlock, 'AI BA Engine v1 Kalite Raporu', 'Quality review block should include title');
assertIncludes(reviewBlock, 'Öncelikli İyileştirmeler', 'Quality review block should include priority fixes');

const once = replaceBaEngineReviewBlock('## Review\nEski not', reviewBlock);
const twice = replaceBaEngineReviewBlock(once, reviewBlock);
const blockCount = twice.split('AI BA Engine v1 Kalite Raporu').length - 1;
assert(blockCount === 1, 'Quality block replacement should be idempotent');

console.log('AI BA Engine verification passed.');
