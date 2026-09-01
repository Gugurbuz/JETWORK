import { readFileSync, writeFileSync } from 'node:fs'

const path = 'supabase/functions/openai-assistant-core-v2/implementation.ts'
let source = readFileSync(path, 'utf8')

const replaceOnce = (from, to, label) => {
  if (!source.includes(from)) throw new Error(`Patch anchor not found: ${label}`)
  source = source.replace(from, to)
}

replaceOnce(
"import { AGENT_CONTROLLER_VERSION } from '../_shared/agentControllerPolicy.ts'\n",
"import { AGENT_CONTROLLER_VERSION } from '../_shared/agentControllerPolicy.ts'\nimport { compactPersistentConversationState } from '../_shared/persistentConversationState.ts'\n",
'import persistent state helper',
)

replaceOnce(
`function compactConversationState(items: Array<Record<string, unknown>>) {
  let state = [...items]
  const exceedsBudget = () => state.length > 120 || JSON.stringify(state).length > 220_000
  while (exceedsBudget()) {
    const nextUserIndex = state.findIndex((item, index) => index > 0 && item.role === 'user')
    if (nextUserIndex <= 0) break
    state = state.slice(nextUserIndex)
  }
  return state
}
`,
`function compactConversationState(
  items: Array<Record<string, unknown>>,
  plan?: ReasoningPlan,
) {
  return compactPersistentConversationState(items, plan)
}
`,
'legacy raw state compactor',
)

const finalizationCall = "compactConversationState([...baseItems, { role: 'assistant', content: deterministicText }])"
replaceOnce(finalizationCall, "compactConversationState([...baseItems, { role: 'assistant', content: deterministicText }], plan)", 'deterministic final state')

const normalCall = "compactConversationState([...baseItems, { role: 'assistant', content: roundText }])"
replaceOnce(normalCall, "compactConversationState([...baseItems, { role: 'assistant', content: roundText }], plan)", 'normal final state')

const recoveryCall = "compactConversationState([...baseItems, { role: 'assistant', content: recoveryText }])"
replaceOnce(recoveryCall, "compactConversationState([...baseItems, { role: 'assistant', content: recoveryText }], planForArtifactCompletion || undefined)", 'artifact recovery state')

writeFileSync(path, source)
console.log('Applied persistent conversation state fix.')
