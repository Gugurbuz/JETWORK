export const ARTIFACT_REVISION_INVARIANT_VERSION = 'artifact-revision-invariant-v2'

export interface ArtifactRevisionSection {
  id: string
  content: unknown
}

export interface ArtifactRevisionInvariantResult {
  version: typeof ARTIFACT_REVISION_INVARIANT_VERSION
  ok: boolean
  allowedSectionIds: string[]
  changedSectionIds: string[]
  unauthorizedChangedSectionIds: string[]
  missingSectionIds: string[]
  addedSectionIds: string[]
}

const cleanId = (value: unknown) => String(value ?? '').trim().slice(0, 240)

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`
  }
  if (typeof value === 'string') return JSON.stringify(value.replace(/\r\n/g, '\n').trim())
  return JSON.stringify(value) ?? 'null'
}

const indexSections = (sections: readonly ArtifactRevisionSection[]) => {
  const indexed = new Map<string, string>()
  for (const section of sections) {
    const id = cleanId(section.id)
    if (!id) throw new Error('Artifact revision section id is required.')
    if (indexed.has(id)) throw new Error(`Duplicate artifact revision section id: ${id}`)
    indexed.set(id, stableJson(section.content))
  }
  return indexed
}

/**
 * Mechanical revision guard. It never decides which section should change;
 * the controller/user supplies allowedSectionIds. Runtime only verifies that
 * every non-target section stayed byte-equivalent after stable normalization.
 */
export const verifyArtifactRevisionInvariant = (input: {
  before: readonly ArtifactRevisionSection[]
  after: readonly ArtifactRevisionSection[]
  allowedSectionIds: readonly string[]
}): ArtifactRevisionInvariantResult => {
  const before = indexSections(input.before)
  const after = indexSections(input.after)
  const allowed = new Set(input.allowedSectionIds.map(cleanId).filter(Boolean))

  const missingSectionIds = [...before.keys()].filter(id => !after.has(id)).sort()
  const addedSectionIds = [...after.keys()].filter(id => !before.has(id)).sort()
  const changedSectionIds = [...before.keys()]
    .filter(id => after.has(id) && before.get(id) !== after.get(id))
    .sort()

  const unauthorizedChangedSectionIds = [
    ...changedSectionIds.filter(id => !allowed.has(id)),
    ...missingSectionIds.filter(id => !allowed.has(id)),
    ...addedSectionIds.filter(id => !allowed.has(id)),
  ].filter((value, index, array) => array.indexOf(value) === index).sort()

  return {
    version: ARTIFACT_REVISION_INVARIANT_VERSION,
    ok: unauthorizedChangedSectionIds.length === 0,
    allowedSectionIds: [...allowed].sort(),
    changedSectionIds,
    unauthorizedChangedSectionIds,
    missingSectionIds,
    addedSectionIds,
  }
}
