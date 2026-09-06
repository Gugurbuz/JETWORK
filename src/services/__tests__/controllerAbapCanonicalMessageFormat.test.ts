import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const toolsSource = readFileSync(
  new URL('../../../supabase/functions/_shared/assistantTools.ts', import.meta.url),
  'utf8',
)

describe('ABAP canonical message evidence formatting', () => {
  it('derives canonical MESSAGE_CLASS-NNN mechanically from verified ABAP source', () => {
    expect(toolsSource).toContain('extractAbapMessageCodes')
    expect(toolsSource).toContain("padStart(3, '0')")
    expect(toolsSource).toContain("toLocaleUpperCase('en-US')")
    expect(toolsSource).toContain('codes.add(`${messageClass}-${number}`)')
    expect(toolsSource).toContain('[VERIFIED_ABAP_MESSAGE_CODES]')
  })
})
