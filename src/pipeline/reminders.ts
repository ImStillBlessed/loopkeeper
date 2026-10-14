import type { Graph } from "falkordb";
import { C11_FOLLOWUPS_TO_REMIND, run, W14_REMINDER } from "../graph/queries.js";
import { stableId } from "../ingest/ids.js";
import { formatLagosDay, HOUR } from "./time.js";

export interface SentReminder {
  kind: "due_soon" | "overdue";
  text: string;
}

const DUE_SOON_WINDOW = 24 * HOUR;

/**
 * Finds promises that are due soon or overdue at `now` and writes a reminder for each.
 * The Reminder node is what stops the bot from nagging twice about the same thing.
 * `now` is the chat's clock, so a replayed chat gets its reminders at the right moments.
 */
export async function sendDueReminders(graph: Graph, now: number): Promise<SentReminder[]> {
  const sent: SentReminder[] = [];
  const windows = [
    { kind: "overdue" as const, from: 0, to: now },
    { kind: "due_soon" as const, from: now, to: now + DUE_SOON_WINDOW },
  ];

  for (const window of windows) {
    const due = await run<{ id: string; text: string; dueAt: number; owner: string }>(graph, C11_FOLLOWUPS_TO_REMIND, window);
    for (const followUp of due) {
      const text = reminderText(window.kind, followUp.owner, followUp.text, followUp.dueAt);
      await run(graph, W14_REMINDER, {
        id: stableId("rem", [followUp.id, window.kind]),
        followUpId: followUp.id,
        kind: window.kind,
        ts: now,
        text,
      });
      sent.push({ kind: window.kind, text });
    }
  }
  return sent;
}

/** Short, friendly and jargon-free: these are posted into a group full of teachers. */
function reminderText(kind: "due_soon" | "overdue", owner: string, task: string, dueAt: number): string {
  const name = owner.replace(/^(Mr|Mrs|Miss|Ms|Mallam|Dr)\.?\s+/i, "");
  const firstName = name.split(" ")[0];
  const what = task.charAt(0).toLowerCase() + task.slice(1);
  return kind === "overdue"
    ? `Gentle reminder 🙏🏾 ${firstName}, "${what}" was due ${formatLagosDay(dueAt)}. Any update?`
    : `Hi ${firstName} 👋🏾 just a reminder: "${what}" is due ${formatLagosDay(dueAt)}.`;
}
