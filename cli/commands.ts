import type { LoopkeeperApi } from "./api.js";
import { color, day } from "./render.js";

export interface Session {
  api: LoopkeeperApi;
  /** The client your messages, questions and group commands go to. */
  client: string;
  groupId: string | undefined;
  /** The Ask conversation follow-ups continue; undefined starts a new one. */
  conversationId?: string;
  showSmallTalk: boolean;
  print: (line?: string) => void;
  /** Reload the client names used to label the feed. */
  refreshClients: () => Promise<void>;
}

interface Command {
  usage: string;
  help: string;
  run: (args: string, session: Session) => Promise<void>;
}

interface Client {
  id: string;
  name: string;
  plan: string;
  agentName: string;
  products: string[];
}

interface Group {
  id: string;
  name: string;
  source: string;
  seen: number;
  used: number;
}

const c = (session: Session) => `/clients/${session.client}`;

interface TeachersView {
  cases: Array<{ teacher: string; situation: string; state: string; ticketId: string | null }>;
  next: { teacher: string } | null;
}

const CASE_STATE: Record<string, string> = {
  waiting_reply: "waiting for a reply",
  waiting_fix: "waiting for a fix",
  checking: "trying the fix",
  settled: "happy",
};

async function findClient(session: Session, query: string): Promise<Client | undefined> {
  const clients = await session.api.get<Client[]>("/clients");
  const needle = query.trim().toLowerCase();
  return clients.find((cl) => cl.id === needle) ?? clients.find((cl) => cl.name.toLowerCase().includes(needle));
}

export const COMMANDS: Record<string, Command> = {
  help: {
    usage: "help",
    help: "Show this list",
    run: async (_args, session) => {
      session.print(color.bold("\n  Reply in the current client's group"));
      line(session, "say");
      session.print(color.faint("  Shortcut: anything that isn't a command is sent as your reply"));
      session.print(color.bold("\n  The demo school (its teachers are played by the model)"));
      for (const name of ["live", "pause", "next", "teachers", "start-over", "time", "smalltalk", "status"]) line(session, name);
      session.print(color.bold("\n  Clients, groups and GitHub"));
      for (const name of ["clients", "use", "new-client", "groups", "group", "new-group", "people", "reset", "repos", "connect", "sync", "github"]) line(session, name);
      session.print(color.bold("\n  Ask"));
      for (const name of ["ask", "new-chat"]) line(session, name);
      session.print(color.faint("\n  quit to leave\n"));
    },
  },

  say: {
    usage: "say <message>",
    help: "Reply in the group as yourself",
    run: async (args, session) => {
      if (!args.trim()) return session.print(color.coral("  Use: say <message>"));
      await session.api.post(`${c(session)}/reply`, { text: args });
    },
  },

  live: {
    usage: "live",
    help: "Go live: the teachers start raising problems and answering you",
    run: async (_args, session) => {
      await session.api.post("/live/start");
      session.print(color.mint('  ● Live. The teachers react to what you say and do. Type "pause" to stop.'));
    },
  },
  next: {
    usage: "next",
    help: "A teacher raises their next problem now",
    run: async (_args, session) => {
      const { teacher } = await session.api.post<{ teacher: string }>(`${c(session)}/teachers/next`);
      session.print(color.faint(`  ${teacher} is writing…`));
    },
  },
  teachers: {
    usage: "teachers",
    help: "Who at the school is waiting on what",
    run: async (_args, session) => {
      const view = await session.api.get<TeachersView>(`${c(session)}/teachers`);
      if (view.cases.length === 0) session.print(color.muted("  Nobody has raised anything yet."));
      for (const item of view.cases) {
        session.print(`  ${color.bold(item.teacher)}  ${color.sunflower(CASE_STATE[item.state] ?? item.state)}  ${color.faint(item.ticketId ?? "no ticket yet")}`);
        session.print(color.faint(`    ${item.situation}`));
      }
      session.print(color.faint(view.next ? `  Next up: ${view.next.teacher}` : "  No more problems to raise."));
    },
  },
  "start-over": {
    usage: "start-over",
    help: "Clear every chat and ticket; the teachers start again (leads and admins)",
    run: async (_args, session) => {
      await session.api.post("/demo/start-over");
      session.print(color.muted("  Started over. Type \"live\" when you're ready."));
    },
  },
  pause: {
    usage: "pause",
    help: "The teachers go quiet",
    run: async (_args, session) => {
      await session.api.post("/live/stop");
      session.print(color.muted("  Paused."));
    },
  },
  time: {
    usage: "time +2d | +6h",
    help: "Fast-forward the chat clock (promises and SLAs fall due)",
    run: async (args, session) => {
      const match = /^\+?(\d+(?:\.\d+)?)\s*([dh])$/i.exec(args.trim());
      if (!match) return session.print(color.coral("  Use: time +2d or time +6h"));
      const hours = Number(match[1]) * (match[2].toLowerCase() === "d" ? 24 : 1);
      const state = await session.api.post<{ clock: number }>("/clock/advance", { hours });
      session.print(color.sunflower(`  ⏩ Chat time is now ${day(state.clock)}`));
    },
  },
  smalltalk: {
    usage: "smalltalk",
    help: "Show or hide small talk in this terminal",
    run: async (_args, session) => {
      session.showSmallTalk = !session.showSmallTalk;
      session.print(color.muted(`  Small talk ${session.showSmallTalk ? "shown" : "hidden"}.`));
    },
  },
  status: {
    usage: "status",
    help: "What Loopkeeper has read for the current client",
    run: async (_args, session) => {
      const stats = await session.api.get<{ seen: number; ignored: number; used: number }>(`${c(session)}/stats`);
      const live = await session.api.get<{ running: boolean; clock: number }>("/live");
      session.print(`  ${color.bold(session.client)}  ${live.running ? color.mint("● live") : color.muted("paused")}`);
      session.print(`  ${stats.seen} messages read, ${stats.ignored} small talk, ${stats.used} used`);
      session.print(`  Chat time: ${day(live.clock)}`);
    },
  },

  clients: {
    usage: "clients",
    help: "The clients you can see",
    run: async (_args, session) => {
      for (const client of await session.api.get<Client[]>("/clients")) {
        const marker = client.id === session.client ? color.mint("●") : " ";
        session.print(`  ${marker} ${color.bold(client.name)}  ${color.faint(`${client.id}, ${client.plan}, agent ${client.agentName || "none"}, ${client.products.join(" + ")}`)}`);
      }
    },
  },
  use: {
    usage: "use <client>",
    help: "Switch client (by id or part of the name)",
    run: async (args, session) => {
      const client = await findClient(session, args);
      if (!client) return session.print(color.coral(`  No client matching "${args.trim()}". Try "clients".`));
      session.client = client.id;
      session.groupId = undefined;
      session.conversationId = undefined;
      session.print(color.mint(`  Now working on ${client.name}.`));
    },
  },
  "new-client": {
    usage: "new-client <name>",
    help: "Add a school client using Ednovax Schools (leads and admins)",
    run: async (args, session) => {
      const client = await session.api.post<Client>("/clients", { name: args, type: "school", plan: "standard", city: "", products: ["sms_v1"], agentId: "" });
      await session.api.post(`/clients/${client.id}/groups`, { name: `${client.name} × Ednovax`, source: "simulator" });
      session.client = client.id;
      await session.refreshClients();
      session.print(color.mint(`  Added ${client.name} with its own graph and WhatsApp group. You're on it now.`));
    },
  },
  groups: {
    usage: "groups",
    help: "The current client's WhatsApp groups",
    run: async (_args, session) => {
      const groups = await session.api.get<Group[]>(`${c(session)}/groups`);
      groups.forEach((group, index) => {
        session.print(`  ${index + 1}. ${group.name}  ${color.faint(`${group.source}, ${group.seen ?? 0} messages`)}`);
      });
    },
  },
  group: {
    usage: "group <number or name>",
    help: "(Groups are chosen per client; messages go to its first group)",
    run: async (_args, session) => {
      session.print(color.muted("  Messages go to the client's first group. Use the dashboard to manage groups."));
    },
  },
  "new-group": {
    usage: "new-group <name>",
    help: "Add another simulated WhatsApp group to the current client",
    run: async (args, session) => {
      await session.api.post(`${c(session)}/groups`, { name: args, source: "simulator" });
      session.print(color.mint(`  Added "${args}".`));
    },
  },
  people: {
    usage: "people",
    help: "Who is in the current client's groups",
    run: async (_args, session) => {
      const { people } = await session.api.get<{ people: Array<{ name: string; role: string }> }>(`${c(session)}/people`);
      for (const person of people) session.print(`  ${person.name}  ${color.faint(person.role)}`);
    },
  },
  reset: {
    usage: "reset",
    help: "Forget everything learned for the current client (keeps groups and contacts)",
    run: async (_args, session) => {
      await session.api.post(`${c(session)}/reset`);
      session.print(color.muted("  Cleared."));
    },
  },

  repos: {
    usage: "repos",
    help: "GitHub repositories, by product",
    run: async (_args, session) => {
      const { githubConfigured, repos } = await session.api.get<{ githubConfigured: boolean; repos: Array<{ id: string; productName: string; files: number; pullRequests: number; commits: number }> }>("/repos");
      if (!githubConfigured) session.print(color.sunflower("  No GitHub token yet. Add one in the dashboard under Settings."));
      if (repos.length === 0) return session.print(color.muted("  No repositories yet. Try: connect owner/name sms_v1"));
      for (const repo of repos) session.print(`  ${color.lilac(repo.id)}  ${repo.productName}: ${repo.files} files, ${repo.pullRequests} pull requests, ${repo.commits} commits`);
    },
  },
  connect: {
    usage: "connect <owner/name> <product>",
    help: "Connect a GitHub repo to a product (read-only)",
    run: async (args, session) => {
      const [repo, product = "sms_v1"] = args.trim().split(/\s+/);
      session.print(color.faint(`  Reading ${repo} into ${product}…`));
      const result = await session.api.post<{ repo: string; files: number; features: number; owners: number; featureSource: string }>("/repos", { repo, product });
      session.print(color.mint(`  Connected ${result.repo}: ${result.files} files, ${result.features} features (from ${result.featureSource}), ${result.owners} code owners.`));
    },
  },
  sync: {
    usage: "sync",
    help: "Pick up new pull requests and pushes now",
    run: async (_args, session) => {
      await session.api.post("/repos/sync");
      session.print(color.mint("  Synced."));
    },
  },
  github: {
    usage: "github <ticket id>",
    help: "Open a GitHub issue for one of the current client's tickets",
    run: async (args, session) => {
      const created = await session.api.post<{ number: number; url: string }>(`${c(session)}/issues/${args.trim()}/github`);
      session.print(color.mint(`  Opened #${created.number}: ${created.url}`));
    },
  },

  ask: {
    usage: "ask <question>",
    help: "Ask about the current client; follow-ups keep the conversation",
    run: async (args, session) => {
      session.print(color.faint("  Following the threads…"));
      const { conversationId, turn } = await session.api.post<{ conversationId: string; turn: { answer: { answer: string; sources: Array<{ messageId: string; sender: string }> } } }>(
        `${c(session)}/ask`,
        { question: args, conversationId: session.conversationId },
      );
      session.conversationId = conversationId;
      const answer = turn.answer;
      const numbers = new Map(answer.sources.map((s, i) => [s.messageId, i + 1]));
      const text = answer.answer.replace(/\[(msg_[a-f0-9]+)\]/g, (_, id: string) => (numbers.has(id) ? color.mint(`[${numbers.get(id)}]`) : ""));
      session.print(`\n${text.split("\n").map((l) => `  ${l}`).join("\n")}\n`);
      answer.sources.forEach((s, i) => session.print(color.faint(`  [${i + 1}] ${s.sender}`)));
      session.print(color.faint('  (follow-ups continue this conversation; "new-chat" starts another)'));
    },
  },
  "new-chat": {
    usage: "new-chat",
    help: "Start a new Ask conversation",
    run: async (_args, session) => {
      session.conversationId = undefined;
      session.print(color.muted("  Next question starts a new conversation."));
    },
  },
};

function line(session: Session, name: string) {
  const command = COMMANDS[name];
  session.print(`  ${color.sunflower(command.usage.padEnd(34))} ${color.muted(command.help)}`);
}
