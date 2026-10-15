import type { PipelineEvent } from "../src/pipeline/types.js";

/** A thin client for the Loopkeeper API, used by the CLI. */
export class LoopkeeperApi {
  constructor(readonly baseUrl: string) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  async post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api${path}`, init);
    } catch {
      throw new Error(`Can't reach Loopkeeper at ${this.baseUrl}. Start it with "npm run dev" (or "npm start").`);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
    return body as T;
  }

  /** Follows a project's live events. Returns a function that stops listening. */
  follow(project: string, onEvent: (event: PipelineEvent) => void, onDrop: () => void): () => void {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/api/projects/${project}/events?history=none`, { signal: controller.signal });
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
