import type { MessageAttachment } from '../types';

export type ArtifactRuntimeState =
  | 'requested'
  | 'researching'
  | 'drafting'
  | 'validating'
  | 'executing'
  | 'verifying'
  | 'persisted'
  | 'completed'
  | 'executor_failed'
  | 'verification_failed'
  | 'persistence_failed';

export interface ArtifactAttachmentMeta {
  artifactId?: string;
  artifactVersion?: number;
  artifactType?: string;
  artifactState?: ArtifactRuntimeState;
  byteSize?: number;
  sha256?: string;
  createdAt?: string;
  supersedesVersion?: number;
}

export type ArtifactAwareAttachment = MessageAttachment & ArtifactAttachmentMeta;

export const artifactAttachmentMeta = (file: MessageAttachment): ArtifactAttachmentMeta => {
  const value = file as ArtifactAwareAttachment;
  return {
    artifactId: value.artifactId,
    artifactVersion: Number.isFinite(Number(value.artifactVersion)) ? Number(value.artifactVersion) : undefined,
    artifactType: value.artifactType,
    artifactState: value.artifactState,
    byteSize: Number.isFinite(Number(value.byteSize)) ? Number(value.byteSize) : undefined,
    sha256: value.sha256,
    createdAt: value.createdAt,
    supersedesVersion: Number.isFinite(Number(value.supersedesVersion)) ? Number(value.supersedesVersion) : undefined,
  };
};

export const artifactStateLabel = (state?: ArtifactRuntimeState | null): string => {
  switch (state) {
    case 'requested': return 'Talep alındı';
    case 'researching': return 'Araştırılıyor';
    case 'drafting': return 'Hazırlanıyor';
    case 'validating': return 'Doğrulanıyor';
    case 'executing': return 'Dosya oluşturuluyor';
    case 'verifying': return 'Kontrol ediliyor';
    case 'persisted': return 'Kaydediliyor';
    case 'completed': return 'Hazır';
    case 'executor_failed': return 'Oluşturulamadı';
    case 'verification_failed': return 'Kontrol başarısız';
    case 'persistence_failed': return 'Kaydedilemedi';
    default: return '';
  }
};

export const artifactStateIsFailure = (state?: ArtifactRuntimeState | null) => (
  state === 'executor_failed' || state === 'verification_failed' || state === 'persistence_failed'
);
