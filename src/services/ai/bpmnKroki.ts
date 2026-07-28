const REQUIRED_BPMN_MARKERS = [
  '<bpmn:definitions',
  '<bpmn:process',
  '<bpmndi:BPMNDiagram',
  '<bpmndi:BPMNPlane',
  '<dc:Bounds',
  '<di:waypoint',
  '</bpmn:definitions>',
];

export function extractRenderableBpmnXml(value = ''): string | null {
  const match = value.match(/<\?xml[\s\S]*?<\/bpmn:definitions>/i)
    || value.match(/<bpmn:definitions[\s\S]*?<\/bpmn:definitions>/i);
  if (!match) return null;
  const xml = match[0].trim();
  return REQUIRED_BPMN_MARKERS.every(marker => xml.includes(marker)) ? xml : null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function createKrokiBpmnMarkdownLink(xml: string): Promise<string | null> {
  if (!extractRenderableBpmnXml(xml) || typeof CompressionStream === 'undefined') return null;
  const compressedStream = new Blob([new TextEncoder().encode(xml)])
    .stream()
    .pipeThrough(new CompressionStream('deflate'));
  const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer());
  const encoded = bytesToBase64Url(compressed);
  return `[BPMN Diyagramı](https://kroki.io/bpmn/svg/${encoded})`;
}

export function removeKrokiLinks(value = ''): string {
  return value
    .replace(/\[BPMN Diyagramı\]\(https:\/\/kroki\.io\/[^)\s]+\)/gi, '')
    .replace(/https:\/\/kroki\.io\/\S+/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
