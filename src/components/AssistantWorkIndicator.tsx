import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Globe2, Search, Square } from 'lucide-react';
import type { AssistantKnowledgeSource } from '../types';
import { cn } from '../lib/utils';
import { splitAssistantSources } from '../services/assistantSources';
import type { AgentWorkEvent } from '../services/agentWorkTypes';
import {
  completeActiveAgentEvents,
  createObservedAgentWorkEvent,
  diffRollingActivitySnapshot,
  formatAgentActivityLabel,
  normalizeAgentActivityLabel,
  reduceAgentActivityEvents,
  sourceCountAgentWorkEvent,
} from '../services/agentActivityReducer';
import { AgentWorkHeader } from './AgentWorkHeader';
import { AgentWorkTimeline } from './AgentWorkTimeline';

const WARNING_ACTIVITY = /(?:bulunamad|başarısız|kullanılamadı|yetersiz|erişilemedi|hata|engellendi)/iu;
const SOURCE_GAP_ACTIVITY = /(?:kaynak|bilgi bankası|web).*(?:bulunamad|yetersiz|kullanılamadı|erişilemedi)|(?:bulunamad|yetersiz|kullanılamadı|erişilemedi).*(?:kaynak|bilgi bankası|web)/iu;
const LOW_VALUE_ACTIVITY = /^çalışılıyor\.{0,3}$/iu;

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
  /** Canonical event input for Agent Work Runtime v1. Legacy props remain as a compatibility bridge. */
  workEvents?: AgentWorkEvent[];
  isStopped?: boolean;
  onStop?: () => void;
  onFollowUp?: (prompt: string) => void;
  followUpDisabled?: boolean;
}

const appendUnique = (target: string[], value: string | undefined) => {
  const normalized = normalizeAgentActivityLabel(value || '');
  if (!normalized || LOW_VALUE_ACTIVITY.test(normalized)) return;
  const key = normalized.toLocaleLowerCase('tr-TR');
  if (target.some(item => item.toLocaleLowerCase('tr-TR') === key)) return;
  target.push(normalized);
};

export const formatAssistantWorkActivityLabel = formatAgentActivityLabel;

export function buildAssistantWorkActivities(input: {
  isActive: boolean;
  activityText?: string;
  phaseLabel?: string;
  knowledgeSourceCount?: number;
  webSourceCount?: number;
}): AssistantWorkActivity[] {
  const labels: string[] = [];
  for (const line of (input.activityText || '').split(/\r?\n/u)) appendUnique(labels, line);
  if ((input.knowledgeSourceCount || 0) > 0) appendUnique(labels, `${input.knowledgeSourceCount} kurumsal kaynak bulundu · kanıtlar eşleştiriliyor`);
  if ((input.webSourceCount || 0) > 0) appendUnique(labels, `${input.webSourceCount} web kaynağı bulundu · güncellik ve tutarlılık kontrol ediliyor`);
  appendUnique(labels, input.phaseLabel);

  const activeKey = normalizeAgentActivityLabel(input.phaseLabel || labels.at(-1) || '').toLocaleLowerCase('tr-TR');
  return labels.map((label, index) => ({
    label,
    state: WARNING_ACTIVITY.test(label)
      ? 'warning'
      : input.isActive && (label.toLocaleLowerCase('tr-TR') === activeKey || (!activeKey && index === labels.length - 1))
        ? 'active'
        : 'completed',
  }));
}

export function buildPendingRuntimeActivities(_elapsedSeconds: number): AssistantWorkActivity[] {
  return [];
}

export const selectCompletedActivityEvidence = (
  reported: AssistantWorkActivity[],
  observed: AssistantWorkActivity[],
): AssistantWorkActivity[] => reported.length > 0 ? reported : observed;

export const dedupeAssistantWorkActivities = (activities: AssistantWorkActivity[]): AssistantWorkActivity[] => {
  const result: AssistantWorkActivity[] = [];
  const indexByLabel = new Map<string, number>();
  for (const activity of activities) {
    const key = normalizeAgentActivityLabel(activity.label).toLocaleLowerCase('tr-TR');
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

const activitySnapshot = (activityText?: string, phaseLabel?: string): string[] => {
  const lines = (activityText || '')
    .split(/\r?\n/u)
    .map(normalizeAgentActivityLabel)
    .filter(Boolean);
  const phase = normalizeAgentActivityLabel(phaseLabel || '');
  if (phase && lines.at(-1) !== phase) lines.push(phase);
  return lines;
};

const eventsFromReportedActivities = (
  activities: AssistantWorkActivity[],
  startedAt?: number,
): AgentWorkEvent[] => activities.flatMap((activity, index) => {
  const event = createObservedAgentWorkEvent({
    rawLabel: activity.label,
    sequence: index + 1,
    active: activity.state === 'active',
    now: startedAt ? new Date(startedAt).toISOString() : undefined,
  });
  if (!event) return [];
  return [{
    ...event,
    eventId: `reported:${index + 1}`,
    state: activity.state,
  }];
});

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
  workEvents,
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

  const initialSnapshot = useMemo(() => activitySnapshot(activityText, phaseLabel), []);
  const [events, setEvents] = useState<AgentWorkEvent[]>(() => (
    workEvents?.length ? workEvents : eventsFromReportedActivities(reportedActivities, startedAt)
  ));
  const [isExpanded, setIsExpanded] = useState(isActive);
  const previousSnapshotRef = useRef<string[]>(initialSnapshot);
  const sequenceRef = useRef(Math.max(0, ...events.map(event => event.sequence)));
  const sourceCountRef = useRef({ knowledge: knowledgeSourceCount, web: webSourceCount });
  const composerStopTarget = useComposerStopTarget(isActive, onStop);

  useEffect(() => {
    if (!workEvents?.length) return;
    setEvents(previous => workEvents.reduce(reduceAgentActivityEvents, previous));
    sequenceRef.current = Math.max(sequenceRef.current, ...workEvents.map(event => event.sequence));
  }, [workEvents]);

  useEffect(() => {
    if (workEvents?.length) return;
    const snapshot = activitySnapshot(activityText, phaseLabel);
    const appended = diffRollingActivitySnapshot(previousSnapshotRef.current, snapshot);
    previousSnapshotRef.current = snapshot;
    if (!appended.length) return;

    setEvents(previous => {
      let next = completeActiveAgentEvents(previous);
      appended.forEach((rawLabel, index) => {
        sequenceRef.current += 1;
        const event = createObservedAgentWorkEvent({
          rawLabel,
          sequence: sequenceRef.current,
          active: isActive && index === appended.length - 1,
        });
        if (event) next = reduceAgentActivityEvents(next, event);
      });
      return next;
    });
  }, [activityText, isActive, phaseLabel, workEvents]);

  useEffect(() => {
    const nextCounts = { knowledge: knowledgeSourceCount, web: webSourceCount };
    const previousCounts = sourceCountRef.current;
    const newSourceEvents: AgentWorkEvent[] = [];
    if (nextCounts.knowledge > previousCounts.knowledge) {
      sequenceRef.current += 1;
      newSourceEvents.push(sourceCountAgentWorkEvent({ sequence: sequenceRef.current, sourceType: 'knowledge', count: nextCounts.knowledge }));
    }
    if (nextCounts.web > previousCounts.web) {
      sequenceRef.current += 1;
      newSourceEvents.push(sourceCountAgentWorkEvent({ sequence: sequenceRef.current, sourceType: 'web', count: nextCounts.web }));
    }
    sourceCountRef.current = nextCounts;
    if (newSourceEvents.length) setEvents(previous => newSourceEvents.reduce(reduceAgentActivityEvents, previous));
  }, [knowledgeSourceCount, webSourceCount]);

  useEffect(() => {
    if (isActive) {
      setIsExpanded(true);
      return;
    }
    setEvents(previous => completeActiveAgentEvents(previous));
    setIsExpanded(false);
  }, [isActive]);

  const orderedEvents = useMemo(() => [...events].sort((a, b) => a.sequence - b.sequence), [events]);
  const hasWorkDetails = orderedEvents.length > 0;
  const hasSourceGap = webSourceCount === 0 && orderedEvents.some(event => SOURCE_GAP_ACTIVITY.test(event.rawLabel || event.label));

  const requestWebSearch = () => onFollowUp?.('Bu soruyu web üzerinde de araştır. Güncel ve güvenilir web kaynaklarıyla bulguları doğrula ve kaynakları göster.');
  const requestDeepResearch = () => onFollowUp?.('Bu yanıtı daha derin araştır. Gerektiğinde bilgi bankasını ve web kaynaklarını kullan; bulguları kaynaklarla karşılaştırıp doğrula.');

  const stopPortal = composerStopTarget && onStop
    ? createPortal(
        <button type="button" data-testid="chat-stop" aria-label="Yanıtı durdur" className="assistant-composer-stop" onClick={onStop}>
          <Square aria-hidden="true" />
        </button>,
        composerStopTarget,
      )
    : null;

  return (
    <>
      <section
        data-testid="assistant-work-indicator"
        className={cn('assistant-work', !isActive && 'assistant-work--completed')}
        aria-label={isActive
          ? `JetWork düşünüyor, ${elapsedSeconds} saniye`
          : isStopped
            ? `JetWork ${formattedDuration} düşündü ve durduruldu`
            : `JetWork ${formattedDuration} düşündü`}
      >
        <AgentWorkHeader
          isActive={isActive}
          duration={formattedDuration}
          elapsedSeconds={elapsedSeconds}
          expanded={isExpanded}
          expandable={hasWorkDetails}
          isStopped={isStopped}
          onToggle={() => setIsExpanded(previous => !previous)}
        />

        {isExpanded && hasWorkDetails ? (
          <AgentWorkTimeline events={orderedEvents} live={isActive} />
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
