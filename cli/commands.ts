import type { LoopkeeperApi } from "./api.js";
import { color, day } from "./render.js";

export interface Session {
  api: LoopkeeperApi;
  project: string;
  groupId: string | undefined;
  showSmallTalk: boolean;
  print: (line?: string) => void;
  /** (Re)connect the live feed after switching project. */
  follow: () => void;
}

interface Command {
  usage: string;
  help: string;
  run: (args: string, session: Session) => Promise<void>;
}

interface Group {
  id: string;
  name: string;
  source: string;
  seen: number;
  used: number;
}

const STORIES: Record<string, string> = {
  S1: "Three schools report scores not saving, in different words",
  S2: "CBT timer bug: report → screenshot → fix promised → \"it's working now\"",
  S3: "An admin promises the student list by Thursday, and never sends it",
  S4: "A school agrees to move its mock exam to Friday",
  S5: "Feature request: export results to Excel",
  S6: "Login is slow, then fine 20 minutes later",
  S7: "\"It's working now\" from someone with two open issues",
};

const p = (session: Session) => `/projects/${session.project}`;

async function send(session: Session, body: Record<string, unknown>) {
  const sent = await session.api.post<{ sender: string; text: string }>(`${p(session)}/live/send`, { groupId: session.groupId, ...body });
  session.print(color.faint(`  → sent as ${sent.sender}`));
}

/** issue, greeting, question, promise, fixed: a ready-made message, optionally from a named person. */
const prepared = (kind: string, help: string): Command => ({
  usage: `${kind} [person]`,
  help,
  run: (args, session) => send(session, { kind, sender: args || undefined }),
});

export const COMMANDS: Record<string, Command> = {
  help: {
    usage: "help",
    help: "Show this list",
    run: async (_args, session) => {
      session.print(color.bold("\n  Talk in the group"));
      for (const name of ["say", "issue", "greet", "question", "promise", "fixed", "story"]) line(session, name);
      session.print(color.faint("  Shortcut: just type  chidi: the timer is not showing"));
      session.print(color.bold("\n  Control the live chat"));
      for (const name of ["live", "pause", "time", "smalltalk", "status", "reset"]) line(session, name);
      session.print(color.bold("\n  Projects, groups and GitHub"));
      for (const name of ["projects", "use", "new-project", "groups", "group", "new-group", "people", "repos", "connect", "sync", "github", "ask"]) line(session, name);
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
  issue: prepared("issue", "A teacher reports a problem"),
  greet: { ...prepared("greeting", "Small talk: a greeting, prayer or forward"), usage: "greet [person]" },
  question: prepared("question", "A teacher asks how to do something"),
  promise: prepared("promise", "Someone from the team promises to do something"),
  fixed: prepared("fixed", "A teacher says it's working now"),

  story: {
    usage: "story <S1–S7>",
    help: "Play one scripted storyline into the group",
    run: async (args, session) => {
      const scenario = args.trim().toUpperCase();
      if (!STORIES[scenario]) {
        for (const [id, text] of Object.entries(STORIES)) session.print(`  ${color.sunflower(id)}  ${text}`);
        return;
      }
      await session.api.post(`${p(session)}/live/story`, { groupId: session.groupId, scenario });
      session.print(color.faint(`  Playing ${scenario}: ${STORIES[scenario]}`));
    },
  },

  live: {
    usage: "live [seconds between messages]",
    help: "Go live: the simulated group starts chatting on its own",
    run: async (args, session) => {
      const seconds = Number(args) || 2.5;
      await session.api.post(`${p(session)}/live/start`, { groupId: session.groupId, paceMs: seconds * 1000 });
      session.print(color.mint(`  ● Live. A message every ~${seconds}s. Type "pause" to stop.`));
    },
  },
  pause: {
    usage: "pause",
    help: "Stop the simulated group",
    run: async (_args, session) => {
      await session.api.post(`${p(session)}/live/stop`);
      session.print(color.muted("  Paused."));
    },
  },
  time: {
    usage: "time +2d | +6h",
    help: "Fast-forward the chat clock (promises fall due, reminders go out)",
    run: async (args, session) => {
      const match = /^\+?(\d+(?:\.\d+)?)\s*([dh])$/i.exec(args.trim());
      if (!match) return session.print(color.coral("  Use: time +2d or time +6h"));
      const hours = Number(match[1]) * (match[2].toLowerCase() === "d" ? 24 : 1);
      const stats = await session.api.post<{ clock: number }>(`${p(session)}/clock/advance`, { hours });
      session.print(color.sunflower(`  ⏩ Chat time is now ${day(stats.clock)}`));
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
    help: "What Loopkeeper has read so far",
    run: async (_args, session) => {
      const stats = await session.api.get<{ seen: number; ignored: number; used: number; clock: number; live: boolean }>(`${p(session)}/stats`);
      session.print(`  ${color.bold(session.project)}  ${stats.live ? color.mint("● live") : color.muted("paused")}`);
      session.print(`  ${stats.seen} messages read, ${stats.ignored} small talk, ${stats.used} used`);
      session.print(`  Chat time: ${day(stats.clock)}`);
    },
  },
  reset: {
    usage: "reset",
    help: "Forget everything read so far (keeps groups, repos and people)",
    run: async (_args, session) => {
      await session.api.post(`${p(session)}/reset`);
      session.print(color.muted("  Cleared."));
    },
  },

  projects: {
    usage: "projects",
    help: "List projects",
    run: async (_args, session) => {
      const projects = await session.api.get<Array<{ id: string; name: string; groups: number; repos: number }>>("/projects");
      for (const project of projects) {
        const marker = project.id === session.project ? color.mint("●") : " ";
        session.print(`  ${marker} ${color.bold(project.id)}  ${project.name}  ${color.faint(`${project.groups} groups, ${project.repos} repos`)}`);
      }
    },
  },
  use: {
    usage: "use <project>",
    help: "Switch project",
    run: async (args, session) => {
      const projects = await session.api.get<Array<{ id: string }>>("/projects");
      if (!projects.some((project) => project.id === args.trim())) return session.print(color.coral(`  No project "${args.trim()}". Try "projects".`));
      session.project = args.trim();
      session.groupId = undefined;
      session.follow();
      session.print(color.mint(`  Now in ${session.project}.`));
    },
  },
  "new-project": {
    usage: "new-project <name>",
    help: "Create a project with one simulated WhatsApp group",
    run: async (args, session) => {
      const project = await session.api.post<{ id: string }>("/projects", { name: args });
      const group = await session.api.post<{ id: string }>(`/projects/${project.id}/groups`, { name: "Support group", source: "simulator" });
      session.project = project.id;
      session.groupId = group.id;
      session.follow();
      session.print(color.mint(`  Created ${project.id} with a "Support group". You're in it now.`));
    },
  },
  groups: {
    usage: "groups",
    help: "List this project's WhatsApp groups",
    run: async (_args, session) => {
      const groups = await session.api.get<Group[]>(`${p(session)}/groups`);
      groups.forEach((group, index) => {
        const marker = group.id === session.groupId || (!session.groupId && index === 0) ? color.mint("●") : " ";
        session.print(`  ${marker} ${index + 1}. ${group.name}  ${color.faint(`${group.source}, ${group.seen ?? 0} messages`)}`);
      });
    },
  },
  group: {
    usage: "group <number or name>",
    help: "Choose which group your messages go to",
    run: async (args, session) => {
      const groups = await session.api.get<Group[]>(`${p(session)}/groups`);
      const chosen = groups[Number(args) - 1] ?? groups.find((g) => g.name.toLowerCase().includes(args.trim().toLowerCase()));
      if (!chosen) return session.print(color.coral("  No such group. Try \"groups\"."));
      session.groupId = chosen.id;
      session.print(color.mint(`  Talking in "${chosen.name}".`));
    },
  },
  "new-group": {
    usage: "new-group <name>",
    help: "Add another simulated WhatsApp group to this project",
    run: async (args, session) => {
      const group = await session.api.post<{ id: string }>(`${p(session)}/groups`, { name: args, source: "simulator" });
      session.groupId = group.id;
      session.print(color.mint(`  Added "${args}". Talking there now.`));
    },
  },
  people: {
    usage: "people",
    help: "Who you can speak as",
    run: async (_args, session) => {
      const { cast } = await session.api.get<{ cast: Array<{ key: string; name: string; role: string }> }>(`${p(session)}/people`);
      for (const person of cast) session.print(`  ${color.sky(person.key.padEnd(8))} ${person.name}  ${color.faint(person.role)}`);
    },
  },

  repos: {
    usage: "repos",
    help: "Connected GitHub repositories",
    run: async (_args, session) => {
      const { githubConfigured, repos } = await session.api.get<{ githubConfigured: boolean; repos: Array<{ id: string; files: number; pullRequests: number; commits: number }> }>(`${p(session)}/repos`);
      if (!githubConfigured) session.print(color.sunflower("  No GitHub token yet. Add one in the dashboard under Settings, Keys & models."));
      if (repos.length === 0) return session.print(color.muted("  No repositories yet. Try: connect owner/name"));
      for (const repo of repos) session.print(`  ${color.lilac(repo.id)}  ${repo.files} files, ${repo.pullRequests} pull requests, ${repo.commits} commits`);
    },
  },
  connect: {
    usage: "connect <owner/name>",
    help: "Connect a GitHub repo (read-only: files, owners, features)",
    run: async (args, session) => {
      session.print(color.faint("  Reading the repository…"));
      const result = await session.api.post<{ repo: string; files: number; features: number; owners: number; featureSource: string }>(`${p(session)}/repos`, { repo: args.trim() });
      session.print(color.mint(`  Connected ${result.repo}: ${result.files} files, ${result.features} features (from ${result.featureSource}), ${result.owners} code owners.`));
    },
  },
  sync: {
    usage: "sync",
    help: "Pick up new pull requests and pushes now",
    run: async (_args, session) => {
      await session.api.post(`${p(session)}/repos/sync`);
      session.print(color.mint("  Synced."));
    },
  },
  github: {
    usage: "github <issue id>",
    help: "Open a GitHub issue for a Loopkeeper issue",
    run: async (args, session) => {
      const created = await session.api.post<{ number: number; url: string }>(`${p(session)}/issues/${args.trim()}/github`);
      session.print(color.mint(`  Opened #${created.number}: ${created.url}`));
    },
  },
  ask: {
    usage: "ask <question>",
    help: "Ask Loopkeeper anything about this project",
    run: async (args, session) => {
      session.print(color.faint("  Following the threads…"));
      const answer = await session.api.post<{ answer: string; sources: Array<{ messageId: string; sender: string }> }>(`${p(session)}/ask`, { question: args });
      const numbers = new Map(answer.sources.map((s, i) => [s.messageId, i + 1]));
      const text = answer.answer.replace(/\[(msg_[a-f0-9]+)\]/g, (_, id: string) => (numbers.has(id) ? color.mint(`[${numbers.get(id)}]`) : ""));
      session.print(`\n${text.split("\n").map((l) => `  ${l}`).join("\n")}\n`);
      answer.sources.forEach((s, i) => session.print(color.faint(`  [${i + 1}] ${s.sender}`)));
    },
  },
};

function line(session: Session, name: string) {
  const command = COMMANDS[name];
  session.print(`  ${color.sunflower(command.usage.padEnd(34))} ${color.muted(command.help)}`);
}
