from pathlib import Path

p = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
s = p.read_text()

old = "import { buildGeminiContextCachePolicy, clampLargeContextCharacters } from '../_shared/geminiContextCachePolicy.ts'\n"
new = old + "import { buildGeminiFinalSynthesisItems } from '../_shared/geminiCostGuard.ts'\n"
if old not in s:
    raise SystemExit('import marker missing')
s = s.replace(old, new, 1)

old = "        let maxControllerRound = MAX_TOOL_ROUNDS\n        for (let round = 0; round <= maxControllerRound; round += 1) {\n"
new = "        let maxControllerRound = MAX_TOOL_ROUNDS\n        let evidenceFinalSynthesisAttempted = false\n        let evidenceFinalSynthesisPending = false\n        for (let round = 0; round <= maxControllerRound; round += 1) {\n"
if old not in s:
    raise SystemExit('loop marker missing')
s = s.replace(old, new, 1)

old = "          const requestActiveProvider = async () => {\n            const skillToolsEnabled = !mustSynthesize\n"
new = "          const requestActiveProvider = async () => {\n            const forceEvidenceFinalSynthesis = evidenceFinalSynthesisPending\n            const skillToolsEnabled = !mustSynthesize && !forceEvidenceFinalSynthesis\n"
if old not in s:
    raise SystemExit('request marker missing')
s = s.replace(old, new, 1)

old = "            const knowledgeToolsEnabled = !mustSynthesize\n"
new = "            const knowledgeToolsEnabled = !mustSynthesize && !forceEvidenceFinalSynthesis\n"
if old not in s:
    raise SystemExit('knowledge marker missing')
s = s.replace(old, new, 1)

old = "            const providerWebEnabled = !mustSynthesize\n"
new = "            const providerWebEnabled = !mustSynthesize && !forceEvidenceFinalSynthesis\n"
if old not in s:
    raise SystemExit('provider web marker missing')
s = s.replace(old, new, 1)

old = "            const agenticVisibleTools = !mustSynthesize && AGENTIC_CONTROLLER_ENABLED\n"
new = "            const agenticVisibleTools = !mustSynthesize && !forceEvidenceFinalSynthesis && AGENTIC_CONTROLLER_ENABLED\n"
if old not in s:
    raise SystemExit('agentic tools marker missing')
s = s.replace(old, new, 1)

old = "                instructions: [synthesisInstruction, finalInstruction].filter(Boolean).join('\\n\\n'),\n"
new = "                instructions: [\n                  synthesisInstruction,\n                  finalInstruction,\n                  forceEvidenceFinalSynthesis\n                    ? 'EVIDENCE_FINAL_SYNTHESIS: Bu aynı Controller modelinin final cevap turudur. Yeni tool çağırma. JETWORK_TOOL_EVIDENCE içindeki doğrulanmış kaynakları ve konuşma hedefini birlikte kullan; kaynak hedefi yanıtlıyorsa genel sözlük anlamlarına geri dönme.'\n                    : '',\n                ].filter(Boolean).join('\\n\\n'),\n"
if old not in s:
    raise SystemExit('gemini instruction marker missing')
s = s.replace(old, new, 1)

old = "          if (!functionCalls.length) {\n            if (semanticArtifactRequired() && generatedArtifacts.size === 0) {\n"
new = "          if (!functionCalls.length) {\n            const hasVerifiedKnowledgeSource = sources.some(source => source.sourceType !== 'web' && Boolean(source.canonicalKey || source.sourceId))\n            if (\n              activeProvider === 'gemini'\n              && AGENTIC_CONTROLLER_ENABLED\n              && hasVerifiedKnowledgeSource\n              && !evidenceFinalSynthesisAttempted\n            ) {\n              evidenceFinalSynthesisAttempted = true\n              evidenceFinalSynthesisPending = true\n              const finalSynthesisItems = buildGeminiFinalSynthesisItems(runItems)\n              runItems.splice(0, runItems.length, ...finalSynthesisItems)\n              if (round >= maxControllerRound) maxControllerRound += 1\n              usage = addUsage(usage, { gemini_evidence_final_synthesis: 1 })\n              emitStatus('synthesizing', 'Toplanan kaynaklar nihai yanıta dönüştürülüyor...')\n              continue\n            }\n            evidenceFinalSynthesisPending = false\n            if (semanticArtifactRequired() && generatedArtifacts.size === 0) {\n"
if old not in s:
    raise SystemExit('finalization marker missing')
s = s.replace(old, new, 1)

p.write_text(s)
