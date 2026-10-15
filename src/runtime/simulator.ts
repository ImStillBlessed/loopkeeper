import { CAST, type CastMember } from "../../data/synthetic/cast.js";
import { buildChat, START_DATE, type TimedEvent } from "../../data/synthetic/generator.js";
import { PREPARED, type PreparedKind } from "../../data/synthetic/prepared.js";
import { SCRIPTED_EVENTS, type ScenarioId } from "../../data/synthetic/scenarios.js";
import type { ChatClock } from "./clock.js";

/** What the simulator hands to the project when someone in the group "sends" a message. */
export type SendFn = (message: { groupId: string; senderLabel: string; text: string; hasMedia?: boolean; ts: number }) => void;

const DAY = 24 * 60 * 60 * 1000;
const LAGOS_OFFSET = 60 * 60 * 1000;
const SCRIPT_DAY_ZERO = Date.UTC(START_DATE.year, START_DATE.month - 1, START_DATE.day);

/**
 * A pretend WhatsApp connection for the demo group. It can:
 *   - go live: play three weeks of the group as a live chat (dated from tomorrow morning, sped up)
 *   - play one storyline (S1–S7) on its own
 *   - send one message: prepared (issue, greeting, …) or anything you type
 * It only ever produces messages; the project's inbox and pipeline treat them like real ones.
 */
export class Simulator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private script: TimedEvent[] = [];
  private position = 0;
  private anchor = 0;
  groupId: string | undefined;
  paceMs = 2500;

  constructor(
    private clock: ChatClock,
    private send: SendFn,
    private onChange: () => void,
  ) {}

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Start (or resume) the live group. */
  start(groupId: string, paceMs = this.paceMs): void {
    this.stop();
    this.groupId = groupId;
    this.paceMs = paceMs;
    if (this.position >= this.script.length) {
      this.script = buildChat(Math.floor(Math.random() * 10_000));
      this.position = 0;
      this.anchor = nextMorning(this.clock.peek());
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

  /** Plays one storyline quickly; the clock jumps over the days between its messages. */
  async playStory(groupId: string, scenario: ScenarioId, paceMs = 1500): Promise<number> {
    const events = SCRIPTED_EVENTS.filter((e) => e.label.scenario === scenario).sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));
    if (events.length === 0) return 0;
    // The story's first day becomes the next chat day; each message keeps its time of day.
    const start = nextMorning(this.clock.peek()) - Math.floor(eventOffset(events[0]) / DAY) * DAY;

    for (const event of events) {
      const ts = Math.max(this.clock.peek(), start + eventOffset(event));
      this.clock.setAtLeast(ts);
      this.send({ groupId, senderLabel: castLabel(event.sender), text: event.text, hasMedia: event.hasMedia, ts: this.clock.now() });
      await sleep(paceMs);
    }
    return events.length;
  }

  /** A ready-made message of the given kind, from a fitting (or the named) person. */
  prepared(groupId: string, kind: PreparedKind, sender?: string): { sender: string; text: string } {
    const library = PREPARED[kind];
    const person = sender ? resolveSender(sender) : pick(peopleFor(library.senders)).name;
    const text = pick(library.texts);
    this.say(groupId, person, text);
    return { sender: person, text };
  }

  /** Anyone says anything. Unknown names become new people in the group. */
  say(groupId: string, sender: string, text: string): void {
    const member = CAST.find((m) => m.name === sender || m.key === sender);
    this.send({ groupId, senderLabel: member?.whatsappLabel ?? sender, text, ts: this.clock.now() });
  }

  private tick = (): void => {
    const event = this.script[this.position];
    if (!event || !this.groupId) {
      this.timer = undefined;
      this.onChange();
      return;
    }
    this.position++;
    // Keep the script's rhythm across days, but never let chat time run backwards.
    this.clock.setAtLeast(this.anchor + eventOffset(event));
    this.send({ groupId: this.groupId, senderLabel: castLabel(event.sender), text: event.text, hasMedia: event.hasMedia, ts: this.clock.now() });

    // Real work is spaced out a little more than small talk, so the feed is readable.
    const delay = this.paceMs * (event.label.relevant ? 1.4 : 0.6);
    this.timer = setTimeout(this.tick, delay);
  };
}

/** Turns "chidi", "Mr Chidi", "chidi nwosu" into the cast member's full name. Anything else is kept as typed. */
export function resolveSender(input: string): string {
  const needle = input.trim().toLowerCase();
  const member =
    CAST.find((m) => m.key === needle) ??
    CAST.find((m) => m.name.toLowerCase() === needle) ??
    CAST.find((m) => m.name.toLowerCase().includes(needle));
  return member?.name ?? input.trim();
}

export function castPeople(): CastMember[] {
  return CAST;
}

function peopleFor(senders: "teachers" | "staff" | "anyone"): CastMember[] {
  if (senders === "teachers") return CAST.filter((m) => m.schoolId);
  if (senders === "staff") return CAST.filter((m) => !m.schoolId);
  return CAST;
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
