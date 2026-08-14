import { describe, expect, it } from 'vitest'
import {
  dedupeAssistantWorkActivities,
  formatAssistantWorkActivityLabel,
} from '../AssistantWorkIndicator'

describe('assistant work timeline dedupe', () => {
  it('removes labels that become duplicates after end-user formatting', () => {
    const formatted = [
      { label: formatAssistantWorkActivityLabel('Asistana bağlanılıyor...', true), state: 'completed' as const },
      { label: formatAssistantWorkActivityLabel('Talep işleme alındı', true), state: 'completed' as const },
      { label: formatAssistantWorkActivityLabel('Talep sınıflandırıldı: Analiz · Yüksek', true), state: 'completed' as const },
    ]

    expect(dedupeAssistantWorkActivities(formatted).map(item => item.label)).toEqual([
      'Talep işleme alındı',
      'Talep türü değerlendirildi: Analiz · Yüksek',
    ])
  })
})
