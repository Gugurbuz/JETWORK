import type { DocumentData } from '../../types';
import type {
  AdaptiveReasoningPlan,
  ReasoningCapabilityId,
} from './adaptiveReasoningPolicy';

export interface AdaptiveReasoningFinding {
  id: string;
  severity: 'warning' | 'error';
  message: string;
  recommendedAction: string;
}

export interface AdaptiveReasoningCritique {
  passed: boolean;
  penalty: number;
  findings: AdaptiveReasoningFinding[];
}

export interface EvaluateAdaptiveReasoningCritiqueInput {
  document: DocumentData;
  plan?: AdaptiveReasoningPlan;
  sourceText?: string;
}

function normalize(value = ''): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ıİ]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasCapability(plan: AdaptiveReasoningPlan, id: ReasoningCapabilityId): boolean {
  return plan.capabilities.some(capability => capability.id === id);
}

function numericTokens(value: string): string[] {
  return Array.from(new Set(
    value
      .match(/\d+(?:[.,]\d+)?/g)
      ?.map(token => token.replace(',', '.')) || [],
  )).slice(0, 8);
}

export function evaluateAdaptiveReasoningCritique(
  input: EvaluateAdaptiveReasoningCritiqueInput,
): AdaptiveReasoningCritique {
  if (!input.plan || input.plan.capabilities.length === 0) {
    return { passed: true, penalty: 0, findings: [] };
  }

  const business = normalize(input.document.businessAnalysis?.content || '');
  const review = normalize(input.document.review?.content || '');
  const all = `${business} ${review}`.trim();
  const source = normalize(input.sourceText || '');
  const findings: AdaptiveReasoningFinding[] = [];

  const add = (
    id: string,
    severity: AdaptiveReasoningFinding['severity'],
    message: string,
    recommendedAction: string,
  ): void => {
    if (!findings.some(item => item.id === id)) {
      findings.push({ id, severity, message, recommendedAction });
    }
  };

  if (
    hasCapability(input.plan, 'dependency_planning')
    && !/\b(adim|on kosul|bagimlilik|sirayla|once|sonra|surec akisi)\b/.test(all)
  ) {
    add(
      'AR-DEPENDENCY',
      'warning',
      'Bağımlı plan seçildi ancak çıktı adım sırası veya ön koşulları görünür kılmıyor.',
      'Adımları depends-on ilişkisi, ön koşul veya açık sıra ile göster.',
    );
  }

  if (
    hasCapability(input.plan, 'hypothesis_testing')
    && !(
      /\b(hipotez|olasi neden)\b/.test(all)
      && /\b(nasil kontrol|kontrol yontemi|beklenen kanit|kanit|dogrulama)\b/.test(all)
    )
  ) {
    add(
      'AR-HYPOTHESIS',
      'error',
      'Hata analizi, hipotezleri kontrol yöntemi ve beklenen kanıtla sınanabilir hale getirmiyor.',
      'Her olası neden için “nasıl kontrol edilir?” ve “hangi kanıt beklenir?” alanlarını ekle.',
    );
  }

  if (
    hasCapability(input.plan, 'alternative_evaluation')
    && !(
      /\b(alternatif|secenek)\b/.test(all)
      && /\b(oner|tercih|gerekce|karsilastir|karar)\b/.test(all)
    )
  ) {
    add(
      'AR-ALTERNATIVE',
      'error',
      'Karar desteği talebi, karşılaştırılmış alternatifler ve gerekçeli öneri içermiyor.',
      'Seçenekleri ortak ölçütlerle karşılaştır ve önerilen seçimi gerekçelendir.',
    );
  }

  if (
    hasCapability(input.plan, 'contradiction_gap_detection')
    && !/\b(celiski|acik konu|eksik bilgi|varsayim|bulunmadi|tespit edilmedi)\b/.test(review)
  ) {
    add(
      'AR-GAP-REVIEW',
      'warning',
      'Review, çelişki ve bilgi boşluğu kontrolünün sonucunu görünür biçimde kaydetmiyor.',
      'Çelişki, varsayım ve açık kararları belirt; yoksa kontrol edildiğini açıkça yaz.',
    );
  }

  const legacyPattern = /\b(eski|gecmis|mevcut) (kayit|belge|veri)[a-z0-9]*/;
  const legacyRequested = legacyPattern.test(source);
  if (
    hasCapability(input.plan, 'constraint_tracking')
    && legacyRequested
    && !legacyPattern.test(all)
  ) {
    add(
      'AR-LEGACY',
      'error',
      'Kaynakta eski/mevcut kayıt ayrımı bulunmasına rağmen çıktı geçiş davranışını ele almıyor.',
      'Eski kayıtların görüntüleme, değiştirme, doğrulama ve geçiş kuralını tanımla.',
    );
  }

  const permissionRequested = /\b(yetki|rol bazli|authorization|permission)\b/.test(source);
  if (
    hasCapability(input.plan, 'constraint_tracking')
    && permissionRequested
    && !/\b(yetki|rol bazli|authorization|permission)\b/.test(all)
  ) {
    add(
      'AR-PERMISSION',
      'error',
      'Kaynakta yetki kısıtı bulunmasına rağmen çıktı yetki davranışını izlemiyor.',
      'İşlemi yapabilen rolü, engel davranışını ve audit beklentisini tanımla.',
    );
  }

  if (hasCapability(input.plan, 'formal_reasoning')) {
    const sourceNumbers = numericTokens(source);
    const documentNumbers = new Set(numericTokens(all));
    const missingNumbers = sourceNumbers.filter(number => !documentNumbers.has(number));
    if (sourceNumbers.length > 0 && missingNumbers.length / sourceNumbers.length >= 0.5) {
      add(
        'AR-NUMERIC-FIDELITY',
        'error',
        `Kaynak sayısal eşiklerinin önemli bölümü çıktıda korunmuyor: ${missingNumbers.join(', ')}.`,
        'Formül, eşik, tam sınır değeri ve hata durumlarını kaynak değerleriyle test edilebilir yaz.',
      );
    }
  }

  if (
    hasCapability(input.plan, 'code_diagnosis')
    && !(
      /\b(gercek davranis|mevcut davranis|kok neden|yan etki)\b/.test(all)
      && /\b(test|dogrula|kontrol)\b/.test(all)
    )
  ) {
    add(
      'AR-CODE-DIAGNOSIS',
      'warning',
      'Kod incelemesi gerçek davranış, iş ihtiyacı, yan etki ve test bağını birlikte göstermiyor.',
      'Kodun amacı ile gerçek davranışını karşılaştır; düzeltme etkisini ve test yolunu ekle.',
    );
  }

  if (
    hasCapability(input.plan, 'cross_source_synthesis')
    && (input.document.evidenceClaims || []).length === 0
  ) {
    add(
      'AR-EVIDENCE',
      'warning',
      'Birden fazla kaynak kullanıldığı halde yapısal kanıt izi bulunmuyor.',
      'Kritik iddiaları VERIFIED, INFERRED, ASSUMPTION, OPEN veya CONFLICTING olarak kaydet.',
    );
  }

  if (
    hasCapability(input.plan, 'independent_critique')
    && !review.trim()
  ) {
    add(
      'AR-CRITIC',
      'warning',
      'Bağımsız kalite kontrolünün kaydedileceği Review bölümü bulunmuyor.',
      'Review içinde kapsam, çelişki, istisna, test edilebilirlik ve kaynak sadakati bulgularını yaz.',
    );
  }

  const penalty = Math.min(
    24,
    findings.reduce((total, finding) => total + (finding.severity === 'error' ? 6 : 3), 0),
  );

  return {
    passed: findings.every(finding => finding.severity !== 'error'),
    penalty,
    findings,
  };
}
