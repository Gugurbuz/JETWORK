import type {
  ConceptualDesignDocument,
  ProcessModel,
  Requirement,
  RequirementCategory,
  RequirementPriority,
  RequirementStatus,
} from './conceptualDesignTypes';

const CATEGORY_PREFIX_ORDER: RequirementCategory[] = ['BR', 'FR', 'NFR', 'UI', 'INT', 'DOC', 'RPT', 'SEC', 'PERF'];

const DEFAULT_PRIORITY: RequirementPriority = 'Must';
const DEFAULT_STATUS: RequirementStatus = 'Draft';

export interface RequirementCodeState {
  counters: Partial<Record<RequirementCategory, number>>;
  usedIds: Set<string>;
}

export interface RequirementNormalizationResult {
  document: ConceptualDesignDocument;
  changedRequirementIds: Array<{ previousId: string; nextId: string }>;
  warnings: string[];
}

export function createRequirementCodeState(requirements: Requirement[] = []): RequirementCodeState {
  const state: RequirementCodeState = {
    counters: {},
    usedIds: new Set(),
  };

  requirements.forEach(requirement => {
    const match = requirement.id?.match(/^([A-Z]+)-(\d+)$/);
    if (!match) return;
    const category = match[1] as RequirementCategory;
    const sequence = Number(match[2]);
    if (!CATEGORY_PREFIX_ORDER.includes(category) || Number.isNaN(sequence)) return;

    state.usedIds.add(requirement.id);
    state.counters[category] = Math.max(state.counters[category] || 0, sequence);
  });

  return state;
}

export function nextRequirementId(category: RequirementCategory, state: RequirementCodeState): string {
  const next = (state.counters[category] || 0) + 1;
  state.counters[category] = next;

  let candidate = `${category}-${String(next).padStart(3, '0')}`;
  while (state.usedIds.has(candidate)) {
    state.counters[category] = (state.counters[category] || 0) + 1;
    candidate = `${category}-${String(state.counters[category]).padStart(3, '0')}`;
  }

  state.usedIds.add(candidate);
  return candidate;
}

export function inferRequirementCategory(requirement: Partial<Requirement>, fallback: RequirementCategory = 'FR'): RequirementCategory {
  if (requirement.category && CATEGORY_PREFIX_ORDER.includes(requirement.category)) return requirement.category;

  const text = `${requirement.title || ''} ${requirement.statement || ''}`.toLowerCase();

  if (text.includes('yetki') || text.includes('rol') || text.includes('güvenlik') || text.includes('sso')) return 'SEC';
  if (text.includes('entegrasyon') || text.includes('filenet') || text.includes('azure') || text.includes('sap')) return 'INT';
  if (text.includes('doküman') || text.includes('belge') || text.includes('dosya')) return 'DOC';
  if (text.includes('toast') || text.includes('validasyon') || text.includes('modal') || text.includes('ekran')) return 'UI';
  if (text.includes('dashboard') || text.includes('rapor') || text.includes('kpi')) return 'RPT';
  if (text.includes('performans') || text.includes('saniye') || text.includes('yanıt')) return 'PERF';
  if (text.includes('audit') || text.includes('log') || text.includes('iz')) return 'SEC';
  if (text.includes('iş gereği') || text.includes('iş kuralı') || text.includes('kural')) return 'BR';

  return fallback;
}

function normalizeRequirement(
  requirement: Requirement,
  process: ProcessModel,
  state: RequirementCodeState,
  changedRequirementIds: RequirementNormalizationResult['changedRequirementIds'],
  warnings: string[],
): Requirement {
  const category = inferRequirementCategory(requirement, requirement.category || 'FR');
  const expectedPrefix = `${category}-`;
  const previousId = requirement.id;
  const idIsValid = previousId?.startsWith(expectedPrefix) && !state.usedIds.has(previousId);
  const nextId = idIsValid ? previousId : nextRequirementId(category, state);

  if (idIsValid) state.usedIds.add(nextId);

  if (previousId !== nextId) {
    changedRequirementIds.push({ previousId: previousId || '', nextId });
  }

  if (!requirement.acceptanceCriteria?.length) {
    warnings.push(`${nextId} için kabul kriteri yok; varsayılan kriter eklendi.`);
  }

  return {
    ...requirement,
    id: nextId,
    category,
    title: requirement.title?.trim() || requirement.statement.slice(0, 80),
    statement: requirement.statement?.trim() || requirement.title?.trim() || 'Gereksinim açıklaması netleştirilmelidir.',
    priority: requirement.priority || DEFAULT_PRIORITY,
    status: requirement.status || DEFAULT_STATUS,
    acceptanceCriteria: requirement.acceptanceCriteria?.length
      ? requirement.acceptanceCriteria
      : ['İlgili ekran/servis üzerinde gereksinim davranışı doğrulanabilir olmalıdır.'],
    relatedProcessIds: requirement.relatedProcessIds?.length
      ? Array.from(new Set(requirement.relatedProcessIds))
      : [process.id],
  };
}

export function normalizeProcessRequirements(
  process: ProcessModel,
  state: RequirementCodeState,
  result: Pick<RequirementNormalizationResult, 'changedRequirementIds' | 'warnings'>,
): ProcessModel {
  return {
    ...process,
    businessRequirements: process.businessRequirements.map(requirement => normalizeRequirement(
      requirement,
      process,
      state,
      result.changedRequirementIds,
      result.warnings,
    )),
  };
}

export function normalizeConceptualDesignRequirements(
  document: ConceptualDesignDocument,
): RequirementNormalizationResult {
  const allRequirements = document.processModels.flatMap(process => process.businessRequirements || []);
  const state = createRequirementCodeState([]);
  const changedRequirementIds: RequirementNormalizationResult['changedRequirementIds'] = [];
  const warnings: string[] = [];

  const processModels = document.processModels.map(process => normalizeProcessRequirements(
    process,
    state,
    { changedRequirementIds, warnings },
  ));

  const normalizedDocument: ConceptualDesignDocument = {
    ...document,
    processModels,
  };

  const originalIds = new Set(allRequirements.map(requirement => requirement.id));
  const normalizedIds = new Set(processModels.flatMap(process => process.businessRequirements.map(requirement => requirement.id)));
  if (originalIds.size !== allRequirements.length || normalizedIds.size !== allRequirements.length) {
    warnings.push('Gereksinim kodlarında tekrar tespit edildi ve kodlar normalize edildi.');
  }

  return {
    document: normalizedDocument,
    changedRequirementIds,
    warnings,
  };
}
