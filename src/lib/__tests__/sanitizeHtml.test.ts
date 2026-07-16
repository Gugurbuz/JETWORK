import { describe, expect, it } from 'vitest';
import { sanitizeDocumentHtml } from '../sanitizeHtml';

describe('sanitizeDocumentHtml', () => {
  it('removes scripts, event handlers, inline styles and javascript URLs', () => {
    const result = sanitizeDocumentHtml(`
      <h1 onclick="window.__xss = true" style="color:red">Baslik</h1>
      <script>window.__xss = true</script>
      <a href="javascript:alert(1)">Tikla</a>
      <img src="x" onerror="window.__xss = true">
    `);

    expect(result).toContain('<h1>Baslik</h1>');
    expect(result).not.toMatch(/script|onclick|onerror|style=|javascript:/i);
  });

  it('preserves safe document structure', () => {
    const result = sanitizeDocumentHtml('<h2>Surec</h2><table><tr><td>Deger</td></tr></table>');

    expect(result).toContain('<h2>Surec</h2>');
    expect(result).toContain('<table>');
    expect(result).toContain('<td>Deger</td>');
  });
});
