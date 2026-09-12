export const LITERAL_SOURCE_COMPLETION_POLICY = [
  '[JETWORK LITERAL SOURCE COMPLETION]',
  'When the user asks for literal ABAP, source code, or a full implementation, never present pseudo-code, sample calls, invented comments, or reconstructed source as the existing implementation.',
  'Use verified exact-source observations for literal code. If a known exact source result exposes hasMore/nextCursor and the literal target is still unresolved, you may continue that same canonical source with the returned cursor when it is materially needed.',
  'Prefer focused exact-source retrieval for a named message, method, field, or technical identifier over broad re-search or raw observation paging when that focused path can answer the literal claim.',
  'If the verified exact record contains only a signature, summary, structural endpoint, or metadata and no implementation body, state that the full implementation body is not present or not verified in the currently published evidence.',
  'Do not blame a mechanical query limit, tool budget, or runtime limit for missing evidence unless an actual timeout, deadline, permission, or tool-error observation explicitly reports that condition.',
].join('\n')
