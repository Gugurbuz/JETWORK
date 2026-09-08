import { describe, expect, it } from 'vitest';
import { isKnowledgeFile } from '../knowledgeCatalogRepository';

describe('Jetbase file type contract', () => {
  it.each([
    ['diagram.png', 'image/png'],
    ['screen.jpg', 'image/jpeg'],
    ['scan.webp', 'image/webp'],
    ['report.pdf', 'application/pdf'],
    ['analysis.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['metrics.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['notes.txt', 'text/plain'],
    ['readme.md', 'text/markdown'],
  ])('accepts %s', (name, mimeType) => {
    expect(isKnowledgeFile({ name, mimeType })).toBe(true);
  });

  it('accepts browser octet-stream when the extension is a Jetbase type', () => {
    expect(isKnowledgeFile({ name: 'photo.heic', mimeType: 'application/octet-stream' })).toBe(true);
  });

  it('rejects unsupported executable files', () => {
    expect(isKnowledgeFile({ name: 'payload.exe', mimeType: 'application/octet-stream' })).toBe(false);
  });
});
