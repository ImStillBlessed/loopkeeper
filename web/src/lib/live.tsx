import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type PipelineEvent } from "./api";

interface LiveState {
  /** Everything the pipeline has said since the server started. */
  events: PipelineEvent[];
  seen: number;
  ignored: number;
  used: number;
  running: boolean;
  hasApiKey: boolean;
  error: string | undefined;
  /** Bumps whenever the graph changed, so pages know to refetch. */
  version: number;
  replay: (speed: string) => Promise<void>;
  importExport: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
  touch: () => void;
}

const LiveContext = createContext<LiveState | null>(null);

/** Connects once to the server's event stream and shares it with every page. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [counts, setCounts] = useState({ seen: 0, ignored: 0, used: 0 });
  const [running, setRunning] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(true);
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const pendingBump = useRef<number | undefined>(undefined);

  // While a replay streams in, refetch at most every 1.2 s.
  const touch = useCallback(() => {
    if (pendingBump.current) return;
    pendingBump.current = window.setTimeout(() => {
      pendingBump.current = undefined;
      setVersion((v) => v + 1);
    }, 1200);
  }, []);

  useEffect(() => {
    api.stats().then((s) => {
      setCounts({ seen: s.seen, ignored: s.ignored, used: s.used });
      setRunning(s.running);
      setHasApiKey(s.hasApiKey);
    });

    return api.events((event) => {
      setEvents((all) => [...all, event]);
      if (event.kind === "stats") setCounts({ seen: event.seen, ignored: event.ignored, used: event.used });
      if (event.kind === "activity" || event.kind === "bot") touch();
      if (event.kind === "run") {
        setRunning(event.state === "started");
        setError(event.state === "failed" ? event.error : undefined);
        if (event.state !== "started") setVersion((v) => v + 1);
      }
    });
  }, [touch]);

  const reset = useCallback(async () => {
    await api.reset();
    setEvents([]);
    setCounts({ seen: 0, ignored: 0, used: 0 });
    setVersion((v) => v + 1);
  }, []);

  const value: LiveState = {
    events,
    ...counts,
    running,
    hasApiKey,
    error,
    version,
    touch: () => setVersion((v) => v + 1),
    reset,
    replay: async (speed) => {
      await reset();
      await api.replay(speed);
    },
    importExport: async (text) => {
      await reset();
      await api.importExport(text);
    },
    stop: async () => {
      await api.stop();
    },
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLive(): LiveState {
  const live = useContext(LiveContext);
  if (!live) throw new Error("useLive must be used inside <LiveProvider>");
  return live;
}

/** Fetches data and refetches whenever the graph changes. */
export function useLiveQuery<T>(fetcher: () => Promise<T>, extraDeps: unknown[] = []) {
  const { version } = useLive();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((result) => !cancelled && (setData(result), setError(undefined)))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ...extraDeps]);

  return { data, error };
}
