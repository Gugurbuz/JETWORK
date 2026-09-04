export const OFFICE_REVISION_VERIFIER_VERSION = 'office-revision-verifier-v2'

export interface OfficeRevisionVerification {
  version: typeof OFFICE_REVISION_VERIFIER_VERSION
  verified: boolean
  format: 'docx' | 'pptx' | 'unknown'
  operation: string
  failures: string[]
}

const clean = (value: unknown, max = 20_000) => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, max)

const normalizeInspection = (value: unknown): { format: 'docx' | 'pptx' | 'unknown'; body: unknown } => {
  const inspection = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const format = inspection.format === 'docx' || inspection.format === 'pptx' ? inspection.format : 'unknown'
  if (format === 'docx') {
    return {
      format,
      body: {
        text: clean(inspection.text),
        headers: Array.isArray(inspection.headers) ? inspection.headers.map(item => clean(item, 8_000)) : [],
        footers: Array.isArray(inspection.footers) ? inspection.footers.map(item => clean(item, 8_000)) : [],
      },
    }
  }
  if (format === 'pptx') {
    const slides = Array.isArray(inspection.slides) ? inspection.slides : []
    return {
      format,
      body: slides.map((item, index) => {
        const slide = item && typeof item === 'object' ? item as Record<string, unknown> : {}
        return { slide: Number(slide.slide || index + 1), text: clean(slide.text, 8_000) }
      }),
    }
  }
  return { format: 'unknown', body: null }
}

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

const replaceStrings = (value: unknown, findText: string, replacementText: string): unknown => {
  if (typeof value === 'string') return value.split(findText).join(replacementText)
  if (Array.isArray(value)) return value.map(item => replaceStrings(item, findText, replacementText))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => [key, replaceStrings(nested, findText, replacementText)]))
  }
  return value
}

/**
 * Mechanical post-edit verifier. The semantic choice of what to edit belongs to
 * the controller/user. Runtime only proves that the persisted Office output is
 * exactly the declared replace/append transformation after normalized reload.
 */
export const verifyOfficeRevisionInvariant = (input: {
  beforeInspection: unknown
  afterInspection: unknown
  operation: string
  findText?: string | null
  replacementText?: string | null
}): OfficeRevisionVerification => {
  const before = normalizeInspection(input.beforeInspection)
  const after = normalizeInspection(input.afterInspection)
  const operation = clean(input.operation, 40)
  const findText = String(input.findText ?? '')
  const replacementText = String(input.replacementText ?? '')
  const failures: string[] = []

  if (before.format === 'unknown' || after.format === 'unknown') failures.push('unsupported_inspection_format')
  if (before.format !== after.format) failures.push('format_changed')

  if (!failures.length && operation === 'replace_text') {
    if (!findText) failures.push('find_text_missing')
    else {
      const expected = replaceStrings(before.body, findText, replacementText)
      if (stableJson(expected) !== stableJson(after.body)) failures.push('unexpected_non_target_change')
      if (stableJson(expected) === stableJson(before.body)) failures.push('declared_replacement_not_observed')
    }
  } else if (!failures.length && operation === 'append_text') {
    if (before.format !== 'docx') failures.push('append_requires_docx')
    else {
      const beforeBody = before.body as { text: string; headers: string[]; footers: string[] }
      const expectedBody = {
        ...beforeBody,
        text: [beforeBody.text, clean(replacementText)].filter(Boolean).join('\n'),
      }
      if (stableJson(expectedBody) !== stableJson(after.body)) failures.push('unexpected_non_target_change')
    }
  } else if (!failures.length) {
    failures.push('unsupported_edit_operation')
  }

  return {
    version: OFFICE_REVISION_VERIFIER_VERSION,
    verified: failures.length === 0,
    format: before.format,
    operation,
    failures,
  }
}
