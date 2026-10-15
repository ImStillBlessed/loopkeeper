/**
 * Loopkeeper chat CLI: write into clients' (simulated) WhatsApp groups and control the live chat.
 *
 *   npm run chat
 *   npm run chat -- --client royal_academy --email ngozi@ednovax.demo --password ednovax-demo
 *
 * Logs in as the support lead by default (a demo account). Type "help" for commands,
 * or just "chidi: the timer is not showing" to speak as someone in the current client's group.
 */
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { LoopkeeperApi } from "./api.js";
import { COMMANDS, type Session } from "./commands.js";
import { color, renderEvent } from "./render.js";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: process.env.LOOPKEEPER_URL ?? "http://127.0.0.1:8787" },
    client: { type: "string" },
    email: { type: "string", default: process.env.LOOPKEEPER_EMAIL ?? "lead@ednovax.demo" },
    password: { type: "string", default: process.env.LOOPKEEPER_PASSWORD ?? "ednovax-demo" },
  },
});

const api = new LoopkeeperApi(values.url!);
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: (line: string) => {
    const names = Object.keys(COMMANDS);
    const hits = names.filter((name) => name.startsWith(line));
    return [hits.length ? hits : names, line];
  },
});

let closed = false;
let stopFollowing: (() => void) | undefined;

/** Prints above the prompt without breaking what the user is typing. */
function print(line = ""): void {
  process.stdout.write(`\r\x1b[K${line}\n`);
  if (!closed) rl.prompt(true);
}

/** Short client names, to label which group each live line came from. */
const clientNames = new Map<string, string>();

const session: Session = {
  api,
  client: values.client ?? "",
  groupId: undefined,
  showSmallTalk: true,
  print,
  refreshClients: async () => {
    for (const client of await api.get<Array<{ id: string; name: string }>>("/clients")) clientNames.set(client.id, client.name.split(" ")[0]);
  },
};

function showPrompt(): void {
  if (closed) return;
  rl.setPrompt(`${color.lilac(clientNames.get(session.client) ?? session.client)} ${color.faint("›")} `);
  rl.prompt();
}

async function handle(input: string): Promise<void> {
  const text = input.trim();
  if (!text) return;
  if (text === "quit" || text === "exit") return void rl.close();

  const [name, ...rest] = text.split(/\s+/);
  const command = COMMANDS[name.toLowerCase()];
  try {
    if (command) await command.run(rest.join(" "), session);
    else if (/^[^:]{1,40}:\s*\S/.test(text)) await COMMANDS.say.run(text, session);
    else print(color.coral(`  Unknown command "${name}". Type "help".`));
  } catch (error) {
    print(color.coral(`  ${(error as Error).message}`));
  }
  showPrompt();
}

async function start(): Promise<void> {
  const user = await api.logIn(values.email!, values.password!);
  await session.refreshClients();
  session.client ||= [...clientNames.keys()][0] ?? "";
  const status = await api.get<{ hasApiKey: boolean }>("/status");

  console.log(`\n  ${color.lilac("◯")}${color.sunflower("•")} ${color.bold("Ednovax support desk")}  ${color.faint(`${user.name} (${user.role}) at ${values.url}`)}`);
  if (!status.hasApiKey) console.log(color.sunflower("  No Anthropic API key yet: messages arrive but won't be understood. Add one in the dashboard under Settings."));
  console.log(color.faint(`  Working on ${session.client}. Type "help" for commands, or speak as someone:  chidi: the timer is not showing\n`));

  stopFollowing = api.follow(
    (event) => {
      const line = renderEvent(event, session.showSmallTalk);
      if (!line) return;
      const tag = event.clientId ? color.faint(`[${clientNames.get(event.clientId) ?? event.clientId}]`) : color.faint("[HQ]");
      print(`${tag}${line}`);
    },
    () => print(color.coral("  Lost the connection to Loopkeeper. Restart the CLI once the server is back.")),
  );
  showPrompt();
}

// Lines typed (or piped) before login finishes wait for it; then commands run one after another, in order.
let queue: Promise<void> = start().catch((error: Error) => {
  console.error(color.coral(`\n  ${error.message}\n`));
  process.exit(1);
});

rl.on("line", (input) => {
  queue = queue.then(() => handle(input));
});

rl.on("close", () => {
  // Input has ended (Ctrl+D, "quit", or the end of piped commands); finish what's queued, then leave.
  closed = true;
  void queue.then(() => {
    // Close the live stream before leaving; exiting with it open trips a Node assertion on Windows.
    stopFollowing?.();
    console.log(color.faint("\n  Bye.\n"));
    setTimeout(() => process.exit(0), 50);
  });
});
