import type { MessageType } from "../../src/pipeline/message-types.js";

/**
 * The scripted "real work" in the synthetic chat, plus the few noise replies that only make sense in context.
 * Each scenario maps to a demo moment in the build brief (§9.1).
 *
 * Day 0 is Monday 21 Sep 2026. Useful landmarks:
 *   day 3 = Thu 24 Sep · day 7 = Mon 28 Sep · day 10 = Thu 1 Oct (Independence Day) · day 14 = Mon 5 Oct · day 20 = Sun 11 Oct
 */

export type ScenarioId = "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "BG";

export interface Label {
  relevant: boolean;
  type?: MessageType;
  scenario?: ScenarioId;
}

export interface ChatEvent {
  day: number;
  /** Local Lagos time, "HH:MM". */
  time: string;
  /** Cast key, see cast.ts. */
  sender: string;
  text: string;
  hasMedia?: boolean;
  label: Label;
}

const work = (scenario: ScenarioId, type: MessageType): Label => ({ relevant: true, type, scenario });
const NOISE: Label = { relevant: false };

const say = (day: number, time: string, sender: string, text: string, label: Label): ChatEvent => ({
  day, time, sender, text, label,
});
const media = (day: number, time: string, sender: string, label: Label): ChatEvent => ({
  day, time, sender, text: "", hasMedia: true, label,
});

/** S1: the same score-saving bug from three schools in different words. Stays open: the cross-client pattern and the fix broadcast. */
const S1_SCORES_NOT_SAVING: ChatEvent[] = [
  say(3, "09:40", "adaeze", "Good morning. Please the scores I entered for JSS2 Maths did not save after the exam. I clicked submit and it just kept loading", work("S1", "bug")),
  say(3, "09:52", "efe", "Same here o, JSS3 own too", work("S1", "bug")),
  say(3, "10:30", "ngozi", "Sorry about this ma. We are checking it now", work("S1", "status_update")),
  say(3, "10:31", "adaeze", "Thank you ma 🙏🏾", NOISE),
  say(4, "14:05", "chidi", "Hello Ednovax team, our SS1 scores are not saving. Teachers submit and when they come back the page is empty 😩", work("S1", "bug")),
  say(4, "16:20", "ibrahim", "Abeg the score submission no dey work for us too. After exam we enter marks, e no gree save", work("S1", "bug")),
  say(4, "17:02", "tunde", "Thanks everyone. Looks like score submission is timing out for big classes. I'm looking into it", work("S1", "status_update")),
  say(14, "08:30", "chidi", "The score problem happened again today for JSS1", work("S1", "bug")),
  say(18, "11:45", "osaro", "Please is the score problem fixed? Our teachers are still waiting to enter the 2nd test", work("S1", "question")),
  say(18, "12:10", "ngozi", "Not yet sir, Tunde is on it. We will update you", work("S1", "status_update")),
];

/** S2: full lifecycle: report → screenshot → promise of a fix → "it's working now". */
const S2_CBT_TIMER: ChatEvent[] = [
  say(7, "08:15", "funke", "The CBT timer is not showing on the students' phones. Most of them are using Tecno", work("S2", "bug")),
  say(7, "08:40", "kemi", "Sorry about that ma. Please can you send a screenshot from one of the phones?", work("S2", "question")),
  media(7, "09:02", "funke", work("S2", "bug")),
  say(7, "09:03", "funke", "This is how it looks on the Tecno ones. Infinix is fine", work("S2", "bug")),
  say(7, "11:30", "kemi", "Thank you ma. We've found the problem, the fix will be out by tomorrow evening", work("S2", "promise")),
  say(9, "10:05", "funke", "It's working now 🙏🏾 the timer is showing on all the phones. Thank you Kemi!", work("S2", "resolution")),
  say(9, "10:12", "kemi", "You're welcome ma 😊", NOISE),
];

/** S3: a promise that is never kept → overdue reminder. */
const S3_STUDENT_LIST: ChatEvent[] = [
  say(8, "15:20", "osaro", "@Ngozi Eze I'll send the updated student list for the new JSS1 intake by Thursday", work("S3", "promise")),
  say(8, "15:25", "ngozi", "Okay sir, thank you", NOISE),
];

/** S4: a decision that must be traceable to the message that made it. */
const S4_MOCK_EXAM: ChatEvent[] = [
  say(11, "11:00", "grace", "Ngozi, as we discussed on the call, we've agreed to move our mock exam to Friday next week so the timer fix can be tested first", work("S4", "decision")),
  say(11, "11:06", "ngozi", "Noted ma. Unity mock exam moved to Friday 9th 👍🏾", work("S4", "decision")),
];

/** S5: a feature request for results_export. */
const S5_EXCEL_EXPORT: ChatEvent[] = [
  say(14, "13:10", "bisi", "Please is it possible to export results to Excel? Our principal wants to print the broadsheet", work("S5", "feature_request")),
  say(14, "13:40", "tunde", "That's a good idea ma. We'll add it to our list", work("S5", "status_update")),
];

/** S6: low-severity blip that resolves itself 20 minutes later. */
const S6_SLOW_LOGIN: ChatEvent[] = [
  say(15, "07:52", "efe", "Login is very slow this morning 😩", work("S6", "bug")),
  say(15, "08:13", "efe", "It's fine now. Ignore 🙏🏾", work("S6", "resolution")),
];

/** S7: an ambiguous "it's working" from someone with two open issues (S1 scores + this one). Must not auto-close. */
const S7_AMBIGUOUS_RESOLUTION: ChatEvent[] = [
  say(15, "12:20", "ibrahim", "Good afternoon. The results page is showing wrong class average for SS2", work("S7", "bug")),
  say(15, "12:45", "tunde", "Thanks sir, I'll check it today", work("S7", "promise")),
  say(17, "10:30", "ibrahim", "It's working now, thank you", work("S7", "resolution")),
];

/** S8: the lecture centre (a different product): QR attendance breaks at the morning lecture, and gets fixed. */
const S8_CENTRE_ATTENDANCE: ChatEvent[] = [
  say(5, "08:10", "halima", "Good morning. The QR attendance is not scanning for the 8am lecture, students are queuing at the door", work("S8", "bug")),
  say(5, "08:25", "kemi", "Sorry about that ma, checking now. Which device are you scanning with?", work("S8", "question")),
  say(5, "08:31", "halima", "The centre tablet, the Samsung one", work("S8", "bug")),
  say(5, "11:00", "kemi", "Found it. The fix will be out by this evening", work("S8", "promise")),
  say(6, "08:40", "femi", "QR scanning works now. Thank you Kemi 🙏🏾", work("S8", "resolution")),
  say(12, "15:00", "femi", "Can candidates see their practice test progress on the parents' side?", work("S8", "question")),
  say(12, "15:30", "ngozi", "Not yet sir, it's on the plan for next month. I'll update you when it's out", work("S8", "promise")),
];

/** Everyday support work: questions, small bugs, promises that do get kept. */
const BACKGROUND_WORK: ChatEvent[] = [
  say(1, "10:15", "chidi", "How do I reset a student's password? One of my students forgot his own", work("BG", "question")),
  say(1, "10:32", "ngozi", "Go to Students → pick the student → Reset password. They will get a new one-time code", work("BG", "status_update")),
  say(1, "10:40", "chidi", "Thank you ma", NOISE),

  say(2, "11:00", "grace", "Please can we change a student's class after registration?", work("BG", "question")),
  say(2, "11:20", "ngozi", "Yes ma. Edit the student and change Class. Their old scores will stay", work("BG", "status_update")),

  say(2, "15:30", "bisi", "Please how do I print report cards for the whole class at once?", work("BG", "question")),
  say(2, "15:48", "ngozi", "Results → select class → Print all. It makes one PDF for the class", work("BG", "status_update")),
  say(2, "15:50", "bisi", "Ah okay. Thank you 🙏🏾", NOISE),

  say(4, "11:10", "efe", "Students in SS3 can't see the Chemistry test I set", work("BG", "bug")),
  say(4, "11:25", "kemi", "You need to publish it first ma. Open the test and click Publish", work("BG", "status_update")),
  say(4, "11:31", "efe", "Ah I see, done. They can see it now. Thanks", work("BG", "resolution")),

  say(7, "14:00", "grace", "Can a student retake a CBT test if their phone switched off in the middle?", work("BG", "question")),
  say(7, "14:22", "kemi", "Yes ma. Go to the test → Attempts → Allow retake for that student", work("BG", "status_update")),

  say(8, "09:30", "ngozi", "Hello all, I'll share the training video for new teachers tomorrow", work("BG", "promise")),
  say(9, "16:00", "ngozi", "As promised, here is the training video for new teachers: https://example.com/ednovax-training", work("BG", "status_update")),
  say(9, "16:20", "grace", "Thank you so much 🙏🏾", NOISE),

  say(11, "09:10", "chidi", "The app is asking me to update. Should I?", work("BG", "question")),
  say(11, "09:25", "kemi", "Yes sir, please update. The new version has the timer fix", work("BG", "status_update")),

  say(12, "18:00", "kemi", "Heads up: Ednovax will be down for maintenance tonight from 10pm to 11pm", work("BG", "status_update")),

  say(14, "10:05", "adaeze", "Is there a limit to how many questions we can put in one CBT test?", work("BG", "question")),
  say(14, "10:30", "kemi", "Up to 100 questions per test ma", work("BG", "status_update")),
  say(14, "10:44", "adaeze", "Please can you send us a guide on how to import questions from Word?", work("BG", "question")),
  say(14, "10:52", "kemi", "Sure ma, I'll send the question import guide by Wednesday", work("BG", "promise")),
  say(16, "15:15", "kemi", "Here is the question import guide as promised: https://example.com/question-import-guide", work("BG", "status_update")),

  say(16, "09:15", "adaeze", "Some teachers can't upload their profile picture. It says file too large", work("BG", "bug")),
  say(16, "09:50", "kemi", "Thanks ma, we've raised the limit. Please try again", work("BG", "status_update")),
  say(16, "10:20", "adaeze", "Working now, thank you", work("BG", "resolution")),

  say(17, "14:00", "bisi", "Can parents get an SMS when results are released? Many of them don't check the app", work("BG", "feature_request")),
  say(17, "14:30", "ngozi", "Noted ma, I'll pass it to the team", work("BG", "status_update")),

  say(18, "09:05", "funke", "How do I add a second teacher to the same subject?", work("BG", "question")),
  say(18, "09:20", "ngozi", "Subjects → open the subject → Add teacher. Both of them can enter scores", work("BG", "status_update")),
];

export const SCRIPTED_EVENTS: ChatEvent[] = [
  ...S1_SCORES_NOT_SAVING,
  ...S2_CBT_TIMER,
  ...S3_STUDENT_LIST,
  ...S4_MOCK_EXAM,
  ...S5_EXCEL_EXPORT,
  ...S6_SLOW_LOGIN,
  ...S7_AMBIGUOUS_RESOLUTION,
  ...S8_CENTRE_ATTENDANCE,
  ...BACKGROUND_WORK,
];
