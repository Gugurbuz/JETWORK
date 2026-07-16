import DOMPurify from 'dompurify';

const FORBIDDEN_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'meta',
  'link',
];

function sanitizeWithoutDom(value: string): string {
  return value
    .replace(/<(script|style|iframe|object|embed|form|button|textarea|select|meta|link)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(input|option)\b[^>]*\/?\s*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '');
}

export function sanitizeDocumentHtml(value = ''): string {
  if (!value) return '';
  if (typeof window === 'undefined') return sanitizeWithoutDom(value);

  return DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false,
  });
}
