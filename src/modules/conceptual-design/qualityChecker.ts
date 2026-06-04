import type {
  ConceptualDesignDocument,
  DocumentQualityReport,
  ProcessModel,
  QualityIssue,
  Requirement,
} from './conceptualDesignTypes';
import { ConceptualDesignDocumentSchema } from './conceptualDesignSchemas';

const REQUIRED_TOP_LEVEL_SECTIONS: Array<keyof ConceptualDesignDocument> = [
  'metadata',
  'projectIdentity',
  'participants',
  'executiveSummary',
  'processModels',
  'commonUiRules',
  'integrations',
  'documentManagement',
  'notificationManagement',
  'nonFunctionalRequirements',
];

function issue(
  id: string,
  severity: QualityIssue['severity'],
  section: string,
  message: string,
  recommendation?: string,
): QualityIssue {
  return { id, severity, section, message, recommendation };
}

function collectRequirements(document: ConceptualDesignDocument): Requirement[] {
  return document.processModels.flatMap(process => process.businessRequirements || []);
}

function hasAnyProcessData(process: ProcessModel): boolean {
  return Boolean(
    process.businessRules.length ||
    process.businessRequirements.length ||
    process.kpis.length ||
    process.flowSteps.length ||
    process.uiMessages.length ||
    process.documentRules.length ||
    process.integrations.length,
  );
}

function calculateScore(blockingCount: number, warningCount: number, infoCount: number): number {
  const penalty = blockingCount * 15 + warningCount * 5 + infoCount * 1;
  return Math.max(0, Math.min(100, 100 - penalty));
}

export function runConceptualDesignQualityCheck(document: ConceptualDesignDocument): DocumentQualityReport {
  const blockingIssues: QualityIssue[] = [];
  const warnings: QualityIssue[] = [];
  const infos: QualityIssue[] = [];
  const missingSections: string[] = [];
  const missingTraceability: string[] = [];

  const schemaResult = ConceptualDesignDocumentSchema.safeParse(document);
  if (!schemaResult.success) {
    blockingIssues.push(issue(
      'QC-SCHEMA-001',
      'blocking',
      'schema',
      'ConceptualDesignDocument şeması doğrulanamadı.',
      schemaResult.error.issues.map(zodIssue => `${zodIssue.path.join('.')}: ${zodIssue.message}`).join(' | '),
    ));
  }

  REQUIRED_TOP_LEVEL_SECTIONS.forEach(sectionName => {
    const value = document[sectionName];
    if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
      missingSections.push(sectionName);
      warnings.push(issue(
        `QC-MISSING-${String(sectionName).toUpperCase()}`,
        'warning',
        String(sectionName),
        `${String(sectionName)} bölümü boş veya eksik görünüyor.`,
        'Doküman export aşamasında bu bölüm için içerik üretimi veya kullanıcı doğrulaması yapılmalıdır.',
      ));
    }
  });

  if (!document.processModels?.length) {
    blockingIssues.push(issue(
      'QC-PROCESS-001',
      'blocking',
      'processModels',
      'Dokümanda en az bir süreç modeli bulunmalıdır.',
      'Talep dokümanı ve ekran görüntülerinden süreç modelleri çıkarılmalıdır.',
    ));
  }

  document.processModels.forEach((process, index) => {
    const section = `processModels[${index}] ${process.code || process.id}`;

    if (!hasAnyProcessData(process)) {
      blockingIssues.push(issue(
        `QC-PROCESS-${index + 1}-EMPTY`,
        'blocking',
        section,
        `${process.title} süreci için iş kuralı, gereksinim, KPI, akış veya mesaj tanımı bulunmuyor.`,
        'Süreç en az iş kuralları, akış adımları ve tamamlanma kriterleriyle doldurulmalıdır.',
      ));
    }

    if (!process.flowSteps.length) {
      warnings.push(issue(
        `QC-PROCESS-${index + 1}-FLOW`,
        'warning',
        section,
        `${process.title} süreci için akış adımı tanımlanmamış.`,
        'BPMN üretimi için start/activity/decision/end tiplerinde akış adımları eklenmelidir.',
      ));
    }

    if (!process.kpis.length) {
      warnings.push(issue(
        `QC-PROCESS-${index + 1}-KPI`,
        'warning',
        section,
        `${process.title} süreci için KPI tanımı bulunmuyor.`,
        'Süreç tamamlanma oranı, gecikme, belge tamlığı veya görev kapanma KPI’larından en az biri tanımlanmalıdır.',
      ));
    }

    if (!process.uiMessages.length) {
      infos.push(issue(
        `QC-PROCESS-${index + 1}-UI`,
        'info',
        section,
        `${process.title} süreci için kullanıcı mesajı tanımlanmamış.`,
        'Toast, inline validasyon, modal veya banner mesajları eklenmelidir.',
      ));
    }

    if (process.code && /^P\d+$/i.test(process.code) && process.title.trim().match(/^P\d+/i)) {
      infos.push(issue(
        `QC-PROCESS-${index + 1}-LABEL`,
        'info',
        section,
        'Süreç başlığında kod tekrar ediyor olabilir.',
        'Kod process.code alanında, kullanıcıya gösterilen isim process.title alanında tutulmalıdır.',
      ));
    }
  });

  const requirements = collectRequirements(document);
  const requirementIds = requirements.map(req => req.id);
  const duplicateRequirementIds = requirementIds.filter((id, index) => requirementIds.indexOf(id) !== index);

  duplicateRequirementIds.forEach(id => {
    blockingIssues.push(issue(
      `QC-REQ-DUP-${id}`,
      'blocking',
      'requirements',
      `${id} gereksinim kodu birden fazla kez kullanılmış.`,
      'Gereksinim kodları doküman genelinde benzersiz olmalıdır.',
    ));
  });

  requirements.forEach(requirement => {
    if (!requirement.acceptanceCriteria.length) {
      warnings.push(issue(
        `QC-REQ-${requirement.id}-AC`,
        'warning',
        requirement.id,
        `${requirement.id} için kabul kriteri tanımlanmamış.`,
        'Her gereksinim en az bir doğrulanabilir kabul kriteri içermelidir.',
      ));
    }

    if (!requirement.relatedProcessIds.length && !['NFR', 'SEC', 'PERF'].includes(requirement.category)) {
      missingTraceability.push(requirement.id);
      warnings.push(issue(
        `QC-REQ-${requirement.id}-TRACE`,
        'warning',
        requirement.id,
        `${requirement.id} herhangi bir süreçle ilişkilendirilmemiş.`,
        'relatedProcessIds alanı ilgili processModels.id değerleriyle doldurulmalıdır.',
      ));
    }
  });

  if (!document.commonUiRules.toastRules.length && !document.commonUiRules.validationRules.length) {
    warnings.push(issue(
      'QC-UI-001',
      'warning',
      'commonUiRules',
      'Ortak kullanıcı mesajı, toast veya validasyon standardı tanımlanmamış.',
      'Uygulama genelinde success/error/warning/info ve inline validasyon mesajları standartlaştırılmalıdır.',
    ));
  }

  if (document.documentManagement.storageSystem && document.documentManagement.storageSystem.toLowerCase().includes('filenet')) {
    const hasFileNetIntegration = document.integrations.some(integration => integration.system.toLowerCase().includes('filenet'));
    if (!hasFileNetIntegration) {
      warnings.push(issue(
        'QC-DOC-001',
        'warning',
        'documentManagement',
        'Doküman yönetimi FileNet olarak belirtilmiş ancak entegrasyon tanımı bulunmuyor.',
        'integrations alanında FileNet aktarım, hata ve audit kuralları tanımlanmalıdır.',
      ));
    }
  }

  const score = calculateScore(blockingIssues.length, warnings.length, infos.length);
  const summary = blockingIssues.length
    ? 'Dokümanda export öncesi giderilmesi gereken kritik eksikler var.'
    : warnings.length
      ? 'Doküman kullanılabilir durumda ancak kalite ve izlenebilirlik için uyarılar giderilmelidir.'
      : 'Doküman temel kalite kontrollerinden geçti.';

  return {
    score,
    summary,
    blockingIssues,
    warnings,
    infos,
    missingSections,
    duplicateRequirementIds: Array.from(new Set(duplicateRequirementIds)),
    missingTraceability,
  };
}
