import { marked } from 'marked';
import type { DocumentData, SectionData } from '../../types';
import type {
  ConceptualDesignDocument,
  DocumentQualityReport,
  ProcessModel,
  Requirement,
  UiMessage,
} from './conceptualDesignTypes';

function mdTable(headers: string[], rows: Array<Array<string | number | undefined>>): string {
  const safe = (value: string | number | undefined) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br/>');
  return [
    `| ${headers.map(safe).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(safe).join(' | ')} |`),
  ].join('\n');
}

function section(content: string, parseMarkdown = true, flags: string[] = []): SectionData {
  return {
    content: parseMarkdown ? (marked.parse(content) as string) : content,
    status: flags.length ? 'NEEDS_REVISION' : 'DRAFT',
    flags,
  };
}

function requirementRows(process: ProcessModel): Array<Array<string>> {
  return process.businessRequirements.map(requirement => [
    requirement.id,
    requirement.category,
    requirement.title,
    requirement.statement,
    requirement.priority,
    requirement.acceptanceCriteria.join('<br/>'),
  ]);
}

function messageRows(messages: UiMessage[]): Array<Array<string>> {
  return messages.map(message => [
    message.id,
    message.screen,
    message.trigger,
    message.type,
    message.title || '',
    message.message,
    message.blocking ? 'Evet' : 'Hayır',
  ]);
}

function renderProcess(process: ProcessModel, index: number): string {
  const lines: string[] = [];
  lines.push(`## ${index + 1}. ${process.title}`);
  if (process.code) lines.push(`**Süreç Kodu:** ${process.code}`);
  lines.push(`\n**Amaç:** ${process.purpose}`);
  lines.push(`\n${process.highLevelDescription}`);

  if (process.businessRules.length) {
    lines.push('\n### İş Kuralları');
    process.businessRules.forEach(rule => lines.push(`- ${rule}`));
  }

  if (process.businessRequirements.length) {
    lines.push('\n### İş Gerekleri ve Gereksinimler');
    lines.push(mdTable(
      ['No', 'Kategori', 'Başlık', 'Gereksinim', 'Öncelik', 'Kabul Kriterleri'],
      requirementRows(process),
    ));
  }

  if (process.kpis.length) {
    lines.push('\n### KPI Tanımları');
    lines.push(mdTable(
      ['KPI', 'Açıklama', 'Formül', 'Birim', 'Hedef', 'Veri Kaynağı'],
      process.kpis.map(kpi => [kpi.name, kpi.description, kpi.formula, kpi.unit, kpi.target, kpi.dataSource]),
    ));
  }

  if (process.flowSteps.length) {
    lines.push('\n### Akış Adımları');
    lines.push(mdTable(
      ['Sıra', 'Tip', 'Aktör', 'Adım', 'Açıklama', 'Sonraki Adım'],
      process.flowSteps.map(step => [step.order, step.type, step.actor, step.title, step.description, step.nextStepIds.join(', ')]),
    ));
  }

  if (process.uiMessages.length) {
    lines.push('\n### Kullanıcı Mesajları / Validasyonlar');
    lines.push(mdTable(
      ['Mesaj No', 'Ekran', 'Tetikleyici', 'Tip', 'Başlık', 'Mesaj', 'Bloklayıcı'],
      messageRows(process.uiMessages),
    ));
  }

  if (process.documentRules.length) {
    lines.push('\n### Doküman Kuralları');
    lines.push(mdTable(
      ['Doküman', 'Tür', 'Zorunlu', 'Uzantılar', 'Sorumlu Rol', 'Entegrasyon', 'Tamamlanma Etkisi'],
      process.documentRules.map(rule => [
        rule.documentName,
        rule.documentType,
        rule.required ? 'Evet' : 'Hayır',
        rule.allowedExtensions.join(', '),
        rule.ownerRole,
        rule.integrationTarget,
        rule.completionImpact,
      ]),
    ));
  }

  if (process.integrations.length) {
    lines.push('\n### Entegrasyonlar');
    lines.push(mdTable(
      ['Sistem', 'Yön', 'Tetikleyici', 'Payload', 'Başarı Davranışı', 'Hata Davranışı'],
      process.integrations.map(integration => [
        integration.system,
        integration.direction,
        integration.trigger,
        integration.payloadSummary,
        integration.successBehavior,
        integration.errorBehavior,
      ]),
    ));
  }

  if (process.openQuestions.length) {
    lines.push('\n### Açık Konular');
    process.openQuestions.forEach(question => lines.push(`- ${question}`));
  }

  return lines.join('\n\n');
}

function renderBusinessAnalysis(document: ConceptualDesignDocument): string {
  const lines: string[] = [];
  lines.push(`# ${document.metadata.documentTitle}`);
  lines.push(`**Proje:** ${document.metadata.projectName}`);
  lines.push(`**Versiyon:** ${document.metadata.version}`);
  lines.push(`**Tarih:** ${document.metadata.date}`);

  lines.push('\n## Proje Kimlik Kartı');
  lines.push(mdTable(
    ['Alan', 'Değer'],
    [
      ['Proje İsmi', document.projectIdentity.projectName],
      ['Müşteri İsmi', document.projectIdentity.customerName || ''],
      ['Proje Yöneticisi', document.projectIdentity.projectManager || ''],
      ['Kapsam Yöneticisi', document.projectIdentity.scopeManager || ''],
      ['İş Uygulamaları Sorumlusu', document.projectIdentity.businessApplicationOwner || ''],
    ],
  ));

  if (document.participants.length) {
    lines.push('\n## Katılımcılar');
    lines.push(mdTable(
      ['Rol', 'İsim', 'Departman', 'Sorumluluk'],
      document.participants.map(participant => [participant.role, participant.name, participant.department, participant.responsibility]),
    ));
  }

  lines.push('\n## Amaç ve Özet');
  lines.push(document.executiveSummary);

  if (document.processModels.length) {
    lines.push('\n# Süreç Modelleri');
    document.processModels.forEach((process, index) => lines.push(renderProcess(process, index)));
  }

  lines.push('\n# Ortak Ekran, Yetki ve Kullanıcı Mesajları Standardı');
  if (document.commonUiRules.designPrinciples.length) {
    lines.push('## Tasarım İlkeleri');
    document.commonUiRules.designPrinciples.forEach(rule => lines.push(`- ${rule}`));
  }

  const allMessages = [
    ...document.commonUiRules.validationRules,
    ...document.commonUiRules.toastRules,
    ...document.commonUiRules.modalRules,
    ...document.commonUiRules.emptyStateRules,
  ];
  if (allMessages.length) {
    lines.push('\n## Kullanıcı Mesajları / Toast ve Validasyon Standardı');
    lines.push(mdTable(
      ['Mesaj No', 'Ekran', 'Tetikleyici', 'Tip', 'Başlık', 'Mesaj', 'Bloklayıcı'],
      messageRows(allMessages),
    ));
  }

  return lines.join('\n\n');
}

function renderTechnicalAnalysis(document: ConceptualDesignDocument): string {
  const lines: string[] = [];
  lines.push('# Teknik Mimari ve Entegrasyon Analizi');

  if (document.integrations.length) {
    lines.push('\n## Entegrasyon Envanteri');
    lines.push(mdTable(
      ['Sistem', 'Amaç', 'Sahip', 'Arayüz Tipi', 'Veri Nesneleri', 'Hata Yönetimi', 'Audit'],
      document.integrations.map(integration => [
        integration.system,
        integration.purpose,
        integration.owner,
        integration.interfaceType,
        integration.dataObjects.join('<br/>'),
        integration.errorHandling.join('<br/>'),
        integration.auditLogRules.join('<br/>'),
      ]),
    ));
  }

  lines.push('\n## Doküman Yönetimi');
  lines.push(document.documentManagement.purpose);
  lines.push(`\n**Saklama Sistemi:** ${document.documentManagement.storageSystem || 'Belirtilmedi'}`);

  if (document.documentManagement.documentRules.length) {
    lines.push(mdTable(
      ['Doküman', 'Tür', 'Zorunlu', 'Uzantılar', 'Entegrasyon'],
      document.documentManagement.documentRules.map(rule => [
        rule.documentName,
        rule.documentType,
        rule.required ? 'Evet' : 'Hayır',
        rule.allowedExtensions.join(', '),
        rule.integrationTarget,
      ]),
    ));
  }

  if (document.nonFunctionalRequirements.length) {
    lines.push('\n## Hizmet Seviyesi ve Fonksiyonel Olmayan Gereksinimler');
    lines.push(mdTable(
      ['No', 'Kategori', 'Gereksinim', 'Ölçülebilir Kriter', 'Öncelik'],
      document.nonFunctionalRequirements.map(nfr => [nfr.id, nfr.category, nfr.statement, nfr.measurableCriteria, nfr.priority]),
    ));
  }

  return lines.join('\n\n');
}

function renderTestAnalysis(document: ConceptualDesignDocument): string {
  const rows: Array<Array<string>> = [];
  document.processModels.forEach(process => {
    process.businessRequirements.forEach((requirement: Requirement) => {
      requirement.acceptanceCriteria.forEach((criteria, index) => {
        rows.push([
          `TC-${requirement.id}-${index + 1}`,
          process.title,
          requirement.id,
          requirement.title,
          criteria,
        ]);
      });
    });
  });

  return [
    '# Test Senaryoları ve Kabul Kriterleri',
    mdTable(['Test No', 'Süreç', 'Gereksinim', 'Senaryo', 'Beklenen Sonuç'], rows),
  ].join('\n\n');
}

function renderQualityReport(report?: DocumentQualityReport): string {
  if (!report) return '# Kalite Değerlendirmesi\n\nKalite raporu bulunmuyor.';

  const lines: string[] = [];
  lines.push('# Kalite Değerlendirmesi');
  lines.push(`**Puan:** ${report.score}`);
  lines.push(`\n${report.summary}`);

  const issues = [...report.blockingIssues, ...report.warnings, ...report.infos];
  if (issues.length) {
    lines.push('\n## Bulgular');
    lines.push(mdTable(
      ['Seviye', 'Bölüm', 'Mesaj', 'Öneri'],
      issues.map(issue => [issue.severity, issue.section, issue.message, issue.recommendation]),
    ));
  }

  return lines.join('\n\n');
}

export function conceptualDesignToDocumentData(document: ConceptualDesignDocument): DocumentData {
  const firstBpmn = document.processModels.find(process => process.bpmnXml)?.bpmnXml || '';
  const qualityFlags = document.qualityReport?.blockingIssues.map(issue => issue.message) || [];

  return {
    businessAnalysis: section(renderBusinessAnalysis(document), true, qualityFlags),
    code: section(renderTechnicalAnalysis(document), true),
    test: section(renderTestAnalysis(document), true),
    review: section(renderQualityReport(document.qualityReport), true),
    bpmn: section(firstBpmn, false),
    score: document.qualityReport?.score,
    scoreExplanation: document.qualityReport?.summary,
  };
}
