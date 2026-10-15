/**
 * A morning in Ednovax's central support hub: staff forward messages from several schools into one
 * WhatsApp group. Each line shows a different way the desk works out which client it's about.
 * (Cast keys are Ednovax staff; everyone quoted is fictional.)
 */
export interface HubLine {
  sender: string;
  text: string;
}

export const HUB_STORY: HubLine[] = [
  // Forwarded with the client written in: routed by name.
  { sender: "ngozi", text: "Mrs Okafor (Royal Academy): the JSS2 broadsheet is showing the wrong class averages" },
  // Small talk: not about any client.
  { sender: "ngozi", text: "Good morning team 🙏🏾" },
  // A staff member names the client: routed by name, and stays the staff member's own words.
  { sender: "tunde", text: "Looking at the Apex receipts issue again, Mr Femi says the old amounts are back" },
  // Forwarded with only the person's name: routed because she is a known contact at one school.
  { sender: "ngozi", text: "Forwarded: Mrs Grace Danjuma: the new students are still not in the class lists" },
  // Bracketed client tag.
  { sender: "ngozi", text: "[Bright Future] Mr Chidi: when will we be able to export results to Excel?" },
  // A follow-up with no name: the same person's thread (or the model) carries it to Bright Future.
  { sender: "ngozi", text: "He says the board meeting is on Friday" },
  // Nothing says which school: waits for a person to route it.
  { sender: "ngozi", text: "A school called about fee reminders not sending to parents" },
];
