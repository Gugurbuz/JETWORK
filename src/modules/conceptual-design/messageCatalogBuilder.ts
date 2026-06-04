import type { CommonUiRules, ProcessModel, UiMessage, UiMessageType } from './conceptualDesignTypes';

interface MessageTemplateInput {
  id: string;
  screen: string;
  trigger: string;
  type: UiMessageType;
  title?: string;
  message: string;
  userAction?: string;
  blocking?: boolean;
  relatedRequirementIds?: string[];
}

function createMessage(input: MessageTemplateInput): UiMessage {
  return {
    id: input.id,
    screen: input.screen,
    trigger: input.trigger,
    type: input.type,
    title: input.title,
    message: input.message,
    userAction: input.userAction,
    blocking: input.blocking ?? false,
    relatedRequirementIds: input.relatedRequirementIds || [],
  };
}

function processScreenName(process: ProcessModel): string {
  return process.screenshots?.[0]?.title || `${process.title} Ekranı`;
}

function primaryRequirementIds(process: ProcessModel): string[] {
  return process.businessRequirements?.slice(0, 3).map(requirement => requirement.id) || [];
}

export function buildDefaultProcessMessages(process: ProcessModel): UiMessage[] {
  const screen = processScreenName(process);
  const requirementIds = primaryRequirementIds(process);

  return [
    createMessage({
      id: `${process.id}-toast-success`,
      screen,
      trigger: 'Kayıt veya süreç aksiyonu başarıyla tamamlandığında',
      type: 'success',
      title: 'İşlem başarılı',
      message: `${process.title} kapsamında yapılan işlem başarıyla tamamlandı.`,
      userAction: 'Detayı görüntüle',
      relatedRequirementIds: requirementIds,
    }),
    createMessage({
      id: `${process.id}-toast-error`,
      screen,
      trigger: 'Kayıt veya süreç aksiyonu teknik hata nedeniyle tamamlanamadığında',
      type: 'error',
      title: 'İşlem tamamlanamadı',
      message: `${process.title} işlemi tamamlanamadı. Lütfen bilgileri kontrol edip tekrar deneyin.`,
      userAction: 'Tekrar dene',
      blocking: true,
      relatedRequirementIds: requirementIds,
    }),
    createMessage({
      id: `${process.id}-validation-required`,
      screen,
      trigger: 'Zorunlu alan boş bırakıldığında',
      type: 'inline-validation',
      message: 'Bu alan zorunludur.',
      blocking: true,
      relatedRequirementIds: requirementIds,
    }),
    createMessage({
      id: `${process.id}-modal-complete-confirm`,
      screen,
      trigger: 'Kullanıcı süreci tamamlamak istediğinde',
      type: 'modal',
      title: 'Süreç tamamlanacak',
      message: 'Bu işlem öncesinde zorunlu görev, doküman ve iş kuralı kontrolleri çalıştırılır.',
      userAction: 'Tamamla',
      blocking: false,
      relatedRequirementIds: requirementIds,
    }),
    createMessage({
      id: `${process.id}-banner-missing-document`,
      screen,
      trigger: 'Süreçte eksik zorunlu doküman bulunduğunda',
      type: 'banner',
      title: 'Eksik zorunlu doküman var',
      message: 'Bu süreçte tamamlanması gereken zorunlu dokümanlar bulunmaktadır.',
      userAction: 'Dokümanları görüntüle',
      blocking: true,
      relatedRequirementIds: requirementIds,
    }),
  ];
}

export function enrichProcessMessages(process: ProcessModel): ProcessModel {
  const existingIds = new Set((process.uiMessages || []).map(message => message.id));
  const defaults = buildDefaultProcessMessages(process).filter(message => !existingIds.has(message.id));

  return {
    ...process,
    uiMessages: [...(process.uiMessages || []), ...defaults],
  };
}

export function enrichProcessesWithMessages(processModels: ProcessModel[]): ProcessModel[] {
  return processModels.map(enrichProcessMessages);
}

export function buildCommonUiRules(processModels: ProcessModel[]): CommonUiRules {
  const processMessages = processModels.flatMap(process => process.uiMessages || []);

  const validationRules = processMessages.filter(message => message.type === 'inline-validation');
  const toastRules = processMessages.filter(message => ['success', 'error', 'warning', 'info'].includes(message.type));
  const modalRules = processMessages.filter(message => message.type === 'modal');
  const emptyStateRules = [
    createMessage({
      id: 'common-empty-state-no-records',
      screen: 'Tüm Liste Ekranları',
      trigger: 'Filtre sonucunda kayıt bulunmadığında',
      type: 'info',
      title: 'Kayıt bulunamadı',
      message: 'Arama veya filtre kriterlerine uygun kayıt bulunamadı.',
      userAction: 'Filtreleri temizle',
    }),
  ];

  return {
    designPrinciples: [
      'Kullanıcı mesajları kısa, anlaşılır ve aksiyon odaklı olmalıdır.',
      'Bloklayıcı hatalar toast yerine modal, banner veya inline validasyon ile desteklenmelidir.',
      'Başarılı işlemler sağ üst toast ile kısa süreli gösterilmelidir.',
      'Teknik hata mesajları kullanıcıya sade gösterilmeli, detay audit/log kaydında tutulmalıdır.',
    ],
    validationRules,
    toastRules,
    modalRules,
    emptyStateRules,
  };
}
