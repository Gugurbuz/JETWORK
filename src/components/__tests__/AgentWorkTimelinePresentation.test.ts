import { describe, expect, it } from 'vitest';
import { compactAgentWorkTimelinePresentation } from '../AgentWorkTimeline';
import type { AgentWorkEvent } from '../../services/agentWorkTypes';

const event = (input: Partial<AgentWorkEvent> & Pick<AgentWorkEvent, 'eventId' | 'sequence' | 'kind' | 'label'>): AgentWorkEvent => ({
  state: 'completed',
  sourceType: 'runtime',
  ...input,
});

describe('AgentWorkTimeline presentation compaction', () => {
  it('keeps semantic controller updates while collapsing repeated generic knowledge rows', () => {
    const events: AgentWorkEvent[] = [
      event({ eventId: 'agent:1', sequence: 1, kind: 'agent', label: 'Hedefi netleştirdim: teklif içindeki yeşil enerji kontrolünü ve teknik etkisini araştırıyorum.' }),
      event({ eventId: 'tool:2', sequence: 2, kind: 'tool', sourceType: 'knowledge', tool: 'Bilgi Bankası', label: 'Bilgi bankası sorgusu tamamlandı' }),
      event({ eventId: 'source:3', sequence: 3, kind: 'source', sourceType: 'knowledge', tool: 'Bilgi Bankası', label: '1 kurumsal kaynak bulundu' }),
      event({ eventId: 'tool:4', sequence: 4, kind: 'tool', sourceType: 'knowledge', tool: 'Bilgi Bankası', label: 'Bilgi bankası sorgusu tamamlandı' }),
      event({ eventId: 'source:5', sequence: 5, kind: 'source', sourceType: 'knowledge', tool: 'Bilgi Bankası', label: '21 kurumsal kaynak bulundu' }),
      event({ eventId: 'tool:6', sequence: 6, kind: 'tool', sourceType: 'knowledge', tool: 'Bilgi Bankası', label: 'Bilgi bankası sorgusu tamamlandı' }),
      event({ eventId: 'source:7', sequence: 7, kind: 'source', sourceType: 'knowledge', tool: 'Bilgi Bankası', label: '46 kurumsal kaynak bulundu' }),
      event({ eventId: 'agent:8', sequence: 8, kind: 'agent', label: 'ZCRM2-356 kontrolü doğruluyor; implementasyon için teklif save sınıfına geçiyorum.' }),
    ];

    const compacted = compactAgentWorkTimelinePresentation(events);

    expect(compacted.map(item => item.label)).toEqual([
      'Hedefi netleştirdim: teklif içindeki yeşil enerji kontrolünü ve teknik etkisini araştırıyorum.',
      '3 bilgi bankası işlemi tamamlandı',
      'ZCRM2-356 kontrolü doğruluyor; implementasyon için teklif save sınıfına geçiyorum.',
    ]);
    expect(compacted.some(item => /46 kurumsal kaynak/iu.test(item.label))).toBe(false);
  });

  it('does not collapse exact/non-generic tool details or semantic findings', () => {
    const events: AgentWorkEvent[] = [
      event({ eventId: 'agent:1', sequence: 1, kind: 'agent', label: 'İlgili kontrolü buldum.' }),
      event({ eventId: 'tool:2', sequence: 2, kind: 'tool', sourceType: 'knowledge', tool: 'Bilgi Bankası', label: 'ZCL_ORDER_SAVE_QUOTATIONS kaynak kodu incelendi' }),
      event({ eventId: 'agent:3', sequence: 3, kind: 'agent', label: 'Exact method bulunmadı; class source üzerinden devam ediyorum.' }),
    ];

    expect(compactAgentWorkTimelinePresentation(events).map(item => item.label)).toEqual(events.map(item => item.label));
  });
});