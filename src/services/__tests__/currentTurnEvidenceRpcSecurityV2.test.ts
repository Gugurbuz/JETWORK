import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('current-turn evidence RPC security v2', () => {
  const source = readFileSync(
    new URL('../../../supabase/migrations/20260902190500_agent_current_turn_evidence_read.sql', import.meta.url),
    'utf8',
  )

  it('derives identity from auth and never accepts owner/turn identity from the model', () => {
    expect(source).toContain('caller_id uuid := auth.uid()')
    expect(source).toContain("turn_row.owner_id = caller_id")
    expect(source).toContain("turn_row.status = 'running'")
    expect(source).not.toMatch(/p_owner_id|p_turn_id/i)
  })

  it('returns only completed evidence-bearing tool runs from the current turn', () => {
    expect(source).toContain('run.turn_id = current_turn_id')
    expect(source).toContain("run.status = 'completed'")
    expect(source).toContain("jsonb_array_length(coalesce(run.source_refs, '[]'::jsonb)) > 0")
    expect(source).toContain("run.tool_name in ('web_search', 'gemini_google_search')")
    expect(source).toContain('limit 64')
  })

  it('revokes default execution and grants only authenticated users', () => {
    expect(source).toMatch(/revoke all on function[\s\S]*from public, anon, authenticated;/i)
    expect(source).toMatch(/grant execute on function[\s\S]*to authenticated;/i)
  })
})
