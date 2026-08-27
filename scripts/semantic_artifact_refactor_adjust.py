from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 exact match, found {count}")
    return text.replace(old, new, 1)

# Keep the existing primary-agent evidence policy intact. The Enerjisa DOCX
# post-plan specialization is responsible for elevating an analysis source into
# a document/artifact execution contract. This refactor targets only the raw
# artifact-intent router inside core.
semantic_path = Path('supabase/functions/_shared/semanticOrchestrator.ts')
semantic = semantic_path.read_text()
semantic = replace_once(
    semantic,
    "        knowledgeRequired: false,\n        webMode: 'none' as const,",
    "        intent: 'analysis' as const,\n        knowledgeRequired: false,\n        webMode: 'none' as const,",
    'restore requirements coarse intent',
)
semantic = replace_once(
    semantic,
    "    // The user's supplied requirement/specification text is itself primary evidence.\n    // It may change evidence policy, but it must never overwrite the user's task intent.\n    // Otherwise respect the route without forcing every primary-agent turn into knowledge + public web mode.",
    "    // The user's supplied requirement/specification text is itself the primary\n    // evidence for analysis. Otherwise respect the deterministic router instead\n    // of forcing every primary-agent turn into knowledge + public web mode.",
    'restore semantic comment',
)
semantic_path.write_text(semantic)

reasoning_path = Path('src/services/__tests__/reasoningAgentLoopV3.test.ts')
reasoning = reasoning_path.read_text()
reasoning = replace_once(
    reasoning,
    "  it('keeps an explicit document task when the supplied source is a long requirement document', async () => {",
    "  it('treats a long supplied requirement as self-contained evidence without adding a planner call', async () => {",
    'rename regression test',
)
reasoning = replace_once(
    reasoning,
    "    expect(result.plan.intent).toBe('document')\n    expect(result.plan.executionMode).toBe('artifact')",
    "    expect(result.plan.intent).toBe('analysis')\n    expect(result.plan.executionMode).toBe('direct')",
    'align coarse intent expectations',
)
reasoning_path.write_text(reasoning)
