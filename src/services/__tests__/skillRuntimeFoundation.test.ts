import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_SKILL_TOOLS,
  executeSkillTool,
  loadSkills,
  searchSkills,
} from '../../../supabase/functions/_shared/skillTools.ts'
import { JETWORK_SKILLS } from '../../../supabase/functions/_shared/skillRegistry.generated.ts'

describe('JetWork skill runtime foundation', () => {
  it('keeps a compact P0 runtime registry separate from the 140-skill roadmap', () => {
    expect(JETWORK_SKILLS.length).toBeGreaterThanOrEqual(6)
    expect(new Set(JETWORK_SKILLS.map(skill => skill.key)).size).toBe(JETWORK_SKILLS.length)
    expect(JETWORK_SKILLS.every(skill => skill.priority === 'P0')).toBe(true)
  })

  it('finds the table-join skill for the real Jira/Excel mapping request', () => {
    const results = searchSkills({
      query: 'iki excel dosyasını JIRA No üzerinden eşleştir map et',
      limit: 6,
    })
    expect(results[0]?.key).toBe('spreadsheet/table-join')
  })

  it('finds the latest sprint skill for EN-Fast sprint extraction', () => {
    const results = searchSkills({
      query: 'birden fazla sprint içinden son EN-Fast sprint numarasını bul',
      limit: 6,
    })
    expect(results.some(result => result.key === 'jira/latest-sprint')).toBe(true)
  })

  it('loads at most four explicit skills and preserves missing-key errors', () => {
    const results = loadSkills([
      'spreadsheet/inspect',
      'spreadsheet/table-join',
      'jira/export-analysis',
      'jira/latest-sprint',
      'missing/skill',
    ])
    expect(results).toHaveLength(4)
    expect(results[0]).toMatchObject({ key: 'spreadsheet/inspect' })
    expect('content' in results[0]).toBe(true)
  })

  it('marks skill tool output as procedural and never citation-ready evidence', () => {
    const result = executeSkillTool('load_skills', { keys: ['spreadsheet/table-join'] })
    expect(result.sources).toEqual([])
    expect(result.summary).toMatchObject({ proceduralOnly: true, citationReady: false, loadedCount: 1 })
    expect(result.output).toContain('TRUSTED_JETWORK_SKILL_INSTRUCTION')
  })

  it('exposes only discovery and materialization as model-facing skill tools', () => {
    expect(ASSISTANT_SKILL_TOOLS.map(tool => tool.name)).toEqual(['search_skills', 'load_skills'])
  })
})
