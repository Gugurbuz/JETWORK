import { describe, expect, it } from 'vitest'
import { selectProjectMemoryContext } from '../../../supabase/functions/_shared/projectMemoryContext'

describe('scoped Project Brain context', () => {
  it('keeps only relevant confirmed memory and ignores proposed or unrelated rows', () => {
    const selected = selectProjectMemoryContext([
      {
        memory_key: 'decision.context_budget',
        value: 'Conversation context raw history yerine resolved state ile yönetilecek.',
        category: 'decision',
        confirmation_state: 'confirmed',
        source_type: 'user_message',
        memory_version: 2,
        valid_from: '2026-08-30T10:00:00Z',
      },
      {
        memory_key: 'decision.qwen',
        value: 'Qwen local grammar üzerinde çalış.',
        category: 'decision',
        confirmation_state: 'proposed',
        source_type: 'ai_inference',
        memory_version: 1,
        valid_from: '2026-08-31T10:00:00Z',
      },
      {
        memory_key: 'preference.ui_color',
        value: 'Buton rengi sarı olsun.',
        category: 'preference',
        confirmation_state: 'confirmed',
        source_type: 'user_message',
        memory_version: 1,
        valid_from: '2026-08-20T10:00:00Z',
      },
    ], 'JetWork conversation context budget ve resolved state geliştirmelerine devam et')

    expect(selected).toHaveLength(1)
    expect(selected[0].key).toBe('decision.context_budget')
    expect(selected[0].value).toContain('resolved state')
  })

  it('uses the newest trusted version of the same memory key', () => {
    const selected = selectProjectMemoryContext([
      {
        memory_key: 'constraint.answer_quality',
        value: 'Eski karar',
        category: 'constraint',
        confirmation_state: 'confirmed',
        source_type: 'user_message',
        memory_version: 1,
        valid_from: '2026-08-01T10:00:00Z',
      },
      {
        memory_key: 'constraint.answer_quality',
        value: 'Kalite düşmeden context küçültülecek.',
        category: 'constraint',
        confirmation_state: 'confirmed',
        source_type: 'user_message',
        memory_version: 2,
        valid_from: '2026-08-31T10:00:00Z',
      },
    ], 'answer quality context kalite constraint')

    expect(selected).toHaveLength(1)
    expect(selected[0].version).toBe(2)
    expect(selected[0].value).toBe('Kalite düşmeden context küçültülecek.')
  })

  it('keeps backward-compatible user-authored memory unless it was explicitly rejected', () => {
    const selected = selectProjectMemoryContext([
      {
        memory_key: 'requirement.follow_up',
        value: 'Kısa follow-up önceki aktif göreve bağlanmalı.',
        category: 'requirement',
        confirmation_state: 'unverified',
        source_type: 'user_message',
        memory_version: 1,
      },
      {
        memory_key: 'requirement.rejected',
        value: 'Rejected memory must not be used.',
        category: 'requirement',
        confirmation_state: 'rejected',
        source_type: 'user_message',
        memory_version: 1,
      },
    ], 'follow up aktif görev requirement')

    expect(selected.map(item => item.key)).toEqual(['requirement.follow_up'])
  })

  it('treats a newer explicit user rejection as a tombstone for an older confirmed version', () => {
    const selected = selectProjectMemoryContext([
      {
        memory_key: 'decision.active_runtime',
        value: 'Qwen runtime ile devam et.',
        category: 'decision',
        confirmation_state: 'confirmed',
        source_type: 'user_message',
        memory_version: 1,
        valid_from: '2026-08-31T10:00:00Z',
      },
      {
        memory_key: 'decision.active_runtime',
        value: 'Bu kararı artık kullanma.',
        category: 'decision',
        confirmation_state: 'rejected',
        source_type: 'user_message',
        memory_version: 2,
        valid_from: '2026-09-01T10:00:00Z',
      },
    ], 'active runtime kararına devam et')

    expect(selected).toEqual([])
  })

  it('does not let an AI rejection tombstone a confirmed user decision', () => {
    const selected = selectProjectMemoryContext([
      {
        memory_key: 'constraint.answer_quality',
        value: 'Kalite düşmeden context küçültülecek.',
        category: 'constraint',
        confirmation_state: 'confirmed',
        source_type: 'user_message',
        memory_version: 1,
      },
      {
        memory_key: 'constraint.answer_quality',
        value: 'AI bu kuralı reddetti.',
        category: 'constraint',
        confirmation_state: 'rejected',
        source_type: 'ai_inference',
        memory_version: 2,
      },
    ], 'answer quality context kalite constraint')

    expect(selected).toHaveLength(1)
    expect(selected[0].value).toBe('Kalite düşmeden context küçültülecek.')
  })
})
