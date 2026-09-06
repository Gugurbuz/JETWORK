export const GEMINI_MULTIMODAL_CONTRACT_VERSION = 'gemini38-multimodal-v1'

export type GeminiMediaKind = 'image' | 'pdf' | 'audio' | 'video'

const MIME_KIND: Readonly<Record<string, GeminiMediaKind>> = {
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'application/pdf': 'pdf',
  'audio/mpeg': 'audio',
  'audio/wav': 'audio',
  'audio/x-wav': 'audio',
  'audio/mp4': 'audio',
  'audio/aac': 'audio',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
}

export const GEMINI_INLINE_MEDIA_MIMES = new Set(Object.keys(MIME_KIND))
export const MAX_GEMINI_INLINE_MEDIA_BYTES = 6 * 1024 * 1024
export const MAX_GEMINI_ASSISTANT_REQUEST_BYTES = 12 * 1024 * 1024

export const geminiMediaKindForMime = (mimeType: string): GeminiMediaKind | null => (
  MIME_KIND[String(mimeType || '').trim().toLocaleLowerCase('en-US')] || null
)

export const isGeminiInlineMediaMime = (mimeType: string) => geminiMediaKindForMime(mimeType) !== null

export const buildGeminiMediaSourceRef = (input: {
  name: string
  mimeType: string
  contentHash: string
  authority?: 'user_input' | 'enterprise_source'
}) => {
  const mediaKind = geminiMediaKindForMime(input.mimeType)
  if (!mediaKind) throw new Error('Unsupported Gemini media MIME type.')
  const hash = String(input.contentHash || '').trim().toLocaleLowerCase('en-US')
  if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error('Invalid media content hash.')
  const name = String(input.name || 'media-input').trim().slice(0, 240) || 'media-input'
  return {
    sourceId: `media:${hash}`,
    sourceName: name,
    canonicalKey: `media:${hash}`,
    objectType: 'media',
    title: name,
    sourceType: 'media' as const,
    mediaKind,
    mimeType: input.mimeType,
    contentHash: hash,
    authority: input.authority || 'user_input',
    previewable: true,
  }
}
