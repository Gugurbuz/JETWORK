import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_SKILL_TOOLS,
  executeSkillTool,
  isSkillTool,
  loadSkills,
  searchSkills,
} from '../../../supabase/functions/_shared/skillTools.ts'
import { JETWORK_SKILLS } from '../../../supabase/functions/_shared/skillRegistry.generated.ts'

describe('JetWork skill runtime foundation', () => {
  it('activates the first 40 P0/P1 skills while keeping the 140-skill roadmap separate', () => {
    expect(JETWORK_SKILLS).toHaveLength(40)
    expect(new Set(JETWORK_SKILLS.map(skill => skill.key)).size).toBe(JETWORK_SKILLS.length)
    expect(JETWORK_SKILLS.every(skill => ['P0', 'P1'].includes(skill.priority))).toBe(true)
    const categories = new Set(JETWORK_SKILLS.map(skill => skill.category))
    for (const category of ['spreadsheet', 'jira', 'business-analysis', 'sap', 'engineering', 'files']) {
      expect(categories.has(category)).toBe(true)
    }
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

  it('discovers business-analysis and SAP skills from natural Turkish requests', () => {
    const impact = searchSkills({ query: 'bu değişiklik hangi sistemleri ve entegrasyonları etkiler', limit: 6 })
    expect(impact.some(result => result.key === 'business-analysis/impact-analysis')).toBe(true)

    const diagnosis = searchSkills({ query: 'SAP hata mesajının kök nedenini method ve source üzerinden analiz et', limit: 6 })
    expect(diagnosis.some(result => result.key === 'sap/diagnosis')).toBe(true)
  })

  it('loads at most four explicit skills and supports P1 materialization', () => {
    const results = loadSkills([
      'spreadsheet/inspect',
      'spreadsheet/table-join',
      'business-analysis/impact-analysis',
      'sap/diagnosis',
      'missing/skill',
    ])
    expect(results).toHaveLength(4)
    expect(results[0]).toMatchObject({ key: 'spreadsheet/inspect' })
    expect(results[2]).toMatchObject({ key: 'business-analysis/impact-analysis' })
    expect(results[3]).toMatchObject({ key: 'sap/diagnosis' })
    expect(results.every(result => 'content' in result)).toBe(true)
  })

  it('marks skill tool output as procedural and never citation-ready evidence', () => {
    const result = executeSkillTool('load_skills', { keys: ['business-analysis/impact-analysis', 'sap/diagnosis'] })
    expect(result.sources).toEqual([])
    expect(result.summary).toMatchObject({ proceduralOnly: true, citationReady: false, loadedCount: 2 })
    expect(result.output).toContain('TRUSTED_JETWORK_SKILL_INSTRUCTION')
  })

  it('keeps pure skill execution limited to discovery/materialization while exposing execution capabilities separately', () => {
    const names = ASSISTANT_SKILL_TOOLS.map(tool => tool.name)
    expect(names.slice(0, 2)).toEqual(['search_skills', 'load_skills'])
    expect(names).toEqual(expect.arrayContaining([
      'list_spreadsheet_attachments',
      'inspect_spreadsheet_file',
      'sync_spreadsheet_with_jira_export',
    ]))
    expect(isSkillTool('search_skills')).toBe(true)
    expect(isSkillTool('load_skills')).toBe(true)
    expect(isSkillTool('list_spreadsheet_attachments')).toBe(false)
    expect(isSkillTool('inspect_spreadsheet_file')).toBe(false)
    expect(isSkillTool('sync_spreadsheet_with_jira_export')).toBe(false)
  })
})
