import fs from 'node:fs'

const path = 'supabase/functions/_shared/modelProvidersLegacy.ts'
const source = fs.readFileSync(path, 'utf8')
const pattern = /const contentPartsForGemini = \(content: unknown\): Array<Record<string, unknown>> => \{[\s\S]*?\n\}\n\nconst toGeminiContents/
if (!pattern.test(source)) throw new Error('multimodal helper not found after plan patch')
const replacement = `const contentPartsForGemini = (content: unknown): Array<Record<string, unknown>> => {
  if (typeof content === 'string') return content ? [{ text: content }] : []
  if (!Array.isArray(content)) return []
  const parts: Array<Record<string, unknown>> = []
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) parts.push({ text: part })
      continue
    }
    if (!part || typeof part !== 'object') continue
    const candidate = part as Record<string, unknown>
    if (typeof candidate.text === 'string' && candidate.text) {
      parts.push({ text: candidate.text })
      continue
    }
    const inlineData = candidate.inlineData && typeof candidate.inlineData === 'object'
      ? candidate.inlineData as Record<string, unknown>
      : null
    if (inlineData && typeof inlineData.mimeType === 'string' && typeof inlineData.data === 'string') {
      parts.push({ inlineData: { mimeType: inlineData.mimeType, data: inlineData.data } })
    }
  }
  return parts
}

const toGeminiContents`
fs.writeFileSync(path, source.replace(pattern, replacement))
console.log('Generated multimodal helper typing fixed')
