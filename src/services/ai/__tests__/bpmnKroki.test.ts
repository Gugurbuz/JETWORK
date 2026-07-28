import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  createKrokiBpmnMarkdownLink,
  extractRenderableBpmnXml,
  removeKrokiLinks,
} from '../bpmnKroki';
import { ENERJISA_BPMN_XML_TEMPLATE } from '../enerjisaBaInstructions';

describe('BPMN Kroki output contract', () => {
  it('accepts only BPMN XML that includes diagram coordinates', () => {
    expect(extractRenderableBpmnXml(ENERJISA_BPMN_XML_TEMPLATE)).toBe(ENERJISA_BPMN_XML_TEMPLATE);
    expect(extractRenderableBpmnXml('<bpmn:definitions></bpmn:definitions>')).toBeNull();
  });

  it('creates a single markdown link whose payload decodes to the XML', async () => {
    const link = await createKrokiBpmnMarkdownLink(ENERJISA_BPMN_XML_TEMPLATE);
    expect(link).toMatch(/^\[BPMN Diyagramı\]\(https:\/\/kroki\.io\/bpmn\/svg\/[^)]+\)$/);
    const encoded = link!.match(/\/svg\/([^)]+)/)![1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const decoded = inflateSync(Buffer.from(padded, 'base64')).toString('utf8');
    expect(decoded).toBe(ENERJISA_BPMN_XML_TEMPLATE);
  });

  it('removes generated and bare Kroki URLs before the final link is appended', () => {
    const cleaned = removeKrokiLinks(
      'Hazır.\nhttps://kroki.io/bpmn/svg/old\n[BPMN Diyagramı](https://kroki.io/bpmn/svg/old)',
    );
    expect(cleaned).toBe('Hazır.');
  });
});
