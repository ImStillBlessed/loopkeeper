import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type DeskEvent } from "./api";

interface LiveState {
  /** Everything the desk has said since the server started (for the clients this person can see). */
  events: DeskEvent[];
  /** Are the simulated WhatsApp groups chatting on their own? */
  running: boolean;
  /** The chat's clock (it can run ahead of real time). */
  clock: number;
  /** The last pipeline error, e.g. the model's daily limit. */
  error: string | undefined;
  /** Bumps whenever the graphs changed, so pages know to refetch. */
  version: number;
  goLive: () => Promise<void>;
  pause: () => Promise<void>;
  advanceClock: (hours: number) => Promise<void>;
  dismissError: () => void;
  touch: () => void;
}

const LiveContext = createContext<LiveState | null>(null);

/** A pipeline failure older than this is history, not news. */
const STALE_ERROR_MS = 10 * 60_000;

/** One connection to the desk's event stream, shared by every page. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<DeskEvent[]>([]);
  const [state, setState] = useState({ running: false, clock: Date.now() });
  const [error, setError] = useState<string>();
  const [version, setVersion] = useState(0);
  const pending = useRef<number | undefined>(undefined);

  // While messages stream in, refetch at most every 1.5 s.
  const bumpSoon = useCallback(() => {
    if (pending.current) return;
    pending.current = window.setTimeout(() => {
      pending.current = undefined;
      setVersion((v) => v + 1);
    }, 1500);
  }, []);

  useEffect(() => {
    api.live().then(setState, () => undefined);
    const reconnected = () => {
      setEvents([]);
      setVersion((v) => v + 1);
    };
    return api.events((event) => {
      setEvents((all) => (all.length > 1500 ? [...all.slice(-1000), event] : [...all, event]));
      if (event.kind === "live") {
        setState({ running: event.running, clock: event.clock });
        bumpSoon();
      }
      if (event.kind === "message") setState((s) => ({ ...s, clock: Math.max(s.clock, Date.parse(event.message.ts)) }));
      if (event.kind === "activity" || event.kind === "bot" || event.kind === "hub" || (event.kind === "message" && event.message.relevant)) bumpSoon();
      if (event.kind === "run") {
        // History replays old failures to a page that just opened: only recent ones are shown.
        const stale = event.state === "failed" && event.at !== undefined && Date.now() - event.at > STALE_ERROR_MS;
        if (!stale) setError(event.state === "failed" ? event.error : undefined);
        if (event.state !== "started") bumpSoon();
      }
    }, reconnected);
  }, [bumpSoon]);

  // The clock keeps ticking between events, so SLA timers count down on screen. Pages refetch too,
  // in case anything changed without an event (e.g. a promise falling due).
  useEffect(() => {
    const timer = window.setInterval(() => {
      setState((s) => ({ ...s, clock: s.clock + 30_000 }));
      if (document.visibilityState === "visible") setVersion((v) => v + 1);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const value: LiveState = {
    events,
    ...state,
    error,
    version,
    touch: () => setVersion((v) => v + 1),
    dismissError: () => setError(undefined),
    goLive: async () => {
      setError(undefined);
      setState(await api.goLive());
    },
    pause: async () => setState(await api.pause()),
    advanceClock: async (hours) => {
      setState(await api.advanceClock(hours));
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

/** Fetches data and refetches whenever the graphs change. `reload` refetches on demand. */
export function useLiveQuery<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const { version } = useLive();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((result) => !cancelled && (setData(result), setError(undefined)))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, nonce, ...deps]);

  return { data, error, reload: () => setNonce((n) => n + 1) };
}
