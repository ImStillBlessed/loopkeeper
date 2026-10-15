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

const STORIES: Record<string, string> = {
  S1: "Three schools report scores not saving, in different words (a cross-client pattern)",
  S2: "CBT timer bug: report → screenshot → fix promised → \"it's working now\"",
  S3: "An admin promises the student list by Thursday, and never sends it",
  S4: "A school agrees to move its mock exam to Friday",
  S5: "Feature request: export results to Excel",
  S6: "Login is slow, then fine 20 minutes later",
  S7: "\"It's working now\" from someone with two open issues",
  S8: "The lecture centre's QR attendance breaks and gets fixed",
};

const c = (session: Session) => `/clients/${session.client}`;

async function send(session: Session, body: Record<string, unknown>) {
  const sent = await session.api.post<{ sender: string; text: string }>(`${c(session)}/send`, body);
  session.print(color.faint(`  → sent as ${sent.sender}`));
}

/** issue, greeting, question, promise, fixed: a ready-made message in the current client's group. */
const prepared = (kind: string, help: string): Command => ({
  usage: `${kind} [person]`,
  help,
  run: (args, session) => send(session, { kind, sender: args || undefined }),
});

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
      session.print(color.bold("\n  Talk in the current client's group"));
      for (const name of ["say", "issue", "greet", "question", "promise", "fixed"]) line(session, name);
      session.print(color.faint("  Shortcut: just type  chidi: the timer is not showing"));
      session.print(color.bold("\n  Control the live chat (all clients)"));
      for (const name of ["story", "live", "pause", "time", "smalltalk", "status"]) line(session, name);
      session.print(color.bold("\n  Clients, groups and GitHub"));
      for (const name of ["clients", "use", "new-client", "groups", "group", "new-group", "people", "reset", "repos", "connect", "sync", "github"]) line(session, name);
      session.print(color.bold("\n  Ask"));
      for (const name of ["ask", "new-chat"]) line(session, name);
      session.print(color.faint("\n  quit to leave\n"));
    },
  },

  say: {
    usage: "say <person>: <message>",
    help: "Send anything, as anyone (a new name joins the group)",
    run: async (args, session) => {
      const match = /^(.+?):\s*(.+)$/.exec(args);
      if (!match) return session.print(color.coral("  Use: say <person>: <message>"));
      await send(session, { sender: match[1], text: match[2] });
    },
  },
  issue: prepared("issue", "Someone at the client reports a problem"),
  greet: { ...prepared("greeting", "Small talk: a greeting, prayer or forward"), usage: "greet [person]" },
  question: prepared("question", "Someone at the client asks how to do something"),
  promise: prepared("promise", "Someone from Ednovax promises to do something"),
  fixed: prepared("fixed", "Someone at the client says it's working now"),

  story: {
    usage: "story <S1–S8>",
    help: "Play a storyline into whichever clients it involves",
    run: async (args, session) => {
      const scenario = args.trim().toUpperCase();
      if (!STORIES[scenario]) {
        for (const [id, text] of Object.entries(STORIES)) session.print(`  ${color.sunflower(id)}  ${text}`);
        return;
      }
      await session.api.post("/live/story", { scenario });
      session.print(color.faint(`  Playing ${scenario}: ${STORIES[scenario]}`));
    },
  },
  live: {
    usage: "live [seconds between messages]",
    help: "Go live: every client's group starts chatting on its own",
    run: async (args, session) => {
      const seconds = Number(args) || 2.5;
      await session.api.post("/live/start", { paceMs: seconds * 1000 });
      session.print(color.mint(`  ● Live. A message every ~${seconds}s. Type "pause" to stop.`));
    },
  },
  pause: {
    usage: "pause",
    help: "Stop the simulated groups",
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
    help: "Who you can speak as in the current client's group",
    run: async (_args, session) => {
      const { cast } = await session.api.get<{ cast: Array<{ key: string; name: string; role: string }> }>(`${c(session)}/people`);
      for (const person of cast) session.print(`  ${color.sky(person.key.padEnd(8))} ${person.name}  ${color.faint(person.role)}`);
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
