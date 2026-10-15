import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { projectApi, type PipelineEvent, type ProjectApi } from "./api";

interface LiveState {
  project: string;
  api: ProjectApi;
  /** Everything this project has said since the server started. */
  events: PipelineEvent[];
  seen: number;
  ignored: number;
  used: number;
  /** Is the simulated WhatsApp group sending messages on its own? */
  live: boolean;
  liveGroupId: string | undefined;
  /** The chat's clock (it can run ahead of real time). */
  clock: number;
  error: string | undefined;
  /** Bumps whenever the graph changed, so pages know to refetch. */
  version: number;
  goLive: (groupId?: string) => Promise<void>;
  pause: () => Promise<void>;
  advanceClock: (hours: number) => Promise<void>;
  reset: () => Promise<void>;
  touch: () => void;
}

const LiveContext = createContext<LiveState | null>(null);

/** Connects once to a project's event stream and shares it with every page. Remount it to switch project. */
export function LiveProvider({ project, children }: { project: string; children: ReactNode }) {
  const api = useMemo(() => projectApi(project), [project]);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [counts, setCounts] = useState({ seen: 0, ignored: 0, used: 0 });
  const [liveState, setLiveState] = useState({ live: false, liveGroupId: undefined as string | undefined, clock: Date.now() });
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const pendingBump = useRef<number | undefined>(undefined);

  // While messages stream in, refetch at most every 1.2 s.
  const bumpSoon = useCallback(() => {
    if (pendingBump.current) return;
    pendingBump.current = window.setTimeout(() => {
      pendingBump.current = undefined;
      setVersion((v) => v + 1);
    }, 1200);
  }, []);

  useEffect(() => {
    api.stats().then((s) => {
      setCounts({ seen: s.seen, ignored: s.ignored, used: s.used });
      setLiveState({ live: s.live, liveGroupId: s.liveGroupId ?? undefined, clock: s.clock });
    });

    return api.events((event) => {
      setEvents((all) => [...all, event]);
      if (event.kind === "stats") setCounts({ seen: event.seen, ignored: event.ignored, used: event.used });
      if (event.kind === "live") setLiveState({ live: event.running, liveGroupId: event.groupId, clock: event.clock });
      if (event.kind === "message") setLiveState((s) => ({ ...s, clock: Math.max(s.clock, Date.parse(event.message.ts)) }));
      if (event.kind === "activity" || event.kind === "bot") bumpSoon();
      if (event.kind === "run") {
        setError(event.state === "failed" ? event.error : undefined);
        if (event.state !== "started") setVersion((v) => v + 1);
      }
    });
  }, [api, bumpSoon]);

  const value: LiveState = {
    project,
    api,
    events,
    ...counts,
    ...liveState,
    error,
    version,
    touch: () => setVersion((v) => v + 1),
    goLive: async (groupId) => {
      setError(undefined);
      await api.goLive(groupId);
    },
    pause: async () => {
      await api.pause();
    },
    advanceClock: async (hours) => {
      const stats = await api.advanceClock(hours);
      setLiveState((s) => ({ ...s, clock: stats.clock }));
    },
    reset: async () => {
      await api.reset();
      setEvents([]);
      setCounts({ seen: 0, ignored: 0, used: 0 });
      setVersion((v) => v + 1);
    },
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  const live = useContext(LiveContext);
  if (!live) throw new Error("useLive must be used inside <LiveProvider>");
  return live;
}

/** Fetches data for the open project and refetches whenever the graph changes. */
export function useLiveQuery<T>(fetcher: (api: ProjectApi) => Promise<T>, extraDeps: unknown[] = []) {
  const { version, api } = useLive();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetcher(api)
      .then((result) => !cancelled && (setData(result), setError(undefined)))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, version, ...extraDeps]);

  return { data, error };
}
