import { describe, expect, it } from 'vitest'
import {
  executeSkillTool,
  loadSkills,
  searchSkills,
} from '../../../supabase/functions/_shared/skillTools.ts'
import { JETWORK_SKILLS } from '../../../supabase/functions/_shared/skillRegistry.generated.ts'

const USER_REQUEST = [
  'Mevcut durum Excel dosyasını Jira export ile JIRA No üzerinden eşleştir.',
  'Jira tarafında Done veya Closed olan işleri tamamlandı olarak işaretle.',
  'Birden fazla sprint varsa en son EN-Fast sprintini bulup Enfast Sprint kolonuna yaz.',
  'Mevcut Excel formatını bozma ve çıktı dosyasını teslim etmeden önce kalite kontrol et.',
].join(' ')

const EXPECTED_CHAIN = [
  'spreadsheet/inspect',
  'jira/export-analysis',
  'spreadsheet/table-join',
  'jira/status-normalize',
  'jira/latest-sprint',
  'spreadsheet/format-preserve',
  'spreadsheet/quality-check',
] as const

const expectSearchContains = (query: string, expected: readonly string[]) => {
  const results = searchSkills({ query, limit: 8 })
  const keys = new Set(results.map(result => result.key))
  for (const key of expected) {
    expect(keys.has(key), `expected discovery to include ${key}; got ${[...keys].join(', ')}`).toBe(true)
  }
}

describe('JetWork Excel + Jira E2E skill chain', () => {
  it('discovers the main execution skills from the real user request', () => {
    expectSearchContains(USER_REQUEST, [
      'jira/export-analysis',
      'spreadsheet/table-join',
      'jira/status-normalize',
      'jira/latest-sprint',
    ])
  })

  it('uses iterative lazy discovery for preparation and finalization skills', () => {
    expectSearchContains(
      'Excel workbook yapısını değiştirmeden önce incele, sheet header formül ve veri tiplerini kontrol et',
      ['spreadsheet/inspect'],
    )
    expectSearchContains(
      'Mevcut Excel formatını bozma, biçimi ve formülleri koru; çıktı dosyasını teslim etmeden önce kalite kontrol et',
      ['spreadsheet/format-preserve', 'spreadsheet/quality-check'],
    )
  })

  it('keeps the full expected chain active in the 40-skill runtime registry', () => {
    const activeKeys = new Set(JETWORK_SKILLS.map(skill => skill.key))
    for (const key of EXPECTED_CHAIN) expect(activeKeys.has(key)).toBe(true)
  })

  it('materializes the workflow lazily in batches without exceeding the four-skill load budget', () => {
    const firstBatch = loadSkills(EXPECTED_CHAIN.slice(0, 4))
    const secondBatch = loadSkills(EXPECTED_CHAIN.slice(4))
    const loaded = [...firstBatch, ...secondBatch]

    expect(firstBatch).toHaveLength(4)
    expect(secondBatch).toHaveLength(3)
    expect(loaded.map(record => record.key)).toEqual([...EXPECTED_CHAIN])
    expect(loaded.every(record => 'content' in record)).toBe(true)
  })

  it('keeps all materialized skill text procedural-only and outside evidence/citations', () => {
    const first = executeSkillTool('load_skills', { keys: EXPECTED_CHAIN.slice(0, 4) })
    const second = executeSkillTool('load_skills', { keys: EXPECTED_CHAIN.slice(4) })

    for (const result of [first, second]) {
      expect(result.sources).toEqual([])
      expect(result.summary).toMatchObject({ proceduralOnly: true, citationReady: false })
      expect(result.output).toContain('TRUSTED_JETWORK_SKILL_INSTRUCTION')
    }
  })

  it('finishes the workflow with format preservation followed by output QA', () => {
    expect(EXPECTED_CHAIN.at(-2)).toBe('spreadsheet/format-preserve')
    expect(EXPECTED_CHAIN.at(-1)).toBe('spreadsheet/quality-check')
  })
})
