import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260909221000_public_work_plan_continuity.sql', import.meta.url),
  'utf8',
)

describe('public work-plan continuity', () => {
  it('prefers the controller model authored resolved goal on the next turn', () => {
    expect(migration).toContain("tool.tool_name = 'report_progress'")
    expect(migration).toContain("tool.arguments ->> 'kind' in ('start', 'plan_change')")
    expect(migration).toContain("nullif(work.arguments ->> 'resolvedGoal', '')")
    expect(migration.indexOf("nullif(work.arguments ->> 'resolvedGoal', '')"))
      .toBeLessThan(migration.indexOf("nullif(run.plan #>> '{conversationState,resolvedRequest}', '')"))
  })

  it('returns the latest model-authored work plan and evidence gaps with the prior context', () => {
    expect(migration).toContain("work.arguments -> 'planSteps'")
    expect(migration).toContain("work.arguments -> 'evidenceGaps'")
    expect(migration).toContain("order by tool.created_at desc")
  })
})
