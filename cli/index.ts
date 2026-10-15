/**
 * Loopkeeper chat CLI: write into the (simulated) WhatsApp group and control the live chat.
 *
 *   npm run chat
 *   npm run chat -- --project ednovax --url http://localhost:8787
 *
 * Type "help" for commands, or just "chidi: the timer is not showing" to speak as someone.
 */
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { LoopkeeperApi } from "./api.js";
import { COMMANDS, type Session } from "./commands.js";
import { color, renderEvent } from "./render.js";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: process.env.LOOPKEEPER_URL ?? "http://127.0.0.1:8787" },
    project: { type: "string" },
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

/** Prints above the prompt without breaking what the user is typing. */
function print(line = ""): void {
  process.stdout.write(`\r\x1b[K${line}\n`);
  rl.prompt(true);
}

let stopFollowing: (() => void) | undefined;

const session: Session = {
  api,
  project: values.project ?? "",
  groupId: undefined,
  showSmallTalk: true,
  print,
  follow: () => {
    stopFollowing?.();
    stopFollowing = api.follow(
      session.project,
      (event) => {
        const line = renderEvent(event, session.showSmallTalk);
        if (line) print(line);
      },
      () => print(color.coral("  Lost the connection to Loopkeeper. Restart the CLI once the server is back.")),
    );
    rl.setPrompt(`${color.lilac(session.project)} ${color.faint("›")} `);
  },
};

async function start(): Promise<void> {
  const status = await api.get<{ hasApiKey: boolean; githubConfigured: boolean; defaultProject: string }>("/status");
  session.project ||= status.defaultProject;

  console.log(`\n  ${color.lilac("◯")}${color.sunflower("•")} ${color.bold("Loopkeeper chat")}  ${color.faint(`connected to ${values.url}`)}`);
  if (!status.hasApiKey) console.log(color.sunflower("  No Groq API key yet: messages arrive but won't be understood. Add one in the dashboard under Settings."));
  console.log(color.faint('  Type "help" for commands, or speak as someone:  chidi: the timer is not showing\n'));

  session.follow();
  rl.prompt();

  rl.on("line", async (input) => {
    const text = input.trim();
    if (!text) return rl.prompt();
    if (text === "quit" || text === "exit") return rl.close();

    const [name, ...rest] = text.split(/\s+/);
    const command = COMMANDS[name.toLowerCase()];
    try {
      if (command) await command.run(rest.join(" "), session);
      else if (/^[^:]{1,40}:\s*\S/.test(text)) await COMMANDS.say.run(text, session);
      else print(color.coral(`  Unknown command "${name}". Type "help".`));
    } catch (error) {
      print(color.coral(`  ${(error as Error).message}`));
    }
    rl.prompt();
  });

  rl.on("close", () => {
    stopFollowing?.();
    console.log(color.faint("\n  Bye.\n"));
    process.exit(0);
  });
}

start().catch((error: Error) => {
  console.error(color.coral(`\n  ${error.message}\n`));
  process.exit(1);
});
