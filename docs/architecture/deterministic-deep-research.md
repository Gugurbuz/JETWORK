# Deterministic Deep Research

Deep Research on Gemini does not rely on the final answer model deciding whether to search the web.

1. The provider wrapper detects a `research` plan with provider web enabled.
2. `deterministicGeminiWebResearch.ts` calls the Gemini Interactions API with Google Search as the only tool and `tool_choice: any`.
3. Search call/result steps are normalized into citable sources, search queries, evidence notes, and usage telemetry.
4. The routed Auto model receives those results as evidence and performs a no-tool final synthesis.
5. If an actual Google Search call cannot be observed, or it returns no citable source, JetWork reports that research was not source-complete rather than claiming success.

Non-research Gemini turns delegate to the existing provider implementation unchanged.
