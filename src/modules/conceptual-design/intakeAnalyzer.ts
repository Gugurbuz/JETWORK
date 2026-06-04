import type { AnalysisInputAttachment } from './conceptualDesignTypes';
import type { ProcessSeed } from './processModelBuilder';
import { inferProcessSeedsFromNotes } from './processModelBuilder';

export type IntakeArtifactType =
  | 'requirement-document'
  | 'screenshot'
  | 'spreadsheet'
  | 'word-template'
  | 'pdf'
  | 'unknown';

export interface IntakeArtifact {
  name: string;
  mimeType: string;
  type: IntakeArtifactType;
  role: string;
}

export interface IntakeAnalysisResult {
  artifacts: IntakeArtifact[];
  processSeeds: ProcessSeed[];
  detectedTopics: string[];
  risks: string[];
  recommendations: string[];
}

function classifyAttachment(attachment: AnalysisInputAttachment): IntakeArtifactType {
  const name = (attachment.name || '').toLowerCase();
  const mime = attachment.mimeType.toLowerCase();

  if (mime.startsWith('image/')) return 'screenshot';
  if (mime.includes('spreadsheet') || name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) return 'spreadsheet';
  if (mime.includes('word') || name.endsWith('.docx') || name.endsWith('.doc')) {
    if (name.includes('şablon') || name.includes('sablon') || name.includes('template') || name.includes('örnek') || name.includes('ornek')) return 'word-template';
    return 'requirement-document';
  }
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (name.includes('talep') || name.includes('gereksinim') || name.includes('analiz')) return 'requirement-document';

  return 'unknown';
}

function describeArtifactRole(type: IntakeArtifactType): string {
  switch (type) {
    case 'requirement-document':
      return 'Talep, kapsam ve iş gereksinimi kaynağı olarak kullanılmalıdır.';
    case 'screenshot':
      return 'Ekran davranışı, UI mesajları, validasyon ve süreç akışı çıkarımı için kullanılmalıdır.';
    case 'spreadsheet':
      return 'Backlog, envanter, KPI veya tablo verisi kaynağı olarak kullanılmalıdır.';
    case 'word-template':
      return 'Final doküman formatı, kapak, tablo ve başlık stili referansı olarak kullanılmalıdır.';
    case 'pdf':
      return 'Talep veya referans doküman kaynağı olarak incelenmelidir.';
    default:
      return 'İçeriği analiz edilerek uygun kategoriye atanmalıdır.';
  }
}

function detectTopics(notes: string, artifacts: IntakeArtifact[]): string[] {
  const lower = notes.toLowerCase();
  const topics = new Set<string>();

  if (lower.includes('proje')) topics.add('Proje Yönetimi');
  if (lower.includes('süreç') || lower.includes('surec')) topics.add('Süreç Yönetimi');
  if (lower.includes('görev') || lower.includes('gorev')) topics.add('Görev Yönetimi');
  if (lower.includes('doküman') || lower.includes('dokuman') || lower.includes('filenet')) topics.add('Doküman Yönetimi');
  if (lower.includes('bildirim')) topics.add('Bildirim Yönetimi');
  if (lower.includes('rol') || lower.includes('yetki') || lower.includes('kullanıcı') || lower.includes('kullanici')) topics.add('Yetki ve Kullanıcı Yönetimi');
  if (lower.includes('dashboard') || lower.includes('kpi')) topics.add('Dashboard ve KPI');
  if (lower.includes('master data')) topics.add('Master Data');
  if (lower.includes('toast') || lower.includes('validasyon') || lower.includes('modal')) topics.add('Kullanıcı Mesajları');
  if (lower.includes('bpmn') || lower.includes('akış') || lower.includes('akis')) topics.add('Süreç Akışları');

  artifacts.forEach(artifact => {
    if (artifact.type === 'screenshot') topics.add('Ekran Görüntüsü Analizi');
    if (artifact.type === 'spreadsheet') topics.add('Backlog / Tablo Analizi');
    if (artifact.type === 'word-template') topics.add('Word Şablon Uyum Analizi');
  });

  return Array.from(topics);
}

function detectRisks(notes: string, artifacts: IntakeArtifact[]): string[] {
  const risks: string[] = [];
  const hasTemplate = artifacts.some(artifact => artifact.type === 'word-template');
  const hasScreenshot = artifacts.some(artifact => artifact.type === 'screenshot');
  const hasRequirementDocument = artifacts.some(artifact => ['requirement-document', 'pdf'].includes(artifact.type));

  if (!hasTemplate) {
    risks.push('Örnek Word şablonu bulunmazsa final doküman formatı kurumsal beklentiden sapabilir.');
  }
  if (!hasScreenshot) {
    risks.push('Ekran görüntüsü bulunmazsa UI davranışları, toast ve validasyon detayları eksik kalabilir.');
  }
  if (!hasRequirementDocument && notes.trim().length < 500) {
    risks.push('Talep dokümanı veya yeterli detay notu yoksa süreç ve gereksinim çıkarımı varsayımlara dayanabilir.');
  }
  if (notes.toLowerCase().includes('p0') || notes.toLowerCase().includes('p8')) {
    risks.push('P0-P8 ifadeleri MVP örneği olabilir; kalıcı ürün kuralı gibi modellenmemelidir.');
  }

  return risks;
}

export function analyzeConceptualDesignIntake(
  notes: string,
  attachments: AnalysisInputAttachment[] = [],
): IntakeAnalysisResult {
  const artifacts = attachments.map(attachment => {
    const type = classifyAttachment(attachment);
    return {
      name: attachment.name || 'isimsiz dosya',
      mimeType: attachment.mimeType,
      type,
      role: describeArtifactRole(type),
    };
  });

  return {
    artifacts,
    processSeeds: inferProcessSeedsFromNotes(notes),
    detectedTopics: detectTopics(notes, artifacts),
    risks: detectRisks(notes, artifacts),
    recommendations: [
      'AI çıktısı markdown yerine ConceptualDesignDocument JSON modeli olarak doğrulanmalıdır.',
      'Gereksinimler normalize edilerek BR/FR/NFR/UI/INT/DOC/RPT/SEC/PERF kodlarıyla izlenmelidir.',
      'Süreç, KPI, kullanıcı mesajı ve doküman kuralları tek veri modelinden üretilmelidir.',
      'Word export öncesinde kalite kontrol raporu çalıştırılmalıdır.',
    ],
  };
}
