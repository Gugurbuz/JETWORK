import {
  requestGeminiResponse as baseRequestGeminiResponse,
  type NormalizedModelResponse,
} from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/58f99ff6c8c130859bf4cf705d4d0add2eb28cd0/supabase/functions/_shared/modelProviders.ts?authoritative-terminal-base=1'

export * from 'https://raw.githubusercontent.com/Gugurbuz/JETWORK/58f99ff6c8c130859bf4cf705d4d0add2eb28cd0/supabase/functions/_shared/modelProviders.ts?authoritative-terminal-base=1'

const clean = (value: unknown, max = 20_000) => String(value ?? '').trim().slice(0, max)

const latestAuthoritativePayload = (items: Array<Record<string, unknown>>) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.type !== 'function_call_output') continue
    try {
      const payload = JSON.parse(String(item.output || ''))
      if (!payload || typeof payload !== 'object') continue
      if (!payload.resolution || !payload.answerContract) continue
      const basis = clean(payload.resolution?.basis, 80)
      if (!['explicit', 'conversation', 'catalog_unique'].includes(basis)) continue
      return payload
    } catch {
      // Ignore malformed/non-authoritative tool outputs.
    }
  }
  return null
}

const focusedLiteralExcerpt = (literalSource: string, messageName: string) => {
  const match = /^([A-Z][A-Z0-9_]*)-(\d{2,4})$/u.exec(messageName.toUpperCase())
  if (!match) return clean(literalSource, 5_000)
  const [, messageClass, numberRaw] = match
  const number = numberRaw.padStart(3, '0')
  const lines = String(literalSource || '').split(/\r?\n/)
  const hitIndexes = lines.flatMap((line, index) => {
    const normalized = line.toUpperCase()
    return normalized.includes(`MESSAGE E${number}(${messageClass})`)
      || normalized.includes(`IV_MSG_NUMBER = '${number}'`)
      || normalized.includes(`IV_MSG_NUMBER= '${number}'`)
      ? [index]
      : []
  })
  if (!hitIndexes.length) return clean(literalSource, 5_000)

  const first = Math.max(0, Math.min(...hitIndexes) - 4)
  let last = Math.min(lines.length - 1, Math.max(...hitIndexes) + 5)
  for (let index = Math.max(...hitIndexes); index < Math.min(lines.length, Math.max(...hitIndexes) + 12); index += 1) {
    if (/^\s*ENDIF\.\s*$/iu.test(lines[index])) {
      last = index
      break
    }
  }
  return lines.slice(first, last + 1).join('\n').trim()
}

const directAuthoritativeAnswer = (payload: any): string | null => {
  const mode = clean(payload.answerContract?.mode, 80)
  const selectedName = clean(payload.resolution?.selectedName, 180)

  if (mode === 'ambiguity') {
    const candidates = Array.isArray(payload.resolution?.candidates)
      ? payload.resolution.candidates.map((value: unknown) => clean(value, 180)).filter(Boolean)
      : []
    if (!candidates.length) return null
    return `Bu kısa referans birden fazla doğrulanmış mesajla eşleşiyor: ${candidates.join(', ')}. Hangisini kastettiğini belirtirsen doğru kaynağı verebilirim.`
  }

  if (mode !== 'literal_source' || !selectedName) return null
  const evidence = Array.isArray(payload.implementationEvidence)
    ? payload.implementationEvidence.find((row: any) => clean(row?.literalSource, 50_000))
    : null
  if (!evidence) return null

  const excerpt = focusedLiteralExcerpt(clean(evidence.literalSource, 50_000), selectedName)
  if (!excerpt) return null
  const implementationName = clean(evidence.title || evidence.name, 300)
  const sourceName = clean(evidence.sourceName, 300)
  const messageRecord = Array.isArray(payload.records) ? payload.records[0] : null
  const messageTitle = clean(messageRecord?.title || messageRecord?.summary, 600)

  return [
    `**${selectedName}** için doğrulanmış ABAP kaynak bloğu${implementationName ? ` \`${implementationName}\` içinde` : ''}:`,
    messageTitle && messageTitle.toUpperCase() !== selectedName.toUpperCase() ? `\n${messageTitle}` : '',
    `\n\n\`\`\`abap\n${excerpt}\n\`\`\``,
    sourceName ? `\n\nKaynak: ${sourceName}` : '',
  ].filter(Boolean).join('')
}

const terminalResponse = (
  model: string,
  text: string,
): NormalizedModelResponse => ({
  id: `jetwork-authoritative-terminal:${crypto.randomUUID()}`,
  status: 'completed',
  model,
  output: [{
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }],
  }],
  usage: {
    deterministic_authoritative_terminal: 1,
    deterministic_provider_calls_avoided: 1,
    primary_llm_final_calls: 0,
  },
})

export async function requestGeminiResponse(input: {
  apiKey: string
  model: string
  instructions: string
  items: Array<Record<string, unknown>>
  tools: ReadonlyArray<Record<string, unknown>>
  allowTools: boolean
  allowProviderWeb?: boolean
  maxOutputTokens: number
  onText: (text: string) => void
  signal?: AbortSignal
}): Promise<NormalizedModelResponse> {
  const payload = latestAuthoritativePayload(input.items)
  const directAnswer = payload ? directAuthoritativeAnswer(payload) : null
  if (directAnswer) {
    input.onText(directAnswer)
    return terminalResponse(input.model, directAnswer)
  }
  return baseRequestGeminiResponse(input)
}
