/**
 * Four weeks of past support work for the demo clients, so the desk opens with real history:
 * resolved tickets for the analytics, a few open ones (some past their SLA), one client that needs
 * attention, and a problem three schools share right now.
 *
 * It's written straight into the graphs (see src/hq/history.ts): no language model is involved.
 * Every person and school here is fictional.
 */

export type Sentiment = "calm" | "concerned" | "frustrated";

export interface PastMessage {
  /** Minutes after the ticket was reported. */
  after: number;
  /** Cast key of the sender. */
  by: string;
  text: string;
  sentiment?: Sentiment;
}

export interface PastTicket {
  key: string;
  client: string;
  /** When it was reported: days ago and Lagos time of day. */
  daysAgo: number;
  at: string;
  /** For tickets from the last day: hours before now instead (so the demo looks the same at any time of day). */
  hoursAgo?: number;
  /** Flagged for the support lead. */
  escalated?: boolean;
  feature: string;
  kind: "bug" | "feature_request" | "question";
  severity: "critical" | "high" | "medium" | "low";
  title: string;
  summary: string;
  report: { by: string; text: string; sentiment?: Sentiment };
  /** The rest of the thread: staff replies, more reports, the client confirming. */
  thread: PastMessage[];
  /** Where it ended up. A resolved ticket is closed by the last client message in its thread. */
  status: "open" | "in_progress" | "possibly_resolved" | "resolved";
  /** A promise made on the ticket: who owes what, due how many hours after the report, and whether it was kept. */
  promise?: { by: string; text: string; dueAfterHours: number; kept: boolean };
}

/** Small talk and greetings per client over the period: counted, never stored (like the live pipeline). */
export const PAST_SMALL_TALK: Record<string, number> = { royal_academy: 142, bright_future: 96, unity_model: 118, apex_centre: 64 };

export const PAST_TICKETS: PastTicket[] = [
  // ─── Royal Academy (premium) ──────────────────────────────────────────────
  {
    key: "ra_login_slow", client: "royal_academy", daysAgo: 26, at: "07:52", feature: "login", kind: "bug", severity: "medium",
    title: "Login very slow in the morning", summary: "Teachers wait over a minute to sign in before first period.",
    report: { by: "efe", text: "Good morning. The portal is taking more than one minute to log in this morning, the teachers are all waiting", sentiment: "concerned" },
    thread: [
      { after: 18, by: "ngozi", text: "Good morning Mrs Omoregie, sorry about this. We're checking the server now." },
      { after: 95, by: "tunde", text: "We've added capacity for the morning rush. It should be quick now." },
      { after: 140, by: "efe", text: "Yes it's fast now, thank you" },
    ],
    status: "resolved",
  },
  {
    key: "ra_avatar", client: "royal_academy", daysAgo: 21, at: "13:10", feature: "profile", kind: "bug", severity: "low",
    title: "Profile picture upload fails for large photos", summary: "Photos above 5MB fail silently.",
    report: { by: "adaeze", text: "I'm trying to change my profile picture but it just keeps loading and nothing happens" },
    thread: [
      { after: 40, by: "ngozi", text: "Hello Mrs Okafor, please is the photo very large? Phone pictures over 5MB can fail. We'll fix it so it resizes automatically." },
      { after: 2900, by: "kemi", text: "Large photos are now resized automatically before upload." },
      { after: 3100, by: "adaeze", text: "It worked now. Thanks Kemi" },
    ],
    status: "resolved",
  },
  {
    key: "ra_prep_bank", client: "royal_academy", daysAgo: 17, at: "10:05", feature: "practice_tests", kind: "feature_request", severity: "low",
    title: "Add 2025 WAEC past questions to Prep", summary: "The school wants the latest past questions in the practice bank.",
    report: { by: "osaro", text: "Our SS3 students are asking when the 2025 WAEC past questions will be on Ednovax Prep" },
    thread: [
      { after: 50, by: "ngozi", text: "Good morning sir, we've passed this to the content team. I'll update you this week." },
      { after: 5800, by: "ngozi", text: "The 2025 WAEC questions for English, Maths and Biology are now live on Prep. Others follow next week." },
      { after: 5900, by: "osaro", text: "Excellent, the students will be happy" },
    ],
    status: "resolved",
  },
  {
    key: "ra_scores_lock", client: "royal_academy", daysAgo: 2, at: "11:40", escalated: true, feature: "score_submission", kind: "bug", severity: "high",
    title: "Second term scores locked before the deadline", summary: "Teachers can't edit scores although the school's deadline is Friday.",
    report: { by: "adaeze", text: "Please the score sheet for JSS2 is saying 'locked' but our deadline is Friday. I haven't finished entering CA scores", sentiment: "concerned" },
    thread: [
      { after: 35, by: "ngozi", text: "Sorry Mrs Okafor, I've raised it with the developers. Please hold on." },
      { after: 300, by: "efe", text: "Same for SS1. We can't enter anything", sentiment: "frustrated" },
      { after: 1500, by: "osaro", text: "This is now urgent, report cards go out next week and the teachers are idle", sentiment: "frustrated" },
    ],
    status: "in_progress",
    promise: { by: "tunde", text: "Unlock second term score sheets for Royal Academy", dueAfterHours: 24, kept: false },
  },
  {
    key: "ra_reportcard", client: "royal_academy", daysAgo: 0, at: "", hoursAgo: 20, feature: "results_export", kind: "bug", severity: "high",
    title: "Report card PDF cuts off the last subjects", summary: "Downloaded report cards stop after the eighth subject.",
    report: { by: "efe", text: "The report card PDF is cutting off the last subjects. Students with 12 subjects only show 8 on the PDF" },
    thread: [
      { after: 25, by: "ngozi", text: "Thank you Mrs Omoregie, we're looking at it now." },
      { after: 300, by: "kemi", text: "Found it: the PDF template doesn't add a second page. Working on a fix." },
    ],
    status: "in_progress",
  },

  // ─── Bright Future College (standard) ─────────────────────────────────────
  {
    key: "bf_sms", client: "bright_future", daysAgo: 22, at: "09:30", feature: "notifications", kind: "bug", severity: "medium",
    title: "SMS to parents not delivered", summary: "Fee reminders sent by SMS didn't reach parents on one network.",
    report: { by: "funke", text: "We sent fee reminders to parents yesterday but many of them say they didn't get any SMS" },
    thread: [
      { after: 120, by: "ngozi", text: "Good morning ma, we're checking with the SMS provider." },
      { after: 1700, by: "tunde", text: "One network was rejecting our sender name. It's fixed and the failed messages were resent." },
      { after: 2000, by: "funke", text: "Parents are confirming now. Thank you" },
    ],
    status: "resolved",
  },
  {
    key: "bf_question_import", client: "bright_future", daysAgo: 15, at: "12:15", feature: "question_bank", kind: "question", severity: "low",
    title: "How to import questions from Word", summary: "Teacher wants to bulk-import questions from a Word document.",
    report: { by: "bisi", text: "Please how do I upload questions from a Word document instead of typing them one by one?" },
    thread: [
      { after: 60, by: "ngozi", text: "Hi Miss Lawal! Go to Question bank → Import, download the template, paste your questions in and upload it. I'll send a short video." },
      { after: 90, by: "bisi", text: "Got it, it worked. Thank you so much" },
    ],
    status: "resolved",
  },
  {
    key: "bf_excel", client: "bright_future", daysAgo: 9, at: "14:00", feature: "results_export", kind: "feature_request", severity: "low",
    title: "Export class results to Excel", summary: "Admin wants a one-click Excel export of a class's results.",
    report: { by: "funke", text: "Is it possible to download the whole class result as Excel? We need it for the board meeting" },
    thread: [{ after: 200, by: "ngozi", text: "Not yet ma, but it's on our list. I've added your request." }],
    status: "open",
  },
  {
    key: "bf_reportcard", client: "bright_future", daysAgo: 1, at: "10:45", feature: "results_export", kind: "bug", severity: "high",
    title: "Report card PDF cut off after eight subjects", summary: "Report cards are missing the last subjects in the PDF.",
    report: { by: "chidi", text: "The report cards we printed are missing subjects at the bottom. The PDF stops after 8 subjects", sentiment: "concerned" },
    thread: [{ after: 190, by: "ngozi", text: "Thank you Mr Nwosu. The team is already working on this one." }],
    status: "open",
  },

  // ─── Unity Model School (standard): the client that needs attention ──────
  {
    key: "um_sms", client: "unity_model", daysAgo: 21, at: "16:10", feature: "notifications", kind: "bug", severity: "medium",
    title: "Parents not receiving SMS notifications", summary: "SMS notifications to parents are not delivered.",
    report: { by: "grace", text: "Parents are complaining they don't receive the SMS for PTA meeting" },
    thread: [
      { after: 260, by: "ngozi", text: "Good evening ma, we're checking with our SMS provider now." },
      { after: 1100, by: "tunde", text: "Fixed: one network was rejecting the sender name. Messages have been resent." },
      { after: 1300, by: "grace", text: "Ok thank you" },
    ],
    status: "resolved",
  },
  {
    key: "um_timer", client: "unity_model", daysAgo: 12, at: "09:05", feature: "cbt_timer", kind: "bug", severity: "critical",
    title: "CBT timer ends the exam early", summary: "Students were kicked out of the CBT exam ten minutes early.",
    report: { by: "ibrahim", text: "Our JSS3 students were removed from the exam with 10 minutes left!! They didn't finish", sentiment: "frustrated" },
    thread: [
      { after: 380, by: "ngozi", text: "We're very sorry Mallam. The developers are on it now." },
      { after: 2600, by: "tunde", text: "The timer was counting from when the exam was published, not when the student started. Fixed and the affected students can retake." },
      { after: 3000, by: "ibrahim", text: "Ok it's working now" },
    ],
    status: "resolved",
  },
  {
    key: "um_students", client: "unity_model", daysAgo: 6, at: "11:30", feature: "student_management", kind: "bug", severity: "high",
    title: "New students missing from class lists", summary: "Students registered this term don't appear in their class.",
    report: { by: "grace", text: "We registered 34 new students but they are not showing in their classes. Teachers can't enter their scores", sentiment: "concerned" },
    thread: [
      { after: 520, by: "ngozi", text: "Sorry about this ma, I've escalated it." },
      { after: 2900, by: "grace", text: "Any update on this? It's been two days", sentiment: "frustrated" },
      { after: 4400, by: "grace", text: "Still nothing. The teachers are asking me every day", sentiment: "frustrated" },
    ],
    status: "open",
    promise: { by: "ngozi", text: "Send Unity Model an update on the missing students", dueAfterHours: 48, kept: false },
  },
  {
    key: "um_subjects", client: "unity_model", daysAgo: 2, at: "13:00", feature: "subjects", kind: "bug", severity: "medium",
    title: "Teachers assigned to the wrong subjects", summary: "After the promotion, some teachers show under subjects they don't teach.",
    report: { by: "ibrahim", text: "My account is showing Basic Science and Agric but I teach Maths. I can't see my Maths class", sentiment: "concerned" },
    thread: [],
    status: "open",
  },
  {
    key: "um_reportcard", client: "unity_model", daysAgo: 0, at: "", hoursAgo: 3, feature: "results_export", kind: "bug", severity: "high",
    title: "Report card PDF missing the last subjects", summary: "Downloaded report cards stop before the last subjects.",
    report: { by: "grace", text: "The report card PDF is not showing all the subjects. It stops in the middle", sentiment: "frustrated" },
    thread: [],
    status: "open",
  },

  // ─── Apex Tutorial Centre (premium, lecture centre) ───────────────────────
  {
    key: "ap_receipts", client: "apex_centre", daysAgo: 19, at: "17:40", feature: "centre_payments", kind: "bug", severity: "medium",
    title: "Payment receipts show the wrong amount", summary: "Receipts showed the full fee instead of the instalment paid.",
    report: { by: "femi", text: "Candidates who paid in two instalments are getting receipts for the full fee" },
    thread: [
      { after: 30, by: "ngozi", text: "Thank you Mr Adebayo, checking now." },
      { after: 600, by: "kemi", text: "Receipts now show the amount actually paid. Old receipts can be re-downloaded." },
      { after: 700, by: "femi", text: "Confirmed, thank you" },
    ],
    status: "resolved",
  },
  {
    key: "ap_timetable", client: "apex_centre", daysAgo: 11, at: "08:15", feature: "timetable", kind: "question", severity: "low",
    title: "How to move a lecture to another room", summary: "Tutor wants to change the room of one lecture without changing the whole week.",
    report: { by: "halima", text: "Please how do I move only Saturday's Physics lecture to Hall B?" },
    thread: [
      { after: 20, by: "ngozi", text: "Good morning ma! Open the lecture on the timetable, tap Edit this lecture only, then choose Hall B." },
      { after: 45, by: "halima", text: "Done, thanks" },
    ],
    status: "resolved",
  },
  {
    key: "ap_progress", client: "apex_centre", daysAgo: 5, at: "19:30", feature: "progress_reports", kind: "feature_request", severity: "low",
    title: "Progress report by topic for parents", summary: "Centre wants parents to see weak topics, not just scores.",
    report: { by: "femi", text: "Parents want to see which topics their children are weak in. Can the progress report show that?" },
    thread: [{ after: 55, by: "ngozi", text: "Good idea sir, I've passed it to the Prep team." }],
    status: "open",
  },
  {
    key: "ap_qr_scan", client: "apex_centre", daysAgo: 0, at: "", hoursAgo: 1.5, feature: "centre_attendance", kind: "bug", severity: "high",
    title: "QR attendance not scanning at the gate", summary: "Candidates' QR codes aren't being accepted at the morning lecture.",
    report: { by: "halima", text: "The QR scanner is rejecting everybody's code this morning, we have 200 candidates waiting at the gate!", sentiment: "frustrated" },
    thread: [{ after: 25, by: "femi", text: "Ednovax please we need help urgently", sentiment: "frustrated" }],
    status: "open",
  },
];
