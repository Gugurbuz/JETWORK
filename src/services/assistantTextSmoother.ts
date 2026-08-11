export interface AssistantTextSmoother {
  current: () => string;
  push: (nextText: string) => void;
  finish: (finalText: string) => Promise<string>;
  stop: () => void;
}

interface FinishWaiter {
  resolve: (value: string) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

const abortReason = (signal?: AbortSignal): unknown => (
  signal?.reason || new DOMException('Assistant text smoothing was aborted.', 'AbortError')
);

const stepForBacklog = (backlog: number): number => {
  if (backlog > 1800) return Math.ceil(backlog / 18);
  if (backlog > 800) return 48;
  if (backlog > 360) return 24;
  if (backlog > 120) return 12;
  return 4;
};

export function createAssistantTextSmoother(input: {
  onUpdate: (visibleText: string) => void;
  signal?: AbortSignal;
  intervalMs?: number;
  finishMaxWaitMs?: number;
}): AssistantTextSmoother {
  const intervalMs = input.intervalMs ?? 22;
  const finishMaxWaitMs = input.finishMaxWaitMs ?? 1800;
  let displayed = '';
  let target = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const waiters: FinishWaiter[] = [];

  const clearTimer = () => {
    if (!timer) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const settleWaiters = () => {
    if (displayed !== target) return;
    while (waiters.length) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timeout);
      waiter.resolve(displayed);
    }
  };

  const rejectWaiters = (reason?: unknown) => {
    while (waiters.length) {
      const waiter = waiters.shift()!;
      clearTimeout(waiter.timeout);
      waiter.reject(reason);
    }
  };

  const emit = (nextText: string) => {
    if (displayed === nextText) return;
    displayed = nextText;
    input.onUpdate(displayed);
  };

  const advance = () => {
    timer = undefined;
    if (stopped) return;
    if (target.length < displayed.length || !target.startsWith(displayed)) {
      emit(target);
    } else if (displayed !== target) {
      const backlog = target.length - displayed.length;
      emit(target.slice(0, displayed.length + stepForBacklog(backlog)));
    }
    settleWaiters();
    if (displayed !== target) schedule();
  };

  function schedule() {
    if (timer || stopped || displayed === target) return;
    timer = setTimeout(advance, intervalMs);
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    rejectWaiters(abortReason(input.signal));
    input.signal?.removeEventListener('abort', stop);
  };

  if (input.signal?.aborted) {
    stopped = true;
  } else {
    input.signal?.addEventListener('abort', stop, { once: true });
  }

  return {
    current: () => displayed,
    push: (nextText: string) => {
      if (stopped) return;
      target = String(nextText || '');
      if (!target || target.length < displayed.length || !target.startsWith(displayed)) {
        emit(target);
        settleWaiters();
        return;
      }
      schedule();
    },
    finish: (finalText: string) => {
      if (stopped) return Promise.reject(abortReason(input.signal));
      target = String(finalText || '');
      if (displayed === target) return Promise.resolve(displayed);

      return new Promise<string>((resolve, reject) => {
        const waiter: FinishWaiter = {
          resolve,
          reject,
          timeout: setTimeout(() => {
            const index = waiters.indexOf(waiter);
            if (index >= 0) waiters.splice(index, 1);
            if (!stopped) {
              clearTimer();
              emit(target);
              settleWaiters();
              resolve(displayed);
            }
          }, finishMaxWaitMs),
        };
        waiters.push(waiter);
        schedule();
      });
    },
    stop,
  };
}
