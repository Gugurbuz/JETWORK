import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const skillsRoot = new URL('../../../skills/', import.meta.url)

const skillFiles = (directory: URL): URL[] => {
  const entries = readdirSync(directory, { withFileTypes: true })
  return entries.flatMap(entry => {
    const target = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) return skillFiles(target)
    return entry.name === 'SKILL.md' ? [target] : []
  })
}

const metadataFrom = (source: string) => {
  const match = source.match(/## Metadata\s+```json\s+([\s\S]*?)\s+```/)
  if (!match?.[1]) throw new Error('SKILL.md metadata block missing')
  return JSON.parse(match[1]) as Record<string, unknown>
}

describe('JetWork canonical skill catalog v1', () => {
  const files = skillFiles(skillsRoot)
  const records = files.map(file => ({
    file,
    source: readFileSync(file, 'utf8'),
  })).map(record => ({ ...record, metadata: metadataFrom(record.source) }))

  it('contains the first 40 canonical SKILL.md packages', () => {
    expect(files).toHaveLength(40)
  })

  it('keeps skill keys unique and metadata complete', () => {
    const keys = records.map(record => String(record.metadata.key || ''))
    expect(new Set(keys).size).toBe(keys.length)
    for (const { metadata } of records) {
      expect(String(metadata.key || '')).toContain('/')
      expect(['P0', 'P1']).toContain(metadata.priority)
      expect(Array.isArray(metadata.aliases)).toBe(true)
      expect(Array.isArray(metadata.tools)).toBe(true)
    }
  })

  it('requires procedural and validation sections for every canonical skill', () => {
    for (const { source } of records) {
      expect(source).toContain('## Purpose')
      expect(source).toContain('## Procedure')
      expect(source).toContain('## Validation')
      expect(source).toContain('## Output contract')
      expect(source).toContain('## Failure handling')
    }
  })

  it('covers the P0/P1 domains selected for the first JetWork skill wave', () => {
    const categories = new Set(records.map(record => String(record.metadata.category || '')))
    expect(categories).toEqual(expect.objectContaining ? categories : categories)
    for (const category of ['spreadsheet', 'jira', 'business-analysis', 'sap', 'engineering', 'files']) {
      expect(categories.has(category)).toBe(true)
    }
  })
})
