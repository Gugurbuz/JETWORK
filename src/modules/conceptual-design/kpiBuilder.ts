import type { KpiDefinition, ProcessModel } from './conceptualDesignTypes';

function hasKpi(process: ProcessModel, id: string): boolean {
  return (process.kpis || []).some(kpi => kpi.id === id);
}

export function buildDefaultKpisForProcess(process: ProcessModel): KpiDefinition[] {
  const processId = process.id;
  return [
    {
      id: `${processId}-kpi-progress`,
      name: `${process.title} ilerleme oranı`,
      description: 'Süreç kapsamındaki tamamlanan adım, görev ve doküman ağırlıklarının toplam ilerlemeye oranını gösterir.',
      formula: 'Tamamlanan ağırlık / Toplam ağırlık * 100',
      unit: '%',
      target: '%100',
      dataSource: 'JetPS süreç, adım, görev ve doküman kayıtları',
      relatedProcessIds: [processId],
    },
    {
      id: `${processId}-kpi-open-task`,
      name: `${process.title} açık görev sayısı`,
      description: 'Süreç kapsamında tamamlanmamış görev sayısını gösterir.',
      formula: 'Durumu tamamlandı olmayan görev sayısı',
      unit: 'adet',
      target: '0',
      dataSource: 'JetPS görev kayıtları',
      relatedProcessIds: [processId],
    },
    {
      id: `${processId}-kpi-missing-document`,
      name: `${process.title} eksik doküman sayısı`,
      description: 'Süreç kapsamında zorunlu olup yüklenmemiş doküman sayısını gösterir.',
      formula: 'Zorunlu doküman sayısı - yüklenen zorunlu doküman sayısı',
      unit: 'adet',
      target: '0',
      dataSource: 'JetPS doküman kayıtları / FileNet aktarım durumu',
      relatedProcessIds: [processId],
    },
    {
      id: `${processId}-kpi-delay`,
      name: `${process.title} gecikme göstergesi`,
      description: 'Hedef tarihi geçmiş ve tamamlanmamış süreç kayıtlarını gösterir.',
      formula: 'Bugün > hedef tarih ve süreç durumu tamamlandı değil',
      unit: 'adet',
      target: '0',
      dataSource: 'JetPS süreç tarihleri',
      relatedProcessIds: [processId],
    },
  ];
}

export function enrichProcessKpis(process: ProcessModel): ProcessModel {
  const defaults = buildDefaultKpisForProcess(process).filter(kpi => !hasKpi(process, kpi.id));
  return {
    ...process,
    kpis: [...(process.kpis || []), ...defaults],
  };
}

export function enrichProcessesWithKpis(processModels: ProcessModel[]): ProcessModel[] {
  return processModels.map(enrichProcessKpis);
}
