import { describe, expect, it } from 'vitest';
import type { Message } from '../../../types';
import {
  applyBehaviorDecisionToClassification,
  buildBehaviorDecision,
} from '../behaviorDecision';
import { buildAiTurnDecision } from '../aiTurnDecision';
import { buildBaCognitiveFrame } from '../baCognitiveFrame';
import {
  computeDiscoverySignals,
  resolveDiscoveryArtifactIntent,
} from '../discoveryPolicy';
import {
  buildClassification,
  normalizeBaClassifierOutput,
} from '../intentClassifier';
import { analyzeSourceIntelligence, buildSourceCorpus } from '../../sourceIntelligence';

const originalRequest = [
  'SAP CRM’de münferit veya toplu yaratılan tekliflerin statülerinin,',
  'teklif numarası kullanılarak ZCRM110 üzerinden toplu güncellenmesi talep ediliyor.',
  'Bir veya daha fazla teklif seçilebilmeli ve sonraki iş akışları tetiklenmeli.',
].join(' ');

const discoveryHistory: Message[] = [
  {
    id: 'request-1',
    role: 'user',
    text: originalRequest,
  },
  {
    id: 'question-1',
    role: 'model',
    text: 'Kritik kararları netleştirelim.',
    questions: [
      {
        id: 'q1',
        text: 'Ana süreç hangi tetikleyiciyle başlar ve hangi ekranda ilerler?',
        options: ['Kullanıcı başlatır', 'Sistem başlatır'],
      },
      {
        id: 'q2',
        text: 'Hangi validasyon ve kullanıcı mesajı uygulanmalı?',
        options: ['Hata ver', 'Uyarı ver'],
      },
    ],
  },
];

const structuredAnswer = [
  '**Soru 1:** Ana süreç hangi tetikleyiciyle başlar ve hangi ekranda ilerler?',
  '**Cevap:** Kullanıcı başlatır, sistem kontrollü ilerler',
  '',
  '**Soru 2:** Hangi validasyon ve kullanıcı mesajı uygulanmalı?',
  '**Cevap:** Cevaplanmadı',
].join('\n');

describe('discovery artifact continuity', () => {
  it('recovers the original request instead of treating the structured answer as a new artifact intent', () => {
    const signals = computeDiscoverySignals(structuredAnswer, discoveryHistory, null);
    const artifactIntent = resolveDiscoveryArtifactIntent(
      structuredAnswer,
      discoveryHistory,
      signals,
    );

    expect(signals.isAnsweringDiscovery).toBe(true);
    expect(artifactIntent).toBe(originalRequest);
  });

  it('does not let question wording drift a BA request into a UI specification', () => {
    const signals = computeDiscoverySignals(structuredAnswer, discoveryHistory, null);
    const artifactIntentText = resolveDiscoveryArtifactIntent(
      structuredAnswer,
      discoveryHistory,
      signals,
    );
    const initialClassification = normalizeBaClassifierOutput(
      {
        userMessage: structuredAnswer,
        artifactIntentText,
        document: null,
        model: 'test-model',
      },
      buildClassification('generate_business_analysis', {
        baAgentFocus: 'business_analysis',
        documentImpact: 'updates_document',
        shouldRunBaAgentLoop: true,
        reason: 'test',
      }),
    );
    const behaviorDecision = buildBehaviorDecision({
      userMessage: structuredAnswer,
      document: null,
      classification: initialClassification,
      discoveryReadiness: signals.baDiscoveryReadiness,
    });
    const sourceReport = analyzeSourceIntelligence({
      sourceText: buildSourceCorpus({
        userMessage: structuredAnswer,
        messages: discoveryHistory,
        document: null,
      }),
      workspaceTitle: 'Toplu Teklif Statü Güncelleme',
    });
    const cognitiveFrame = buildBaCognitiveFrame({
      userMessage: structuredAnswer,
      artifactIntentText,
      recentConversation: discoveryHistory.map(message => message.text).join('\n\n'),
      document: null,
      sourceReport,
      behaviorDecision,
    });
    const classification = applyBehaviorDecisionToClassification(
      initialClassification,
      behaviorDecision,
      null,
    );
    const decision = buildAiTurnDecision({
      userMessage: structuredAnswer,
      document: null,
      classification,
      behaviorDecision,
      cognitiveFrame,
      sourceReport,
      discoverySignals: {
        mustGenerateNow: signals.mustGenerateNow,
        greetingOnly: signals.greetingOnly,
        newStandaloneRequest: signals.newStandaloneRequest,
        reason: signals.reason,
      },
    });

    expect(classification.subIntent).toBe('generate_business_analysis');
    expect(classification.baAgentFocus).toBe('business_analysis');
    expect(cognitiveFrame.artifactMode).toBe('conceptual_analysis');
    expect({
      action: decision.action,
      profile: decision.artifactProfile.id,
      shouldUpdateDocument: decision.documentPolicy.shouldUpdateDocument,
      behavior: behaviorDecision.mode,
      cognitiveAction: cognitiveFrame.action,
    }).toEqual({
      action: 'draft_document',
      profile: expect.stringMatching(/^conceptual_design_/),
      shouldUpdateDocument: true,
      behavior: expect.any(String),
      cognitiveAction: expect.any(String),
    });
  });

  it('preserves an explicitly requested test artifact across a discovery answer', () => {
    const testOrigin = 'Toplu statü güncelleme için negatif test senaryoları ve UAT kabul kriterleri hazırla.';
    const history: Message[] = [
      { id: 'request-test', role: 'user', text: testOrigin },
      ...discoveryHistory.slice(1),
    ];
    const signals = computeDiscoverySignals(structuredAnswer, history, null);
    const artifactIntentText = resolveDiscoveryArtifactIntent(
      structuredAnswer,
      history,
      signals,
    );
    const classification = normalizeBaClassifierOutput(
      {
        userMessage: structuredAnswer,
        artifactIntentText,
        document: null,
        model: 'test-model',
      },
      buildClassification('generate_business_analysis', {
        reason: 'classifier_drift',
      }),
    );

    expect(artifactIntentText).toBe(testOrigin);
    expect(classification.subIntent).toBe('generate_test_cases');
    expect(classification.baAgentFocus).toBe('test');
  });
});
