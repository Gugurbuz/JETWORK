import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../../../supabase/functions/ingest-knowledge-source/index.ts', import.meta.url),
  'utf8',
)

describe('knowledge ingestion Storage access', () => {
  it('validates the user path and knowledge-space permission before the server-side download', () => {
    const pathValidation = source.indexOf("storagePath.startsWith(`${authData.user.id}/${knowledgeSpaceId}/`)")
    const permissionValidation = source.indexOf("client.rpc('can_write_knowledge_space'")
    const serverDownload = source.indexOf('await adminClient.storage')

    expect(pathValidation).toBeGreaterThan(-1)
    expect(permissionValidation).toBeGreaterThan(pathValidation)
    expect(serverDownload).toBeGreaterThan(permissionValidation)
  })

  it('does not depend on the pre-catalog authenticated Storage read policy', () => {
    expect(source).toMatch(
      /const \{ data: fileData, error: downloadError \} = await adminClient\.storage\s*\.from\('knowledge-sources'\)\s*\.download\(storagePath\)/,
    )
    expect(source).not.toMatch(
      /const \{ data: fileData, error: downloadError \} = await client\.storage/,
    )
  })
})
