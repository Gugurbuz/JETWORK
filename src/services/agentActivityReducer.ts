import type { AgentWorkEvent, AgentWorkEventState } from './agentWorkTypes';

const ACTIVITY_PREFIX = /^(?:[•*\-–—]|\d+[.)])\s*/u;
const MARKDOWN_DECORATION = /[*#`_]/gu;
const LOW_VALUE_ACTIVITY = /^çalışılıyor\.{0,3}$/iu;
const WARNING_ACTIVITY = /(?:bulunamad|başarısız|kullanılamadı|yetersiz|erişilemedi|hata|engellendi)/iu;

export const normalizeAgentActivityLabel = (value: string): string => value
  .trim()
  .replace(ACTIVITY_PREFIX, '')
  .replace(MARKDOWN_DECORATION, '')
  .replace(/\s+/gu, ' ')
  .trim();

export function formatAgentActivityLabel(value: string, completed = false): string {
  const normalized = normalizeAgentActivityLabel(value);
  if (!normalized) return '';
  if (/^asistana bağlanılıyor/iu.test(normalized)) return completed ? 'Talep işleme alındı' : 'Asistana bağlanılıyor...';
  if (/^talep işleme alındı$/iu.test(normalized)) return 'Talep işleme alındı';
  if (/^talep bağlamı çıkarılıyor/iu.test(normalized)) return completed ? 'Soru ve konuşma bağlamı hazırlandı' : 'Soru ve konuşma bağlamını hazırlıyorum...';
  if (/^advisory bağlam hazırlanıyor/iu.test(normalized)) return completed ? 'İlgili proje bağlamı hazırlandı' : 'İlgili proje bağlamını topluyorum...';
  if (/^semantic capability adayları çıkarılıyor/iu.test(normalized)) return completed ? 'Uygun kaynak ve araçlar değerlendirildi' : 'Uygun kaynak ve araçları değerlendiriyorum...';
  if (/^controller hazır:/iu.test(normalized)) return completed ? 'Çalışma araçları hazırlandı' : 'Çalışma araçlarını hazırlıyorum...';
  if (/^controller ilk aksiyonu değerlendiriyor/iu.test(normalized)) return completed ? 'İlk inceleme adımı seçildi' : 'İlk inceleme adımını seçiyorum...';
  if (/^controller ek capability\/kanıt çağrısı yapıyor/iu.test(normalized)) return completed ? 'Bulduğum bilgi ek kaynaklarla doğrulandı' : 'Bulduğum bilgiyi ek kaynaklarla doğruluyorum...';
  if (/^controller ilgili jetwork skill prosedürlerini yüklüyor/iu.test(normalized)) return completed ? 'Gerekli çalışma yöntemi hazırlandı' : 'Gerekli çalışma yöntemini hazırlıyorum...';
  if (/^controller ek semantic capability adayları istiyor/iu.test(normalized)) return completed ? 'Ek çalışma seçenekleri değerlendirildi' : 'Ek çalışma seçeneklerini değerlendiriyorum...';
  if (/^konuşma bağlamı ve çalışma yolu hazırlanıyor/iu.test(normalized)) return completed ? 'Konuşma bağlamı ve çalışma yolu hazırlandı' : 'Konuşma bağlamı ve çalışma yolu hazırlanıyor...';
  if (/^çalışma yolu belirlendi; reasoning akışı başlatıldı/iu.test(normalized)) return completed ? 'Çalışma yolu belirlendi · inceleme başlatıldı' : 'İnceleme başlatılıyor...';
  if (/^talep sınıflandırıldı/iu.test(normalized)) return normalized.replace(/^talep sınıflandırıldı/iu, 'Talep türü değerlendirildi');
  if (/^araştırma ve doğrulama planı oluşturuluyor/iu.test(normalized)) return completed ? 'Araştırma ve doğrulama planı oluşturuldu' : 'Araştırma ve doğrulama planı oluşturuluyor...';
  const planReadyMatch = normalized.match(/^plan hazır(?::\s*(.+))?\.?$/iu);
  if (planReadyMatch) {
    const detail = planReadyMatch[1]?.trim();
    return completed ? `Plan oluşturuldu${detail ? ` · ${detail}` : ''}` : `Plan oluşturuluyor${detail ? ` · ${detail}` : '...'}`;
  }
  if (/^ilgili jetwork skill prosedürleri yükleniyor/iu.test(normalized)) return completed ? 'Gerekli JetWork yetenekleri hazırlandı' : 'Gerekli JetWork yetenekleri hazırlanıyor...';
  if (/^kanıt yeterliliği ve çelişkiler kontrol ediliyor/iu.test(normalized)) return completed ? 'Kaynakların yeterliliği ve tutarlılığı kontrol edildi' : 'Kaynakların yeterliliği ve tutarlılığı kontrol ediliyor...';
  if (/^sentez sırasında ek teknik kanıt isteniyor/iu.test(normalized)) return completed ? 'Ek teknik kaynak incelendi' : 'Bilgi bankasında ek teknik kaynak aranıyor...';
  if (/^kanıtlar ve doğrulama sonucu sentezleniyor/iu.test(normalized)) return completed ? 'Yanıt için bilgiler birleştirildi' : 'Yanıt için bilgiler birleştiriliyor...';
  if (/^yanıt hazırlandı/iu.test(normalized)) return completed ? 'Yanıt oluşturuldu' : 'Yanıt oluşturuluyor...';
  if (!completed) return normalized;
  return normalized
    .replace(/inceleniyor/giu, 'incelendi')
    .replace(/taranıyor/giu, 'tarandı')
    .replace(/aranıyor/giu, 'incelendi')
    .replace(/karşılaştırılıyor/giu, 'karşılaştırıldı')
    .replace(/doğrulanıyor/giu, 'doğrulandı')
    .replace(/seçiliyor/giu, 'seçildi')
    .replace(/hazırlanıyor/giu, 'hazırlandı')
    .replace(/oluşturuluyor/giu, 'oluşturuldu')
    .replace(/toplanıyor/giu, 'toplandı');
}

export function classifyAgentWorkEvent(rawValue: string, label = rawValue): Pick<AgentWorkEvent, 'kind' | 'tool' | 'sourceType'> {
  const text = `${normalizeAgentActivityLabel(rawValue)} ${normalizeAgentActivityLabel(label)}`;
  if (/\bgithub\b/iu.test(text)) return { kind: 'tool', tool: 'GitHub', sourceType: 'github' };
  if (/\bvercel\b/iu.test(text)) return { kind: 'tool', tool: 'Vercel', sourceType: 'vercel' };
  if (/\d+\s+kurumsal kaynak|kurumsal kaynak bulundu|kurumsal kaynak kullanıldı/iu.test(text)) return { kind: 'source', tool: 'Bilgi Bankası', sourceType: 'knowledge' };
  if (/\d+\s+web kaynağı|web kaynağı bulundu|web kaynağı kullanıldı/iu.test(text)) return { kind: 'source', tool: 'Web', sourceType: 'web' };
  if (/bilgi bankası|kurumsal bilgi|knowledge|canonicalkey/iu.test(text)) return { kind: 'tool', tool: 'Bilgi Bankası', sourceType: 'knowledge' };
  if (/\bweb\b|internet|google grounding|google search/iu.test(text)) return { kind: 'tool', tool: 'Web', sourceType: 'web' };
  if (/artifact|doküman|dosya çıkt|word|excel|powerpoint|spreadsheet/iu.test(text)) return { kind: 'artifact', tool: 'Dosya', sourceType: 'artifact' };
  if (WARNING_ACTIVITY.test(text)) return { kind: 'warning', sourceType: 'runtime' };
  if (/yanıt oluşturuldu|yanıt hazırlandı/iu.test(text)) return { kind: 'final', sourceType: 'runtime' };
  return { kind: 'agent', sourceType: 'runtime' };
}

export function reduceAgentActivityEvents(current: AgentWorkEvent[], incoming: AgentWorkEvent): AgentWorkEvent[] {
  const index = current.findIndex(event => event.eventId === incoming.eventId);
  const next = [...current];
  if (index >= 0) {
    const previous = current[index];
    next[index] = { ...previous, ...incoming, sequence: previous.sequence, startedAt: previous.startedAt || incoming.startedAt };
  } else {
    next.push(incoming);
  }
  return next.sort((a, b) => a.sequence - b.sequence);
}

export function completeActiveAgentEvents(events: AgentWorkEvent[], completedAt = new Date().toISOString()): AgentWorkEvent[] {
  return events.map(event => event.state === 'active'
    ? { ...event, label: formatAgentActivityLabel(event.rawLabel || event.label, true), state: 'completed' as const, completedAt: event.completedAt || completedAt }
    : event);
}

export function failActiveAgentEvents(events: AgentWorkEvent[], completedAt = new Date().toISOString()): AgentWorkEvent[] {
  return events.map(event => event.state === 'active'
    ? { ...event, state: 'failed' as const, completedAt: event.completedAt || completedAt }
    : event);
}

export function diffRollingActivitySnapshot(previous: string[], incoming: string[]): string[] {
  const before = previous.map(normalizeAgentActivityLabel).filter(Boolean);
  const after = incoming.map(normalizeAgentActivityLabel).filter(Boolean);
  for (let overlap = Math.min(before.length, after.length); overlap >= 0; overlap -= 1) {
    const tail = before.slice(before.length - overlap);
    const head = after.slice(0, overlap);
    if (tail.length === head.length && tail.every((value, index) => value === head[index])) return after.slice(overlap);
  }
  return after;
}

export function createObservedAgentWorkEvent(input: { rawLabel: string; sequence: number; active?: boolean; now?: string }): AgentWorkEvent | null {
  const rawLabel = normalizeAgentActivityLabel(input.rawLabel);
  if (!rawLabel || LOW_VALUE_ACTIVITY.test(rawLabel)) return null;
  const state: AgentWorkEventState = WARNING_ACTIVITY.test(rawLabel) ? 'warning' : input.active ? 'active' : 'completed';
  const label = formatAgentActivityLabel(rawLabel, state !== 'active');
  const timestamp = input.now || new Date().toISOString();
  return {
    eventId: `observed:${input.sequence}`,
    sequence: input.sequence,
    ...classifyAgentWorkEvent(rawLabel, label),
    label,
    rawLabel,
    state,
    startedAt: timestamp,
    completedAt: state === 'active' ? undefined : timestamp,
  };
}

export function sourceCountAgentWorkEvent(input: { sequence: number; sourceType: 'knowledge' | 'web'; count: number; now?: string }): AgentWorkEvent {
  const timestamp = input.now || new Date().toISOString();
  const knowledge = input.sourceType === 'knowledge';
  return {
    eventId: `source:${input.sourceType}:${input.count}:${input.sequence}`,
    sequence: input.sequence,
    kind: 'source',
    label: knowledge ? `${input.count} kurumsal kaynak bulundu` : `${input.count} web kaynağı bulundu`,
    tool: knowledge ? 'Bilgi Bankası' : 'Web',
    sourceType: input.sourceType,
    state: 'completed',
    startedAt: timestamp,
    completedAt: timestamp,
  };
}

export function splitAgentWorkTimeline(events: AgentWorkEvent[], maxVisible = 8): { hidden: AgentWorkEvent[]; visible: AgentWorkEvent[] } {
  if (events.length <= maxVisible) return { hidden: [], visible: events };
  const tail = events.slice(-maxVisible);
  const active = events.filter(event => event.state === 'active');
  const visibleIds = new Set([...tail, ...active].map(event => event.eventId));
  return { hidden: events.filter(event => !visibleIds.has(event.eventId)), visible: events.filter(event => visibleIds.has(event.eventId)) };
}
