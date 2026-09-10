from pathlib import Path


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} matches, got {count}: {old[:180]!r}')
    p.write_text(text.replace(old, new, expected))

path = 'supabase/functions/_shared/capabilities/controllerSurface.ts'

replace_exact(
    path,
    "  description: 'Progressively inspect JetWork capabilities without giving semantic authority to runtime. Use query=\"index\" to load Layer-1 capability names with 1-2 sentence purpose summaries. After choosing up to four exact names yourself, use query=\"guide:name1,name2\" to load Layer-2 operational usage guidance. Only after reading those guides, use query=\"contract:name1,name2\" to activate the exact canonical Layer-3 schemas for those same names on the next model round. Runtime validates only exact names and disclosure order; it never chooses capabilities for you.',\n",
    "  description: 'Progressively inspect JetWork capabilities without giving semantic authority to runtime. Normal low-latency path: use query=\"index\" once to load Layer-1 capability names and purpose summaries, choose up to four exact names yourself, then use query=\"activate:name1,name2\" to receive their Layer-2 usage guides and mechanically activate their exact canonical schemas together for the next model round. Legacy query=\"guide:name1,name2\" then query=\"contract:name1,name2\" remains compatibility-only. Runtime validates exact names and disclosure order only; it never chooses capabilities for you.',\n",
)

replace_exact(
    path,
    "  | { layer: 'contract'; records: Array<{ name: string; activated: true }> }\n",
    "  | { layer: 'contract'; records: Array<{ name: string; activated: true }> }\n  | { layer: 'activated'; records: Array<{ name: string; category: string; summary: string; guide: string; activated: true }> }\n",
)

anchor = "  const guideMatch = query.match(/^guide\\s*:(.*)$/isu)\n"
activate_block = """  const activateMatch = query.match(/^activate\\s*:(.*)$/isu)\n  if (activateMatch) {\n    const requested = parseExactNames(activateMatch[1], requestedLimit)\n    if (!requested.length) {\n      return { ...input.session, lastDisclosure: { layer: 'error', records: [], message: 'No exact capability names from Layer-1 index were supplied.' } }\n    }\n    const records = requested.flatMap(name => {\n      const entry = capabilityIndexEntry(name)\n      return entry ? [{ name, category: entry.category, summary: entry.summary, guide: entry.guide, activated: true as const }] : []\n    })\n    const activatedToolNames = [...new Set([...input.session.activatedToolNames, ...records.map(record => record.name)])].slice(0, MAX_ACTIVATED_CAPABILITIES)\n    return {\n      ...input.session,\n      guidedToolNames: [...new Set([...input.session.guidedToolNames, ...records.map(record => record.name)])],\n      activatedToolNames,\n      surface: surfaceWithActivated(activatedToolNames),\n      lastDisclosure: { layer: 'activated', records },\n    }\n  }\n\n"""
replace_exact(path, anchor, activate_block + anchor)

replace_exact(
    path,
    "      message: 'Use exactly one progressive disclosure command: index, guide:<exact capability names>, or contract:<exact capability names>.',\n",
    "      message: 'Use a progressive disclosure command: index, activate:<exact capability names>, or the legacy guide:<names> / contract:<names> sequence.',\n",
)

old_instruction = "  instruction: 'JetWork uses three-layer progressive capability disclosure and the active model remains the sole semantic Controller. If the request needs no external capability, answer directly. If substantive tool-backed work is needed, publish report_progress(start) first. Then call discover_more_capabilities with query=\"index\" to read Layer-1 names plus 1-2 sentence purpose summaries. Choose up to four exact names yourself and call query=\"guide:name1,name2\" to read Layer-2 usage guidance. If a capability still fits, call query=\"contract:name1,name2\" for the same guided names; their exact canonical schemas will then become visible on the next round. Only then call the canonical tool itself. Runtime performs exact-name/order validation only; it never infers intent, chooses a capability, query, source, next tool or stop decision. Activated contracts are options, never mandatory next steps.',\n"
new_instruction = "  instruction: 'JetWork uses progressive capability disclosure and the active model remains the sole semantic Controller. If the request needs no external capability, answer directly. For substantive tool-backed work, report_progress(start) must be the first function call. When capability discovery is already needed, the same first model output may also include discover_more_capabilities with query=\"index\" after report_progress(start), avoiding a needless extra model round. Read the Layer-1 names and purpose summaries, choose up to four exact names yourself, then call query=\"activate:name1,name2\"; runtime returns their Layer-2 guides and activates the exact canonical schemas in that same mechanical disclosure step. On the next model round call the canonical tool itself. When multiple independent activated tool calls are already justified by the same observation, emit them in the same model response rather than serializing needless model rounds. Runtime performs exact-name/order validation only; it never infers intent, chooses a capability, query, source, next tool or stop decision. Activated contracts are options, never mandatory next steps. Legacy compatibility remains query=\"guide:name1,name2\" followed by query=\"contract:name1,name2\", but normal turns should use activate.',\n"
replace_exact(path, old_instruction, new_instruction)

test_path = Path('src/services/__tests__/capabilityDisclosureFastPathV51.test.ts')
test_path.write_text("""import { describe, expect, it } from 'vitest'\nimport {\n  capabilitySessionObservation,\n  discoverMoreForController,\n  startControllerCapabilitySession,\n} from '../../../supabase/functions/_shared/capabilities/controllerSurface.ts'\n\ndescribe('V5.1 low-latency progressive disclosure fast path', () => {\n  it('collapses guide + contract into one exact-name activation without runtime semantic selection', async () => {\n    let session = await startControllerCapabilitySession({ client: null, query: 'GET_SATILABILIR_LIMIT' })\n    session = await discoverMoreForController({ client: null, query: 'index', limit: 4, session })\n    expect(session.lastDisclosure.layer).toBe('index')\n\n    session = await discoverMoreForController({\n      client: null,\n      query: 'activate:search_knowledge_catalog,get_abap_source',\n      limit: 4,\n      session,\n    })\n\n    expect(session.lastDisclosure.layer).toBe('activated')\n    expect(session.guidedToolNames).toEqual(['search_knowledge_catalog', 'get_abap_source'])\n    expect(session.activatedToolNames).toEqual(['search_knowledge_catalog', 'get_abap_source'])\n    expect(session.surface.toolNames).toContain('search_knowledge_catalog')\n    expect(session.surface.toolNames).toContain('get_abap_source')\n  })\n\n  it('tells the Controller to batch progress + discovery and independent calls while keeping semantic authority', async () => {\n    const session = await startControllerCapabilitySession({ client: null, query: 'test' })\n    const instruction = capabilitySessionObservation(session).instruction\n    expect(instruction).toContain('sole semantic Controller')\n    expect(instruction).toContain('query=\"activate:name1,name2\"')\n    expect(instruction).toContain('same first model output')\n    expect(instruction).toContain('same model response rather than serializing needless model rounds')\n    expect(instruction).toContain('never infers intent, chooses a capability')\n  })\n})\n""")

print('V5.1 disclosure fast path patch applied.')
