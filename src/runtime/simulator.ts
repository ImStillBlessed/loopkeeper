import { CAST, castOf, CLIENTS, type CastMember } from "../../data/synthetic/cast.js";
import { buildChat, START_DATE, type TimedEvent } from "../../data/synthetic/generator.js";
import { PREPARED, type PreparedKind } from "../../data/synthetic/prepared.js";
import { SCRIPTED_EVENTS, type ChatEvent, type ScenarioId } from "../../data/synthetic/scenarios.js";
import type { ChatClock } from "./clock.js";

/** What the simulator hands over when someone in a client's group "sends" a message. */
export type SendFn = (message: { clientId: string; senderLabel: string; text: string; hasMedia?: boolean; ts: number }) => void;

const DAY = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET = 60 * 60 * 1000;
const SCRIPT_DAY_ZERO = Date.UTC(START_DATE.year, START_DATE.month - 1, START_DATE.day);

/**
 * A pretend WhatsApp connection for the demo clients. Every client has its own group; the simulator
 * sends each message to the right one. It can:
 *   - go live: play three weeks of all the groups as live chat (dated from the next morning, sped up)
 *   - play one storyline (S1–S8)
 *   - send one message to a client: prepared (issue, greeting, …) or anything you type
 * It only ever produces messages; each client's inbox and pipeline treat them like real ones.
 */
export class Simulator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private script: TimedEvent[] = [];
  private position = 0;
  private anchor = 0;
  private router = new ClientRouter();
  paceMs = 2500;

  constructor(
    private clock: ChatClock,
    private send: SendFn,
    private onChange: () => void,
    /** Clients that exist right now (a deleted demo client is skipped). */
    private activeClients: () => string[],
  ) {}

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Start (or resume) the live groups. */
  start(paceMs = this.paceMs): void {
    this.stop();
    this.paceMs = paceMs;
    if (this.position >= this.script.length) {
      this.script = buildChat(Math.floor(Math.random() * 10_000));
      this.position = 0;
      this.anchor = nextMorning(this.clock.peek());
      this.router = new ClientRouter();
    }
    this.onChange();
    this.tick();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.onChange();
  }

  /** Forget where the live script was, so the next start begins a fresh three weeks. */
  rewind(): void {
    this.stop();
    this.position = 0;
    this.script = [];
  }

  /**
   * Plays one storyline into whichever clients it involves, happening now: its messages arrive a
   * moment apart in their scripted order. (Use "Skip ahead" to watch promises and SLAs fall due.)
   */
  async playStory(scenario: ScenarioId, paceMs = 1500): Promise<number> {
    const events = SCRIPTED_EVENTS.filter((e) => e.label.scenario === scenario).sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
    if (events.length === 0) return 0;
    const router = new ClientRouter();
    for (const event of events) {
      const clientId = router.clientFor(event, this.activeClients());
      if (!clientId) continue;
      this.send({ clientId, senderLabel: castLabel(event.sender), text: event.text, hasMedia: event.hasMedia, ts: this.clock.now() });
      await sleep(paceMs);
    }
    return events.length;
  }

  /** A ready-made message of the given kind, in one client's group, from a fitting (or the named) person. */
  prepared(clientId: string, kind: PreparedKind, sender?: string): { sender: string; text: string } {
    const library = PREPARED[kind];
    const person = sender ? resolveSender(sender, clientId) : pick(peopleFor(clientId, library.senders)).name;
    const text = pick(library.texts);
    this.say(clientId, person, text);
    return { sender: person, text };
  }

  /** Anyone says anything in a client's group. Unknown names become new people in that group. */
  say(clientId: string, sender: string, text: string): void {
    const member = CAST.find((m) => m.name === sender || m.key === sender);
    this.send({ clientId, senderLabel: member?.whatsappLabel ?? sender, text, ts: this.clock.now() });
  }

  private tick = (): void => {
    const event = this.script[this.position];
    if (!event) {
      this.timer = undefined;
      this.onChange();
      return;
    }
    this.position++;
    const clientId = this.router.clientFor(event, this.activeClients());
    if (clientId) {
      // Keep the script's rhythm across days, but never let chat time run backwards.
      this.clock.setAtLeast(this.anchor + eventOffset(event));
      this.send({ clientId, senderLabel: castLabel(event.sender), text: event.text, hasMedia: event.hasMedia, ts: this.clock.now() });
    }
    // Real work is spaced out a little more than small talk, so the feed is readable.
    const delay = this.paceMs * (event.label.relevant ? 1.4 : 0.6);
    this.timer = setTimeout(this.tick, delay);
  };
}

/**
 * Which client's group a scripted message belongs to. A teacher always writes in their own client's
 * group; Ednovax staff reply in the group of whoever last spoke in the same storyline.
 */
class ClientRouter {
  private lastByScenario = new Map<string, string>();
  private lastClient: string | undefined;

  clientFor(event: ChatEvent, active: string[]): string | undefined {
    const sender = CAST.find((m) => m.key === event.sender);
    const scenario = event.label.scenario ?? "noise";
    let clientId = sender?.clientId ?? this.lastByScenario.get(scenario) ?? (event.label.relevant ? this.lastClient : undefined);
    // Small talk from the Ednovax team lands in any group.
    clientId ??= pick(active.length ? active : CLIENTS.map((c) => c.id));
    if (!active.includes(clientId)) return undefined;
    if (sender?.clientId) {
      this.lastByScenario.set(scenario, clientId);
      if (event.label.relevant) this.lastClient = clientId;
    }
    return clientId;
  }
}

/** Turns "chidi", "Mr Chidi", "chidi nwosu" into a cast member's full name, preferring people in the given client's group. */
export function resolveSender(input: string, clientId?: string): string {
  const needle = input.trim().toLowerCase();
  const people = clientId ? castOf(clientId) : CAST;
  const member =
    people.find((m) => m.key === needle) ??
    people.find((m) => m.name.toLowerCase() === needle) ??
    people.find((m) => m.name.toLowerCase().includes(needle)) ??
    CAST.find((m) => m.key === needle || m.name.toLowerCase().includes(needle));
  return member?.name ?? input.trim();
}

/** WhatsApp label for a cast member's full name (some appear as phone numbers); anyone else is kept as typed. */
export function whatsappLabelFor(name: string): string {
  return CAST.find((m) => m.name === name)?.whatsappLabel ?? name;
}

function peopleFor(clientId: string, senders: "teachers" | "staff" | "anyone"): CastMember[] {
  const people = castOf(clientId);
  if (senders === "teachers") return people.filter((m) => m.clientId);
  if (senders === "staff") return people.filter((m) => !m.clientId);
  return people;
}

function castLabel(key: string): string {
  return CAST.find((m) => m.key === key)?.whatsappLabel ?? key;
}

/** Milliseconds from the script's day zero (local midnight) to the event. */
function eventOffset(event: { day: number; time: string } | TimedEvent): number {
  if ("date" in event) return event.date.getTime() - SCRIPT_DAY_ZERO;
  const [hours, minutes] = event.time.split(":").map(Number);
  return event.day * DAY + (hours * 60 + minutes) * 60_000;
}

/** Lagos midnight starting the next chat day (today if it's still before 6 am). */
function nextMorning(now: number): number {
  const local = new Date(now + LAGOS_OFFSET);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - LAGOS_OFFSET;
  return local.getUTCHours() < 6 ? midnight : midnight + DAY;
}

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
