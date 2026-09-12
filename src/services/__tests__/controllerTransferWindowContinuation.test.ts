import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readObservationContent } from '../../../supabase/functions/_shared/agent/observationBudget.ts'

const coreSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/implementation.ts', import.meta.url),
  'utf8',
)
const toolsSource = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url),
  'utf8',
)
const surfaceSource = readFileSync(
  new URL('../../../supabase/functions/_shared/capabilities/controllerSurface.ts', import.meta.url),
  'utf8',
)
const relationMigration = readFileSync(
  new URL('../../../supabase/migrations/20260912044500_relation_cursor_windows_v3.sql', import.meta.url),
  'utf8',
)

describe('Controller transfer windows do not cap intelligence', () => {
  it('has no turn-wide semantic tool, round, disclosure or observation-read ceiling', () => {
    expect(coreSource).not.toContain('ASSISTANT_V2_MAX_TOOL_ROUNDS')
    expect(coreSource).not.toContain('ASSISTANT_V2_MAX_TOOL_CALLS')
    expect(coreSource).not.toContain('ASSISTANT_V2_MAX_CAPABILITY_DISCLOSURE_CALLS')
    expect(coreSource).not.toContain('TOOL_BUDGET_EXHAUSTED')
    expect(coreSource).not.toContain('OBSERVATION_READ_BUDGET_EXHAUSTED')
    expect(coreSource).toContain('for (let round = 0; !runController.signal.aborted; round += 1)')
    expect(coreSource).toContain('FINAL_SYNTHESIS_RESERVE_MS')
  })

  it('continues observation content by cursor across as many windows as needed', () => {
    const output = Array.from({ length: 40 }, (_, index) => `line-${String(index).padStart(2, '0')}:${'x'.repeat(90)}`).join('\n')
    const first = readObservationContent({
      output,
      mode: 'slice',
      cursor: null,
      offset: 0,
      maxChars: 1000,
    })
    expect(first.ok).toBe(true)
    expect('nextCursor' in first ? first.nextCursor : null).toBeTruthy()

    const second = readObservationContent({
      output,
      mode: 'slice',
      cursor: 'nextCursor' in first ? first.nextCursor : null,
      offset: null,
      maxChars: 1000,
    })
    expect(second.ok).toBe(true)
    expect('returnedOffset' in second ? second.returnedOffset : 0).toBeGreaterThan(0)
    expect('text' in first && 'text' in second ? second.text : '').not.toBe('text' in first ? first.text : '')
  })

  it('makes focused ABAP and relation reads cursor-windowed rather than terminally truncated', () => {
    expect(toolsSource).toContain('focusCursor')
    expect(toolsSource).toContain('focusWindowSize')
    expect(toolsSource).toContain('focusPagination')
    expect(toolsSource).toContain('focusedTotalWindowCount')
    expect(toolsSource).toContain('focusNextCursor')
    expect(toolsSource).toContain('relationCursor')
    expect(toolsSource).toContain('relationWindowSize')
    expect(toolsSource).toContain('relationPagination')
    expect(toolsSource).toContain('get_related_knowledge_objects_v3')
    expect(surfaceSource).toContain('one concurrency window')
  })

  it('pages relation graph rows with offset/limit rather than a total relation ceiling', () => {
    expect(relationMigration).toContain('p_offset integer default 0')
    expect(relationMigration).toContain('offset greatest(0, coalesce(p_offset, 0))')
    expect(relationMigration).toContain('p_limit integer default 13')
    expect(relationMigration).toContain('limit greatest(1, least(coalesce(p_limit, 13), 21))')
  })
})
