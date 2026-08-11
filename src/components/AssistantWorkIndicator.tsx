import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  Globe2,
  LoaderCircle,
  Search,
} from 'lucide-react';
import type { AssistantKnowledgeSource } from '../types';
import { cn } from '../lib/utils';
import { JetWorkLogo } from './JetWorkLogo';

const ACTIVITY_PREFIX = /^(?:[•*\-–—]|\d+[.)])\s*/u;
const MARKDOWN_DECORATION = /[*#`_]/gu;
const WARNING_ACTIVITY = /(?:bulunamad|başarısız|kullanılamadı|yetersiz|erişilemedi|hata)/iu;
const COMPLEX_ACTIVITY = /(?:bilgi bankası|kurumsal kaynak|kaynak|web|araştır|dosya|belge|doğrula|karşılaştır|araç|entegrasyon|artifact|doküman)/iu;
const SOURCE_GAP_ACTIVITY = /(?:kaynak|bilgi bankası|web).*(?:bulunamad|yetersiz|kullanılamadı|erişilemedi)|(?:bulunamad|yetersiz|kullanılamadı|erişilemedi).*(?:kaynak|bilgi bankası|web)/iu;

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
  if (!normalized) return;
  const key = normalized.toLocaleLowerCase('tr-TR');
  if (target.some(item => item.toLocaleLowerCase('tr-TR') === key)) return;
  target.push(normalized);
};

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

  if ((input.knowledgeSourceCount || 0) > 0 && !labels.some(label => /\d+\s+kurumsal kaynak|kurumsal kaynak kullanıldı/iu.test(label))) {
    appendUnique(labels, `${input.knowledgeSourceCount} kurumsal kaynak kullanıldı.`);
  }
  if ((input.webSourceCount || 0) > 0 && !labels.some(label => /\d+\s+(?:web|internet) kaynağı|(?:web|internet) kaynağı kullanıldı/iu.test(label))) {
    appendUnique(labels, `${input.webSourceCount} web kaynağı kullanıldı.`);
  }

  return labels.map(label => ({
    label,
    state: WARNING_ACTIVITY.test(label)
      ? 'warning'
      : input.isActive && label.toLocaleLowerCase('tr-TR') === activeLabelKey
        ? 'active'
        : 'completed',
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

const ActivityStateIcon = ({ state }: { state: AssistantWorkActivity['state'] }) => {
  if (state === 'warning') return <AlertTriangle aria-hidden="true" />;
  if (state === 'active') return <LoaderCircle aria-hidden="true" />;
  return <Check aria-hidden="true" />;
};

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
  const knowledgeSourceCount = knowledgeSources?.length || 0;
  const webSourceCount = groundingUrls?.length || 0;
  const activities = useMemo(() => buildAssistantWorkActivities({
    isActive,
    activityText,
    phaseLabel,
    knowledgeSourceCount,
    webSourceCount,
  }), [activityText, isActive, knowledgeSourceCount, phaseLabel, webSourceCount]);
  const hasComplexActivity = knowledgeSourceCount > 0
    || webSourceCount > 0
    || activities.length > 2
    || activities.some(activity => COMPLEX_ACTIVITY.test(activity.label));
  const [isExpanded, setIsExpanded] = useState(() => isActive && hasComplexActivity);
  const [isBackgrounded, setIsBackgrounded] = useState(false);
  const userChangedExpansion = useRef(false);
  const canShowDetails = activities.length > 0;
  const hasSourceGap = webSourceCount === 0
    && activities.some(activity => SOURCE_GAP_ACTIVITY.test(activity.label));

  useEffect(() => {
    if (!isActive) {
      setIsExpanded(false);
      setIsBackgrounded(false);
      return;
    }
    if (hasComplexActivity && !userChangedExpansion.current && !isBackgrounded) {
      setIsExpanded(true);
    }
  }, [hasComplexActivity, isActive, isBackgrounded]);

  const toggleDetails = () => {
    userChangedExpansion.current = true;
    setIsBackgrounded(false);
    setIsExpanded(previous => !previous);
  };

  const continueInBackground = () => {
    userChangedExpansion.current = true;
    setIsExpanded(false);
    setIsBackgrounded(true);
  };

  const requestWebSearch = () => onFollowUp?.(
    'Bu soruyu web üzerinde de araştır. Güncel ve güvenilir web kaynaklarıyla bulguları doğrula ve kaynakları göster.',
  );
  const requestDeepResearch = () => onFollowUp?.(
    'Bu yanıtı daha derin araştır. Gerektiğinde bilgi bankasını ve web kaynaklarını kullan; bulguları kaynaklarla karşılaştırıp doğrula.',
  );

  return (
    <section
      data-testid="assistant-work-indicator"
      className={cn('assistant-work', !isActive && 'assistant-work--completed')}
      aria-label={isActive
        ? `JetWork çalışıyor, ${elapsedSeconds} saniye`
        : isStopped
          ? `JetWork çalışması ${elapsedSeconds} saniyede durduruldu`
          : `JetWork çalışmasını ${elapsedSeconds} saniyede tamamladı`}
    >
      <div className="assistant-work__topline">
        {isActive ? (
          <>
            <span className="assistant-work__logo-stage" aria-hidden="true">
              <span className="assistant-work__logo-motion">
                <JetWorkLogo className="assistant-work__logo" />
              </span>
            </span>
            <span className="assistant-work__label">
              {isBackgrounded ? 'Arka planda çalışıyor' : 'Düşünüyor'}
            </span>
            <span className="assistant-work__separator" aria-hidden="true">·</span>
            <time className="assistant-work__time">{elapsedSeconds} sn</time>
          </>
        ) : (
          <>
            {isStopped ? (
              <CircleStop className="assistant-work__complete-icon assistant-work__complete-icon--stopped" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="assistant-work__complete-icon" aria-hidden="true" />
            )}
            <span className="assistant-work__complete-label">
              {elapsedSeconds} sn’de {isStopped ? 'durduruldu' : 'hazırlandı'}
            </span>
          </>
        )}
      </div>

      <div className="assistant-work__actions">
        {canShowDetails ? (
          <button
            type="button"
            className="assistant-work__action"
            onClick={toggleDetails}
            aria-expanded={isExpanded}
          >
            {isActive ? (isExpanded ? 'Ayrıntıları gizle' : 'Çalışma ayrıntıları') : (isExpanded ? 'Ayrıntıları gizle' : 'Nasıl hazırlandı?')}
            <ChevronDown className={cn('assistant-work__chevron', isExpanded && 'assistant-work__chevron--open')} aria-hidden="true" />
          </button>
        ) : null}
        {isActive && elapsedSeconds >= 15 && !isBackgrounded ? (
          <button type="button" className="assistant-work__action" onClick={continueInBackground}>
            <Clock3 aria-hidden="true" />
            Arka planda çalışsın
          </button>
        ) : null}
        {isActive && onStop ? (
          <button type="button" className="assistant-work__action assistant-work__stop" onClick={onStop}>
            <CircleStop aria-hidden="true" />
            Durdur
          </button>
        ) : null}
      </div>

      {isExpanded && canShowDetails ? (
        <div className="assistant-work__details" data-testid="assistant-work-details">
          <ol className="assistant-work__activity-list">
            {activities.map(activity => (
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
        </div>
      ) : null}
    </section>
  );
}
