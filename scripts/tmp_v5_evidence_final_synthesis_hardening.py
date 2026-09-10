from pathlib import Path
p = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
s = p.read_text()
old = "                allowTools: tools.length > 0 || providerWebEnabled || geminiNativeWebPlanned,\n                allowProviderWeb: providerWebEnabled || geminiNativeWebPlanned,"
new = "                allowTools: !forceEvidenceFinalSynthesis && (tools.length > 0 || providerWebEnabled || geminiNativeWebPlanned),\n                allowProviderWeb: !forceEvidenceFinalSynthesis && (providerWebEnabled || geminiNativeWebPlanned),"
if old not in s:
    raise SystemExit('allow-tools marker missing')
s = s.replace(old, new, 1)
old = "              && hasVerifiedKnowledgeSource\n              && !evidenceFinalSynthesisAttempted"
new = "              && hasVerifiedKnowledgeSource\n              && (!semanticArtifactRequired() || generatedArtifacts.size > 0)\n              && !evidenceFinalSynthesisAttempted"
if old not in s:
    raise SystemExit('artifact guard marker missing')
s = s.replace(old, new, 1)
p.write_text(s)
