import type { HubEvent } from "../src/pipeline/types.js";

/** A thin client for the Loopkeeper API, used by the CLI. Logs in like the dashboard, with a session cookie. */
export class LoopkeeperApi {
  private cookie = "";

  constructor(readonly baseUrl: string) {}

  async logIn(email: string, password: string): Promise<{ name: string; role: string }> {
    const response = await this.raw("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
    this.cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    return body as { name: string; role: string };
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  async post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  private async raw(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/api${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(this.cookie ? { Cookie: this.cookie } : {}) } });
    } catch {
      throw new Error(`Can't reach Loopkeeper at ${this.baseUrl}. Start it with "npm run dev" (or "npm start").`);
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.raw(path, init);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
    return body as T;
  }

  /** Follows the app-wide live events (every client you can see). Returns a function that stops listening. */
  follow(onEvent: (event: HubEvent) => void, onDrop: () => void): () => void {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await this.raw("/events?history=none", { signal: controller.signal });
        const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const data = frame.split("\n").find((line) => line.startsWith("data:"));
            if (data) onEvent(JSON.parse(data.slice(5).trim()));
          }
        }
      } catch {
        // Aborted, or the server went away.
      }
      if (!controller.signal.aborted) onDrop();
    })();
    return () => controller.abort();
  }
}
