export type DomainProfileId =
  | 'project_tracking_pemp'
  | 'sap_crm_iys'
  | 'sap_crm_ai_sales_bot'
  | 'field_mobile_app'
  | 'digital_contract'
  | 'integration_project'
  | 'operations_platform';

export interface DomainSignalContribution {
  roles?: string[];
  systems?: string[];
  integrations?: string[];
  documentRules?: string[];
  dashboardNeeds?: string[];
  uiNeeds?: string[];
  kpis?: string[];
  risks?: string[];
  openTopics?: string[];
}

/**
 * Domain profiles only select research policy. They are not a source of
 * project names, processes, roles, systems, requirements or KPI targets.
 */
export interface DomainProfile {
  id: DomainProfileId;
  hint: string;
  label: string;
  sourceSensitive?: boolean;
  requiresExternalResearch?: boolean;
  preferredSources?: string[];
  researchQueries?: string[];
  actInstructions?: string[];
  match: (normalizedText: string) => boolean;
}

export function normalizeDomainText(value = ''): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (text: string, pattern: RegExp): boolean => pattern.test(text);

export const DOMAIN_PROFILES: DomainProfile[] = [
  {
    id: 'project_tracking_pemp',
    hint: 'project_tracking',
    label: 'Project tracking',
    match: text => has(text, /pemp-?\d+|proje takip|proje yonetim sistemi/),
  },
  {
    id: 'sap_crm_iys',
    hint: 'regulated_consent_integration',
    label: 'Regulated consent integration',
    sourceSensitive: true,
    requiresExternalResearch: true,
    preferredSources: [
      'IYS official website and documentation (iys.org.tr)',
      'IYS AHS API documentation (ahsdocs.iys.org.tr)',
      'Official legislation (mevzuat.gov.tr)',
      'Ticaret Bakanligi official pages (ticaret.gov.tr)',
    ],
    researchQueries: [
      'site:iys.org.tr IYS official consent documentation',
      'site:mevzuat.gov.tr 6563 IYS 3 is gunu',
      'site:ahsdocs.iys.org.tr recipientType official API documentation',
      'site:ticaret.gov.tr IYS 3 is gunu',
    ],
    actInstructions: [
      'Treat legislation and API behavior as VERIFIED only when a grounded official source is present.',
      'Do not inject channels, fields, deadlines, process names or integration products that are absent from the source.',
    ],
    match: text => has(text, /iys|ileti yonetim sistemi/),
  },
  {
    id: 'sap_crm_ai_sales_bot',
    hint: 'ai_assistant',
    label: 'AI assistant',
    sourceSensitive: true,
    requiresExternalResearch: true,
    preferredSources: [
      'SAP Help Portal official CRM and Sales documentation',
      'SAP official Business AI and Joule documentation',
      'Applicable privacy and AI governance sources',
    ],
    researchQueries: [
      'site:help.sap.com SAP CRM sales lead opportunity activity management',
      'site:sap.com SAP Business AI Joule sales assistant',
      'CRM AI lead qualification official AI governance privacy',
    ],
    actInstructions: [
      'Separate requested behavior, verified platform capability, design inference and open decision.',
      'Do not inject a ready-made sales process, entity list or KPI catalog.',
    ],
    match: text => has(text, /ai|yapay zeka|bot|chatbot|asistan|assistant/)
      && has(text, /crm|satis|sales|lead|opportunity|musteri/),
  },
  {
    id: 'field_mobile_app',
    hint: 'field_mobile',
    label: 'Field or mobile application',
    match: text => has(text, /d2d|saha|field|mobile|mobil|offline|refactor/),
  },
  {
    id: 'digital_contract',
    hint: 'digital_contract',
    label: 'Digital contract',
    sourceSensitive: true,
    requiresExternalResearch: true,
    preferredSources: ['Applicable electronic signature legislation', 'Official signature provider documentation'],
    match: text => has(text, /dijital sozlesme|elektronik sozlesme|e-?imza|mobil imza/),
  },
  {
    id: 'operations_platform',
    hint: 'operations_platform',
    label: 'Operations platform',
    match: text => has(text, /operasyon|case|talep yonetimi|is listesi|sla|mutabakat/),
  },
  {
    id: 'integration_project',
    hint: 'integration',
    label: 'Integration',
    sourceSensitive: true,
    requiresExternalResearch: true,
    preferredSources: ['Official provider and vendor API documentation'],
    match: text => has(text, /entegrasyon|integration|api|middleware|webhook|rest|soap/),
  },
];

const unique = (values: string[]): string[] => Array.from(new Set(values.map(value => value.trim()).filter(Boolean)));

export function detectDomainProfiles(source = ''): DomainProfile[] {
  const normalized = normalizeDomainText(source);
  return DOMAIN_PROFILES.filter(profile => profile.match(normalized));
}

export function getDomainProfileById(id: DomainProfileId): DomainProfile | undefined {
  return DOMAIN_PROFILES.find(profile => profile.id === id);
}

export function getPrimaryDomainProfile(source = ''): DomainProfile | undefined {
  return detectDomainProfiles(source)[0];
}

export function hasDomainProfile(source = '', id: DomainProfileId): boolean {
  return detectDomainProfiles(source).some(profile => profile.id === id);
}

export function domainHintsForSource(source = ''): string[] {
  return unique(detectDomainProfiles(source).map(profile => profile.hint));
}

/** @deprecated Project facts must be extracted from source intelligence. */
export function profileSignalsForSource(_source = ''): DomainSignalContribution {
  return {};
}

/** @deprecated A profile may not invent a project name. */
export function inferredProjectNameFromProfile(_source = ''): undefined {
  return undefined;
}

/** @deprecated A profile may not invent process titles. */
export function processTitlesFromProfile(_source = ''): string[] {
  return [];
}

/** @deprecated Process count is source-driven. */
export function expectedProcessCountFromProfiles(_source = '', fallback = 0): number {
  return fallback;
}

export function preferredSourcesForSource(source = '', fallback: string[] = []): string[] {
  const values = detectDomainProfiles(source).flatMap(profile => profile.preferredSources || []);
  return unique(values.length ? values : fallback);
}

export function researchQueriesForSource(source = '', fallback: string[] = []): string[] {
  const values = detectDomainProfiles(source).flatMap(profile => profile.researchQueries || []);
  return unique(values.length ? values : fallback);
}

export function actInstructionsForSource(source = ''): string[] {
  return unique(detectDomainProfiles(source).flatMap(profile => profile.actInstructions || []));
}

export function sourceSensitiveForSource(source = ''): boolean {
  return detectDomainProfiles(source).some(profile => profile.sourceSensitive);
}

export function requiresExternalResearchForSource(source = ''): boolean {
  return detectDomainProfiles(source).some(profile => profile.requiresExternalResearch);
}
