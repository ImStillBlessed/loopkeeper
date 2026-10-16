import type { Graph } from "falkordb";
import type { SchoolProblem, Teacher } from "../../data/demo/henson.js";
import { C8_CANONICAL, run, SIM1_SAVE, SIM2_LOAD, SIM3_TICKET_OF_MESSAGE } from "../graph/queries.js";
import type { Llm } from "../llm/llm.js";
import { prompt } from "../llm/prompts.js";

/**
 * A school whose staff are played by the model, for the demo. The teachers only react: they raise
 * their problems one at a time, answer what Ednovax asks, chase when nobody replies, and when a ticket
 * is closed they try again and say whether it works. Everything they write goes through the desk's
 * normal pipeline, exactly like a real WhatsApp message; Ednovax's side is always real people.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** How the school paces itself, in real time. */
export interface Pace {
  tick: number;
  firstReport: number;
  betweenReports: number;
  maxOpen: number;
  typing: readonly [number, number];
  checking: readonly [number, number];
  nudge: number;
  update: number;
  chatter: readonly [number, number];
}

const PACE: Pace = {
  tick: 3 * SECOND,
  firstReport: 5 * SECOND,
  betweenReports: 3 * MINUTE,
  /** At most this many problems wait on Ednovax at once; the next one comes when one is settled. */
  maxOpen: 2,
  typing: [6 * SECOND, 14 * SECOND],
  checking: [20 * SECOND, 40 * SECOND],
  /** No reply at all for this long: chase (twice at most; the second time the principal steps in). */
  nudge: 4 * MINUTE,
  /** Acknowledged but nothing has changed for this long: ask for an update (twice at most). */
  update: 8 * MINUTE,
  chatter: [6 * MINUTE, 12 * MINUTE],
};

const TRANSCRIPT_LINES = 30;
const CONTEXT_LINES = 20;

export interface SchoolScript {
  name: string;
  city: string;
  teachers: Teacher[];
  problems: SchoolProblem[];
  chatter: string[];
}

export type CaseState = "waiting_reply" | "waiting_fix" | "checking" | "settled";

/** One problem a teacher has raised, and where it stands from the school's side. */
export interface SchoolCase {
  problemId: string;
  teacher: string;
  state: CaseState;
  reportedAt: number;
  /** The message that raised it, then the ticket the desk made of it (once it has). */
  messageId: string;
  ticketId?: string;
  ticketTitle?: string;
  ticketStatus?: string;
  /** The last time anyone spoke about it: chasing waits from here. */
  lastActivityAt: number;
  nudges: number;
  fixAttempts: number;
  checkAt?: number;
}

interface Line {
  by: string;
  text: string;
}

interface SavedState {
  cases: SchoolCase[];
  nextProblem: number;
  transcript: Line[];
  /** Live when last saved: a server restart picks up where it was. */
  live?: boolean;
}

type Purpose = "report" | "nudge" | "escalate" | "update" | "fixed" | "still_broken" | "satisfied";

interface Reply {
  teacher: string;
  problem: string | null;
  text: string;
  photo?: boolean;
  outcome: "answered" | "will_check" | "satisfied";
}

/** What a teacher says when the model can't be reached. */
const FALLBACK: Record<Exclude<Purpose, "report">, string> = {
  nudge: "Good day, please any update on this?",
  escalate: "Good afternoon Ednovax. This issue has been waiting for a while now. Kindly attend to it.",
  update: "Please any update on this one?",
  fixed: "It's working now. Thank you so much 🙏🏾",
  still_broken: "We just tried again and it's still the same thing 😔",
  satisfied: "Okay, thank you!",
};

export interface SchoolServices {
  graph: Graph;
  llm: Llm;
  /** Posts a teacher's message in the school's group (through the desk's pipeline); returns the message id. */
  post: (teacher: Teacher, text: string, hasMedia: boolean) => Promise<string>;
  /** Something changed (a teacher's state, live or paused), so open dashboards should refresh. */
  changed?: () => void;
}

export class SimulatedSchool {
  private state: SavedState = { cases: [], nextProblem: 0, transcript: [] };
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  /** Ednovax messages the teachers haven't answered yet, and when they will. */
  private unanswered: Line[] = [];
  private answerAt = 0;
  private nextReportAt = Number.POSITIVE_INFINITY;
  private reportNow = false;
  private nextChatterAt = Number.POSITIVE_INFINITY;

  private constructor(
    private script: SchoolScript,
    private services: SchoolServices,
    private pace: Pace,
  ) {}

  static async load(script: SchoolScript, services: SchoolServices, pace: Pace = PACE): Promise<SimulatedSchool> {
    const school = new SimulatedSchool(script, services, pace);
    const [saved] = await run<{ stateJson: string }>(services.graph, SIM2_LOAD);
    if (saved?.stateJson) school.state = JSON.parse(saved.stateJson) as SavedState;
    return school;
  }

  get running(): boolean {
    return this.timer !== undefined;
  }

  /** Whether the school was live when it was last saved (before a restart). */
  get wasLive(): boolean {
    return Boolean(this.state.live);
  }

  /** The teachers come to life. Time spent paused doesn't count as waiting. */
  start(): void {
    if (this.running) return;
    const now = Date.now();
    for (const c of this.open()) c.lastActivityAt = now;
    this.nextReportAt = now + (this.state.cases.length === 0 ? this.pace.firstReport : this.pace.betweenReports);
    this.nextChatterAt = now + between(this.pace.chatter);
    if (this.unanswered.length) this.answerAt = now + between(this.pace.typing);
    this.timer = setInterval(() => void this.tick(), this.pace.tick);
    void this.save();
  }

  stop(): void {
    if (!this.running) return;
    clearInterval(this.timer);
    this.timer = undefined;
    void this.save();
  }

  /** Someone from Ednovax wrote in the group. The teachers answer after a moment (once live). */
  heard(by: string, text: string): void {
    const line = { by, text };
    this.remember(line);
    this.unanswered.push(line);
    // Another message while they're "typing" pushes the answer back, so they read everything first.
    this.answerAt = Date.now() + between(this.pace.typing);
  }

  /** The next problem, raised now rather than when its turn comes. Returns who will raise it. */
  raiseNext(): string | undefined {
    const problem = this.script.problems[this.state.nextProblem];
    if (!problem) return undefined;
    this.reportNow = true;
    if (!this.running) void this.tick();
    return this.teacher(problem.by).name;
  }

  async reset(): Promise<void> {
    this.unanswered = [];
    this.reportNow = false;
    this.state = { cases: [], nextProblem: 0, transcript: [], live: this.running };
    if (this.running) this.nextReportAt = Date.now() + this.pace.firstReport;
    await this.save();
  }

  /** Who's waiting on what, for the desk's demo panel. */
  view() {
    const problemOf = (id: string) => this.script.problems.find((p) => p.id === id)!;
    const next = this.script.problems[this.state.nextProblem];
    return {
      running: this.running,
      teachers: this.script.teachers.map(({ key, name, job }) => ({ key, name, job })),
      cases: this.state.cases.map((c) => ({
        problemId: c.problemId,
        teacher: this.teacher(c.teacher).name,
        kind: problemOf(c.problemId).kind,
        situation: problemOf(c.problemId).situation,
        state: c.state,
        ticketId: c.ticketId ?? null,
        ticketTitle: c.ticketTitle ?? null,
        reportedAt: c.reportedAt,
      })),
      next: next ? { teacher: this.teacher(next.by).name, situation: next.situation } : null,
      remaining: this.script.problems.length - this.state.nextProblem,
    };
  }

  // ─── One step of the school's life ───────────────────────────────────────────

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.followTickets();
      const now = Date.now();
      if (this.unanswered.length && now >= this.answerAt) await this.answer();
      for (const c of this.open()) if (c.state === "checking" && now >= (c.checkAt ?? 0)) await this.tryTheFix(c);
      if (this.running) await this.chaseOne(now);
      if (this.reportNow || (this.running && now >= this.nextReportAt && this.open().length < this.pace.maxOpen)) await this.report();
      if (this.running && now >= this.nextChatterAt) await this.chatter();
    } catch (error) {
      console.warn(`Simulated school: ${(error as Error).message}`);
    } finally {
      this.busy = false;
    }
    // Asked to raise a problem while paused and busy: do it now that the step is over.
    if (this.reportNow && !this.running) void this.tick();
  }

  /** Finds the ticket the desk made of each problem and notices when one is closed. */
  private async followTickets(): Promise<void> {
    let changed = false;
    for (const c of this.open()) {
      const [ticket] = c.ticketId
        ? await run<{ id: string; status: string }>(this.services.graph, C8_CANONICAL, { issueId: c.ticketId })
        : await run<{ id: string; status: string; title: string }>(this.services.graph, SIM3_TICKET_OF_MESSAGE, { messageId: c.messageId });
      if (!ticket) continue;
      const closedNow = isClosed(ticket.status) && !isClosed(c.ticketStatus);
      if (ticket.id !== c.ticketId || ticket.status !== c.ticketStatus) changed = true;
      c.ticketId = ticket.id;
      c.ticketStatus = ticket.status;
      if ("title" in ticket) c.ticketTitle = String(ticket.title);
      // Closed from the desk or by a merged fix: the teacher goes and tries it.
      if (closedNow && (c.state === "waiting_reply" || c.state === "waiting_fix")) {
        c.state = "checking";
        c.checkAt = Date.now() + between(this.pace.checking);
      }
    }
    if (changed) await this.save();
  }

  /** The teachers answer what Ednovax just said. */
  private async answer(): Promise<void> {
    const said = this.unanswered.splice(0);
    const open = this.open();
    const fallback: Reply[] = open.length ? [{ teacher: open.at(-1)!.teacher, problem: open.at(-1)!.problemId, text: "Okay, thank you.", outcome: "answered" }] : [];
    const { replies } = await this.services.llm
      .json<{ replies?: Reply[] }>("fast", prompt("teachers"), {
        task: "respond",
        school: `${this.script.name}, ${this.script.city}`,
        people: this.script.teachers,
        problems: open.map((c) => this.describe(c)),
        conversation: this.context(),
        new_from_ednovax: said.map((line) => `${line.by}: ${line.text}`),
      })
      .catch(() => ({ replies: fallback }));

    const now = Date.now();
    const touched = new Set<SchoolCase>();
    for (const reply of (replies ?? []).slice(0, 2)) {
      const teacher = this.script.teachers.find((t) => t.key === reply.teacher);
      if (!teacher || !reply.text?.trim()) continue;
      await this.say(teacher, reply.text.trim(), Boolean(reply.photo));
      const c = open.find((o) => o.problemId === reply.problem) ?? open.find((o) => o.teacher === teacher.key);
      if (!c) continue;
      touched.add(c);
      c.nudges = 0;
      if (reply.outcome === "satisfied") {
        c.state = "settled";
      } else if (reply.outcome === "will_check") {
        c.state = "checking";
        c.checkAt = now + between(this.pace.checking);
      } else if (c.state === "waiting_reply") {
        c.state = "waiting_fix";
      }
    }
    // Ednovax spoke, so nobody chases for a while, even about problems nobody answered.
    for (const c of open) c.lastActivityAt = now;
    await this.save();
  }

  /** A teacher tries again after a fix (or an answer) and says how it went. */
  private async tryTheFix(c: SchoolCase): Promise<void> {
    const problem = this.problem(c.problemId);
    const purpose: Purpose = problem.kind !== "bug" ? "satisfied" : problem.failsFirstFix && c.fixAttempts === 0 ? "still_broken" : "fixed";
    c.fixAttempts++;
    await this.say(this.teacher(c.teacher), await this.write(c.teacher, problem, purpose));
    c.state = purpose === "still_broken" ? "waiting_fix" : "settled";
    c.checkAt = undefined;
    c.nudges = 0;
    c.lastActivityAt = Date.now();
    await this.save();
  }

  /** Chases the problem that has waited longest past its limit (one message per step, so it never floods). */
  private async chaseOne(now: number): Promise<void> {
    const overdue = this.open().find(
      (c) =>
        c.nudges < 2 &&
        ((c.state === "waiting_reply" && now - c.lastActivityAt >= this.pace.nudge) || (c.state === "waiting_fix" && now - c.lastActivityAt >= this.pace.update)),
    );
    if (!overdue) return;
    const principal = this.script.teachers.find((t) => t.job === "Principal");
    const escalate = overdue.state === "waiting_reply" && overdue.nudges === 1 && principal && principal.key !== overdue.teacher;
    const purpose: Purpose = overdue.state === "waiting_fix" ? "update" : escalate ? "escalate" : "nudge";
    const who = escalate ? principal.key : overdue.teacher;
    await this.say(this.teacher(who), await this.write(who, this.problem(overdue.problemId), purpose, Math.round((now - overdue.reportedAt) / MINUTE)));
    overdue.nudges++;
    overdue.lastActivityAt = now;
    await this.save();
  }

  private async report(): Promise<void> {
    this.reportNow = false;
    const problem = this.script.problems[this.state.nextProblem];
    if (!problem) return;
    this.state.nextProblem++;
    const teacher = this.teacher(problem.by);
    const messageId = await this.say(teacher, await this.write(teacher.key, problem, "report"));
    const now = Date.now();
    this.state.cases.push({ problemId: problem.id, teacher: teacher.key, state: "waiting_reply", reportedAt: now, messageId, lastActivityAt: now, nudges: 0, fixAttempts: 0 });
    this.nextReportAt = now + this.pace.betweenReports;
    await this.save();
  }

  /** Small talk, which the desk should recognise and ignore. */
  private async chatter(): Promise<void> {
    this.nextChatterAt = Date.now() + between(this.pace.chatter);
    const teacher = pick(this.script.teachers.filter((t) => t.job !== "Principal"));
    await this.say(teacher, pick(this.script.chatter));
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async write(teacherKey: string, problem: SchoolProblem, purpose: Purpose, waitedMinutes?: number): Promise<string> {
    const fallback = purpose === "report" ? problem.opening : FALLBACK[purpose];
    const result = await this.services.llm
      .json<{ text?: string }>("fast", prompt("teachers"), {
        task: "write",
        school: `${this.script.name}, ${this.script.city}`,
        teacher: this.teacher(teacherKey),
        purpose,
        problem: { id: problem.id, kind: problem.kind, situation: problem.situation, facts: problem.details, raised_by: this.teacher(problem.by).name },
        ...(waitedMinutes !== undefined ? { waited_minutes: waitedMinutes } : {}),
        conversation: this.context(),
      })
      .catch(() => undefined);
    return result?.text?.trim() || fallback;
  }

  private async say(teacher: Teacher, text: string, hasMedia = false): Promise<string> {
    const messageId = await this.services.post(teacher, text, hasMedia);
    this.remember({ by: teacher.name, text: hasMedia ? `${text} [photo]` : text });
    return messageId;
  }

  private remember(line: Line): void {
    this.state.transcript = [...this.state.transcript, line].slice(-TRANSCRIPT_LINES);
  }

  private context(): string[] {
    return this.state.transcript.slice(-CONTEXT_LINES).map((line) => `${line.by}: ${line.text}`);
  }

  private describe(c: SchoolCase) {
    const problem = this.problem(c.problemId);
    return { id: problem.id, raised_by: c.teacher, kind: problem.kind, situation: problem.situation, facts: problem.details, stands: c.state };
  }

  private open(): SchoolCase[] {
    return this.state.cases.filter((c) => c.state !== "settled");
  }

  private problem(id: string): SchoolProblem {
    return this.script.problems.find((p) => p.id === id)!;
  }

  private teacher(key: string): Teacher {
    return this.script.teachers.find((t) => t.key === key)!;
  }

  private async save(): Promise<void> {
    this.state.live = this.running;
    await run(this.services.graph, SIM1_SAVE, { stateJson: JSON.stringify(this.state) });
    this.services.changed?.();
  }
}

const isClosed = (status: string | undefined) => status === "resolved" || status === "possibly_resolved";
const between = ([min, max]: readonly [number, number]) => min + Math.random() * (max - min);
const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];
