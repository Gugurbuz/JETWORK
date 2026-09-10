import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ASSISTANT_CONTEXT_TOOLS,
  executeContextTool,
  SEARCH_WEB_TOOL_NAME,
} from '../../../supabase/functions/_shared/context/contextTools'
import { buildControllerCapabilitySurface } from '../../../supabase/functions/_shared/capabilities/controllerSurface'

const coreIndexSource = readFileSync(
  new URL('../../../supabase/functions/openai-assistant-core-v2/index.ts', import.meta.url),
  'utf8',
)

describe('Controller V5 quota-independent web discovery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps quota-independent web discovery logically available behind progressive disclosure', () => {
    const surface = buildControllerCapabilitySurface()
    expect(surface.logicalToolNames).toContain(SEARCH_WEB_TOOL_NAME)
    expect(surface.toolNames).not.toContain(SEARCH_WEB_TOOL_NAME)
    expect(surface.toolNames).toContain('discover_more_capabilities')
    expect(surface.providerWebVisible).toBe(false)

    const schema = ASSISTANT_CONTEXT_TOOLS.find(tool => tool.name === SEARCH_WEB_TOOL_NAME)
    expect(schema).toBeTruthy()
    expect(schema?.description).toContain('discovery candidates')
    expect(coreIndexSource).toContain("import { installGeminiProviderWebQuotaFallback }")
    expect(coreIndexSource).toContain('installGeminiProviderWebQuotaFallback()')
  })

  it('returns every RSS item delivered by the mechanical search endpoint without a runtime source-count cap', async () => {
    const rss = `<?xml version="1.0"?>
      <rss><channel>
        <item><title>One</title><link>https://example.com/one</link><description>First result</description></item>
        <item><title>Two &amp; More</title><link>https://example.com/two</link><description><![CDATA[Second <b>result</b>]]></description></item>
        <item><title>Three</title><link>https://example.com/three</link><description>Third result</description></item>
      </channel></rss>`

    vi.stubGlobal('fetch', vi.fn(async () => new Response(rss, {
      status: 200,
      headers: { 'Content-Type': 'application/rss+xml' },
    })))

    const execution = await executeContextTool({
      client: null,
      workspaceId: 'workspace-test',
      toolName: SEARCH_WEB_TOOL_NAME,
      args: { query: 'example query' },
    })

    const payload = JSON.parse(execution.output)
    expect(payload.citationReady).toBe(false)
    expect(payload.records).toEqual([
      { title: 'One', url: 'https://example.com/one', snippet: 'First result' },
      { title: 'Two & More', url: 'https://example.com/two', snippet: 'Second result' },
      { title: 'Three', url: 'https://example.com/three', snippet: 'Third result' },
    ])
    expect(execution.sources).toEqual([])
    expect(execution.summary).toMatchObject({
      webDiscovery: true,
      discoveryOnly: true,
      citationReady: false,
      provider: 'bing_rss',
      resultCount: 3,
      sourceCountCappedByRuntime: false,
    })
  })
})
