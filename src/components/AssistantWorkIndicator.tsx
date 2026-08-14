import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Database,
  Globe2,
  Link2,
  LoaderCircle,
  Search,
  Square,
} from 'lucide-react';
import type { AssistantKnowledgeSource } from '../types';
import { cn } from '../lib/utils';
import { JetWorkLogo } from './JetWorkLogo';
import { splitAssistantSources } from '../services/assistantSources';

const ACTIVITY_PREFIX = /^(?:[•*\-–—]|\d+[.)])\s*/u;
const MARKDOWN_DECORATION = /[*#`_]/gu;
const WARNING_ACTIVITY = /(?:bulunamad|başarısız|kullanılamadı|yetersiz|erişilemedi|hata)/iu;
const SOURCE_GAP_ACTIVITY = /(?:kaynak|bilgi bankası|web).*(?:bulunamad|yetersiz|kullanılamadı|erişilemedi)|(?:bulunamad|yetersiz|kullanılamadı|erişilemedi).*(?:kaynak|bilgi bankası|web)/iu;
const LOW_VALUE_ACTIVITY = /^çalışılıyor\.{0,3}$/iu;
const CONNECTION_ACTIVITY = /^asistana bağlanılıyor\.{0,3}$/iu;

export interface AssistantWorkActivity {
  label: string;
  state: 'active' | 'completed' | 'warning';
}

interface AssistantWorkIndicatorProps {
  isActive: boolean;
  startedAt?: number;
  completedSeconds?: number;
  activityText?: string;
  phaseLabel?: string;
  knowledgeSources?: AssistantKnowledgeSource[];
  groundingUrls?: { uri: string; title: string }[];
  isStopped?: boolean;
  onStop?: () => void;
  onFollowUp?: (prompt: string) => void;
  followUpDisabled?: boolean;
}

const normalizeActivity = (value: string): string => value
  .trim()
  .replace(ACTIVITY_PREFIX, '')
  .replace(MARKDOWN_DECORATION, '')
  .trim();

const appendUnique = (target: string[], value: string | undefined) => {
  const normalized = normalizeActivity(value || '');
  if (!normalized || LOW_VALUE_ACTIVITY.test(normalized)) return;
  const key = normalized.toLocaleLowerCase('tr-TR');
  if (target.some(item => item.toLocaleLowerCase('tr-TR') === key)) return;
  target.push(normalized);
};

export function formatAssistantWorkActivityLabel(value: string, completed = false): string {
  const normalized = normalizeActivity(value);
  if (!normalized) return '';

  if (/^asistana bağlanılıyor/iu.test(normalized)) {
    return completed ? 'Talep işleme alındı' : 'Talebin kapsamı değerlendiriliyor...';
  }

  if (/^talep sınıflandırıldı/iu.test(normalized)) {
    return normalized.replace(/^talep sınıflandırıldı/iu, 'Talep türü değerlendirildi');
  }

  if (/^araştırma ve doğrulama planı oluşturuluyor/iu.test(normalized)) {
    return completed
      ? 'Çalışma yaklaşımı belirlendi'
      : 'Çalışma yaklaşımı hazırlanıyor...';
  }

  const planReadyMatch = normalized.match(/^plan hazır(?::\s*(.+))?\.?$/iu);
  if (planReadyMatch) {
    return completed ? 'Çalışma yolu belirlendi' : 'Çalışma yolu belirleniyor...';
  }

  if (/^kanıt yeterliliği ve çelişkiler kontrol ediliyor/iu.test(normalized)) {
    return completed
      ? 'Kaynakların yeterliliği ve tutarlılığı kontrol edildi'
      : 'Kaynakların yeterliliği ve tutarlılığı kontrol ediliyor...';
  }

  if (/^sentez sırasında ek teknik kanıt isteniyor/iu.test(normalized)) {
    return completed
      ? 'Ek teknik kaynak arandı'
      : 'Bilgi bankasında ek teknik kaynak aranıyor...';
  }

  if (/^kanıtlar ve doğrulama sonucu sentezleniyor/iu.test(normalized)) {
    return completed
      ? 'Yanıt için bilgiler birleştirildi'
      : 'Yanıt için bilgiler birleştiriliyor...';
  }

  if (/^yanıt hazırlandı/iu.test(normalized)) {
    return completed ? 'Yanıt oluşturuldu' : 'Yanıt oluşturuluyor...';
  }

  if (!completed) return normalized;

  return normalized
    .replace(/inceleniyor/giu, 'incelendi')
    .replace(/aranıyor/giu, 'incelendi')
    .replace(/taranıyor/giu, 'tarandı')
    .replace(/karşılaştırılıyor/giu, 'karşılaştırıldı')
    .replace(/doğrulanıyor/giu, 'doğrulandı')
    .replace(/seçiliyor/giu, 'seçildi')
    .replace(/hazırlanıyor/giu, 'hazırlandı')
    .replace(/oluşturuluyor/giu, 'oluşturuldu');
}

export function buildAssistantWorkActivities(input: {
  isActive: boolean;
  activityText?: string;
  phaseLabel?: string;
  knowledgeSourceCount?: number;
  webSourceCount?: number;
}): AssistantWorkActivity[] {
  const labels: string[] = [];
  for (const line of (input.activityText || '').split(/\r?\n/u)) {
    appendUnique(labels, line);
  }
  appendUnique(labels, input.phaseLabel);

  const activeLabelKey = normalizeActivity(input.phaseLabel || labels.at(-1) || '').toLocaleLowerCase('tr-TR');

  return labels.map((label, index) => ({
    label,
    state: WARNING_ACTIVITY.test(label)
      ? 'warning'
      : input.isActive && (
          label.toLocaleLowerCase('tr-TR') === activeLabelKey
          || (!activeLabelKey && index === labels.length - 1)
        )
        ? 'active'
        : 'completed',
  }));
}

export function buildPendingRuntimeActivities(elapsedSeconds: number): AssistantWorkActivity[] {
  const elapsed = Math.max(0, Math.floor(elapsedSeconds));
  const steps = [
    { at: 0, label: 'Talep işleme alındı' },
    { at: 3, label: 'Konuşma bağlamı ve çalışma yolu hazırlanıyor...' },
    { at: 10, label: 'Talep için çalışma planı hazırlanıyor...' },
    { at: 20, label: 'Model yanıtı üzerinde çalışıyor...' },
    { at: 35, label: 'Yanıt üretimi devam ediyor...' },
  ];
  const visible = steps.filter(step => elapsed >= step.at);
  return visible.map((step, index) => ({
    label: step.label,
    state: index === visible.length - 1 ? 'active' as const : 'completed' as const,
  }));
}

const elapsedFrom = (startedAt?: number): number => {
  if (!startedAt || !Number.isFinite(startedAt)) return 0;
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
};

function useElapsedSeconds(isActive: boolean, startedAt?: number, completedSeconds?: number): number {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => (
    isActive ? elapsedFrom(startedAt) : Math.max(1, Math.round(completedSeconds || elapsedFrom(startedAt)))
  ));

  useEffect(() => {
    if (!isActive) {
      setElapsedSeconds(Math.max(1, Math.round(completedSeconds || elapsedFrom(startedAt))));
      return;
    }

    const updateElapsed = () => setElapsedSeconds(elapsedFrom(startedAt));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [completedSeconds, isActive, startedAt]);

  return elapsedSeconds;
}

export function formatAssistantWorkDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} sn`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes} dk ${remainder} sn` : `${minutes} dk`;
}

const mergeObservedActivities = (
  previous: AssistantWorkActivity[],
  incoming: AssistantWorkActivity[],
): AssistantWorkActivity[] => {
  const next: AssistantWorkActivity[] = previous.map(activity => ({
    ...activity,
    state: activity.state === 'warning' ? 'warning' as const : 'completed' as const,
  }));

  for (const activity of incoming) {
    const key = activity.label.toLocaleLowerCase('tr-TR');
    const existingIndex = next.findIndex(candidate => candidate.label.toLocaleLowerCase('tr-TR') === key);
    if (existingIndex >= 0) {
      next[existingIndex] = activity;
    } else {
      next.push(activity);
    }
  }

  return next.slice(-8);
};

export const selectCompletedActivityEvidence = (
  reported: AssistantWorkActivity[],
  observed: AssistantWorkActivity[],
): AssistantWorkActivity[] => (
  reported.length > 0 ? reported : observed
);

export const dedupeAssistantWorkActivities = (
  activities: AssistantWorkActivity[],
): AssistantWorkActivity[] => {
  const result: AssistantWorkActivity[] = [];
  const indexByLabel = new Map<string, number>();
  for (const activity of activities) {
    const key = normalizeActivity(activity.label).toLocaleLowerCase('tr-TR');
    if (!key) continue;
    const existingIndex = indexByLabel.get(key);
    if (existingIndex === undefined) {
      indexByLabel.set(key, result.length);
      result.push(activity);
    } else {
      result[existingIndex] = activity;
    }
  }
  return result;
};

const ActivityStateIcon = ({ state }: { state: AssistantWorkActivity['state'] }) => {
  if (state === 'warning') return <AlertTriangle aria-hidden="true" />;
  if (state === 'active') return <LoaderCircle aria-hidden="true" />;
  return <Check aria-hidden="true" />;
};

function useComposerStopTarget(isActive: boolean, onStop?: () => void): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive || !onStop || typeof document === 'undefined') {
      setTarget(null);
      return;
    }

    const sendButton = document.querySelector<HTMLButtonElement>('[data-testid="chat-send"]');
    const parent = sendButton?.parentElement;
    if (!sendButton || !parent) return;

    const previousDisplay = sendButton.style.display;
    const previousAriaHidden = sendButton.getAttribute('aria-hidden');
    sendButton.style.display = 'none';
    sendButton.setAttribute('aria-hidden', 'true');
    setTarget(parent);

    return () => {
      sendButton.style.display = previousDisplay;
      if (previousAriaHidden === null) sendButton.removeAttribute('aria-hidden');
      else sendButton.setAttribute('aria-hidden', previousAriaHidden);
      setTarget(null);
    };
  }, [isActive, onStop]);

  return target;
}

export function AssistantWorkIndicator({
  isActive,
  startedAt,
  completedSeconds,
  activityText,
  phaseLabel,
  knowledgeSources,
  groundingUrls,
  isStopped = false,
  onStop,
  onFollowUp,
  followUpDisabled = false,
}: AssistantWorkIndicatorProps) {
  const elapsedSeconds = useElapsedSeconds(isActive, startedAt, completedSeconds);
  const formattedDuration = formatAssistantWorkDuration(elapsedSeconds);
  const sourceView = useMemo(
    () => splitAssistantSources(knowledgeSources || [], groundingUrls || []),
    [groundingUrls, knowledgeSources],
  );
  const knowledgeSourceCount = sourceView.knowledgeSources.length;
  const webSourceCount = sourceView.groundingUrls.length;
  const reportedActivities = useMemo(() => buildAssistantWorkActivities({
    isActive,
    activityText,
    phaseLabel,
    knowledgeSourceCount,
    webSourceCount,
  }), [activityText, isActive, knowledgeSourceCount, phaseLabel, webSourceCount]);
  const [observedActivities, setObservedActivities] = useState<AssistantWorkActivity[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const composerStopTarget = useComposerStopTarget(isActive, onStop);

  useEffect(() => {
    if (!isActive || reportedActivities.length === 0) return;
    setObservedActivities(previous => mergeObservedActivities(previous, reportedActivities));
  }, [isActive, reportedActivities]);

  useEffect(() => {
    if (!isActive) setIsExpanded(false);
  }, [isActive]);

  const activityEvidence = mergeObservedActivities(observedActivities, reportedActivities);
  const hasRealRuntimeActivity = activityEvidence.some(activity => !CONNECTION_ACTIVITY.test(normalizeActivity(activity.label)));
  const liveActivities = isActive
    ? (hasRealRuntimeActivity ? activityEvidence : buildPendingRuntimeActivities(elapsedSeconds))
    : [];
  const formattedLiveActivities = dedupeAssistantWorkActivities(liveActivities.map(activity => ({
    ...activity,
    label: hasRealRuntimeActivity
      ? formatAssistantWorkActivityLabel(activity.label, activity.state !== 'active')
      : activity.label,
  })));
  const completedEvidence = selectCompletedActivityEvidence(reportedActivities, activityEvidence);
  const completedActivities = dedupeAssistantWorkActivities(completedEvidence.map(activity => ({
    ...activity,
    state: activity.state === 'warning' ? 'warning' as const : 'completed' as const,
    label: formatAssistantWorkActivityLabel(activity.label, true),
  })));
  const hasWorkDetails = completedActivities.length > 0;
  const hasSourceDetails = knowledgeSourceCount > 0 || webSourceCount > 0;
  const canShowDetails = hasWorkDetails || hasSourceDetails;
  const hasSourceGap = webSourceCount === 0
    && completedEvidence.some(activity => SOURCE_GAP_ACTIVITY.test(activity.label));

  const requestWebSearch = () => onFollowUp?.(
    'Bu soruyu web üzerinde de araştır. Güncel ve güvenilir web kaynaklarıyla bulguları doğrula ve kaynakları göster.',
  );
  const requestDeepResearch = () => onFollowUp?.(
    'Bu yanıtı daha derin araştır. Gerektiğinde bilgi bankasını ve web kaynaklarını kullan; bulguları kaynaklarla karşılaştırıp doğrula.',
  );

  const stopPortal = composerStopTarget && onStop
    ? createPortal(
        <button
          type="button"
          data-testid="chat-stop"
          aria-label="Yanıtı durdur"
          className="assistant-composer-stop"
          onClick={onStop}
        >
          <Square aria-hidden="true" />
        </button>,
        composerStopTarget,
      )
    : null;

  const completedSummaryContent = (
    <>
      <span
        data-testid="assistant-work-completed-logo"
        className="assistant-work__logo-stage"
        aria-hidden="true"
      >
        <JetWorkLogo className="assistant-work__logo" />
      </span>
      <span>{formattedDuration} çalıştı{isStopped ? ' · durduruldu' : ''}</span>
    </>
  );

  return (
    <>
      <section
        data-testid="assistant-work-indicator"
        className={cn('assistant-work', !isActive && 'assistant-work--completed')}
        aria-label={isActive
          ? `JetWork çalışıyor, ${elapsedSeconds} saniye`
          : isStopped
            ? `JetWork ${formattedDuration} çalıştı ve durduruldu`
            : `JetWork ${formattedDuration} çalıştı`}
      >
        {isActive ? (
          <>
            <div className="assistant-work__topline">
              <span className="assistant-work__logo-stage" aria-hidden="true">
                <span className="assistant-work__logo-motion">
                  <JetWorkLogo className="assistant-work__logo" />
                </span>
              </span>
              <span className="assistant-work__label">Düşünüyor</span>
              <span className="assistant-work__separator" aria-hidden="true">·</span>
              <time className="assistant-work__time">{formattedDuration}</time>
            </div>

            {formattedLiveActivities.length > 0 ? (
              <div
                className="assistant-work__details assistant-work__details--live"
                data-testid="assistant-work-live-details"
                aria-live="polite"
              >
                <ol className="assistant-work__activity-list">
                  {formattedLiveActivities.map((activity, index) => (
                    <li
                      key={`${activity.label}-${index}`}
                      className={cn('assistant-work__activity', `assistant-work__activity--${activity.state}`)}
                    >
                      <span className="assistant-work__activity-icon">
                        <ActivityStateIcon state={activity.state} />
                      </span>
                      <span>{activity.label}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
          </>
        ) : canShowDetails ? (
          <button
            type="button"
            className="assistant-work__summary"
            onClick={() => setIsExpanded(previous => !previous)}
            aria-expanded={isExpanded}
            aria-label="Çalışma ayrıntılarını göster"
          >
            {completedSummaryContent}
            <ChevronDown className={cn('assistant-work__chevron', isExpanded && 'assistant-work__chevron--open')} aria-hidden="true" />
          </button>
        ) : (
          <div className="assistant-work__summary assistant-work__summary--static">
            {completedSummaryContent}
          </div>
        )}

        {!isActive && isExpanded && canShowDetails ? (
          <div className="assistant-work__details" data-testid="assistant-work-details">
            {hasWorkDetails ? (
              <ol className="assistant-work__activity-list">
                {completedActivities.map(activity => (
                  <li
                    key={activity.label}
                    className={cn('assistant-work__activity', `assistant-work__activity--${activity.state}`)}
                  >
                    <span className="assistant-work__activity-icon">
                      <ActivityStateIcon state={activity.state} />
                    </span>
                    <span>{activity.label}</span>
                  </li>
                ))}
              </ol>
            ) : null}

            {hasSourceDetails ? (
              <div className="assistant-work__source-facts">
                {knowledgeSourceCount > 0 ? (
                  <div className="assistant-work__source-fact">
                    <Database aria-hidden="true" />
                    <span>{knowledgeSourceCount} kurumsal kaynak kullanıldı</span>
                  </div>
                ) : null}
                {webSourceCount > 0 ? (
                  <div className="assistant-work__source-fact">
                    <Globe2 aria-hidden="true" />
                    <span>{webSourceCount} web kaynağı kullanıldı</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {sourceView.groundingUrls.length > 0 ? (
              <div className="assistant-work__sources" aria-label="Kullanılan web kaynakları">
                <div className="assistant-work__source-links">
                  {sourceView.groundingUrls.slice(0, 3).map((source, index) => (
                    <a
                      key={`${source.uri}-${index}`}
                      href={source.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="assistant-work__source-link"
                    >
                      <Link2 aria-hidden="true" />
                      <span>{source.title}</span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!isActive && onFollowUp ? (
          <div className="assistant-work__follow-ups">
            {hasSourceGap ? (
              <button type="button" onClick={requestWebSearch} disabled={followUpDisabled}>
                <Globe2 aria-hidden="true" />
                Web’de de ara
              </button>
            ) : null}
            {!isStopped ? (
              <button type="button" onClick={requestDeepResearch} disabled={followUpDisabled}>
                <Search aria-hidden="true" />
                Daha derin araştır
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
      {stopPortal}
    </>
  );
}
