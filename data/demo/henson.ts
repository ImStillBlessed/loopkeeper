import type { ClientSeed } from "../synthetic/cast.js";

/**
 * The live demo: one school, Henson, whose staff talk to Ednovax in their WhatsApp support group.
 * The teachers are simulated (an AI plays them); everyone at Ednovax is a real person on the desk.
 * The teachers' names are invented.
 */

export const HENSON: ClientSeed = {
  id: "henson",
  name: "Henson",
  type: "school",
  city: "Benin City",
  plan: "standard",
  agent: "stf_support",
  group: "Henson × Ednovax Support",
  aliases: ["Henson academy", "Henson school"],
  products: ["sms_v1"],
  deployments: [
    { product: "sms_v1", repo: "Novaxatech/hensonschool", branch: null, tenancy: "own_repo" },
    { product: "sms_v1", repo: "Novaxatech/hensonschoolapi", branch: null, tenancy: "own_repo" },
  ],
};

/**
 * Clients whose people are simulated. The demo account sees only these, "Start over" only resets
 * these, and the central hub never routes real messages into them.
 */
export const DEMO_CLIENT_IDS = [HENSON.id];

export interface Teacher {
  key: string;
  name: string;
  role: "teacher" | "admin";
  job: string;
  /** How they write and behave, for the model playing them. */
  manner: string;
}

export const TEACHERS: Teacher[] = [
  {
    key: "efosa",
    name: "Mr Efosa Ogbeide",
    role: "teacher",
    job: "Mathematics and Basic Science teacher, JSS 2 and 3",
    manner: "Friendly and quick. Short messages, a little pidgin, an emoji now and then. Gets restless when his students' scores are at risk.",
  },
  {
    key: "osas",
    name: "Mrs Osasere Igbinoba",
    role: "admin",
    job: "Exams and records officer",
    manner: "Organised and polite. Full sentences, greets first. Firm about deadlines because parents are waiting for results.",
  },
  {
    key: "ivie",
    name: "Miss Ivie Aigbe",
    role: "admin",
    job: "ICT coordinator, creates staff accounts and manages classes",
    manner: "Precise and calm. Quotes error messages exactly and lists the steps she tried.",
  },
  {
    key: "kingsley",
    name: "Mr Kingsley Omoruyi",
    role: "admin",
    job: "Principal",
    manner: "Formal and brief. Speaks up when something has waited too long or affects parents.",
  },
];

/** A problem a teacher will raise, with what they know about it. */
export interface SchoolProblem {
  id: string;
  /** The teacher who raises it. */
  by: string;
  kind: "bug" | "question" | "feature_request";
  /** What is going on, as the teacher experiences it (for the model; never sent as is). */
  situation: string;
  /** Facts the teacher knows and gives when asked: class, time, error text, device. */
  details: string[];
  /** The first message, used when the model can't be reached. */
  opening: string;
  /** The first fix doesn't hold: the teacher checks and reports it's still broken, once. */
  failsFirstFix?: boolean;
}

/** In the order they come up once the school is live. */
export const PROBLEMS: SchoolProblem[] = [
  {
    id: "scores_not_saving",
    by: "efosa",
    kind: "bug",
    situation: "Saving JSS 2B Mathematics scores spins for a long time, then says 'Something went wrong'. After a reload the scores are gone.",
    details: [
      "Class JSS 2B, Mathematics, second term, second CA",
      "About 38 students; it failed three times since 8 am",
      "Chrome on the staff room laptop, and it also failed on his phone",
      "The error reads: Something went wrong. Please try again.",
      "Mrs Osasere saved English scores without trouble yesterday",
    ],
    opening: "Good morning Ednovax. Please the scores page is not saving for JSS 2B maths. I have entered it 3 times now and it keeps saying something went wrong 😩",
  },
  {
    id: "report_card_average",
    by: "osas",
    kind: "bug",
    situation: "SS 1 Science report cards show a class average of 0.0 for Chemistry, although the scores are on the broadsheet.",
    details: [
      "SS 1 Science, first term",
      "Only Chemistry; Physics and Biology averages are right",
      "The broadsheet has the correct Chemistry scores",
      "They must print report cards for the PTA meeting on Friday",
    ],
    opening:
      "Good afternoon. The SS1 Science report cards are showing class average 0.0 for Chemistry, but the scores are on the broadsheet. We need to print for PTA on Friday please.",
    failsFirstFix: true,
  },
  {
    id: "move_student",
    by: "ivie",
    kind: "question",
    situation: "She wants to move a student from JSS 1A to JSS 1B without losing the first CA scores already entered.",
    details: ["The student changed arm after resumption", "Ivie has an admin account", "First CA scores are already entered under JSS 1A"],
    opening: "Hello, please how do I move a student from JSS1A to JSS1B? I don't want her CA scores to disappear.",
  },
  {
    id: "cbt_timer_restarts",
    by: "efosa",
    kind: "bug",
    situation: "In the JSS 3 CBT practice test the timer starts again from 40 minutes when a student refreshes the page.",
    details: [
      "JSS 3 Basic Science practice test, 40 minutes",
      "Five students in the computer lab got extra time this way",
      "Lab computers run Windows 10 with Chrome",
      "They refreshed because the network was slow",
    ],
    opening: "Well done una. The CBT timer for JSS3 is restarting from 40 minutes whenever a student refreshes 🙆🏾‍♂️ some of them now have extra time",
  },
  {
    id: "parents_sms",
    by: "kingsley",
    kind: "bug",
    situation: "Parents didn't receive the SMS about the mid-term break, although the portal says it was sent.",
    details: [
      "Sent from the portal on Monday at 2 pm",
      "About 300 parents; only a handful got it",
      "The portal shows 'Sent' for all of them",
      "The bursar confirmed the school still has SMS units",
    ],
    opening: "Good evening. Parents are calling that they did not get the SMS on mid-term break. The portal says sent. Kindly look into it.",
  },
  {
    id: "broadsheet_by_arm",
    by: "osas",
    kind: "feature_request",
    situation: "She would like to print the broadsheet for one arm (only JSS 2A) instead of all of JSS 2 together.",
    details: ["The whole of JSS 2 is about 120 students, which is too long to print", "Class teachers only need their own arm"],
    opening: "Please is it possible to print broadsheet by arm? Like only JSS 2A. Printing the whole JSS 2 is too long.",
  },
  {
    id: "new_teachers_login",
    by: "ivie",
    kind: "bug",
    situation: "Three teachers whose accounts she created yesterday can't sign in: 'Invalid session, please sign in again' right after the password.",
    details: [
      "Accounts created yesterday afternoon",
      "Older teachers sign in fine",
      "They tried a private window and another phone",
      "The error reads: Invalid session, please sign in again",
    ],
    opening: "Hi team, the 3 new teachers I created yesterday cannot login. It says 'Invalid session, please sign in again' immediately after the password.",
  },
];

/** Small talk that turns up in any school group (the desk should ignore it). */
export const CHATTER = [
  "Good morning everyone 🙏🏾",
  "Happy new week colleagues",
  "Good afternoon all",
  "Happy Friday 🎉",
  "God bless our work today 🙏🏾",
];
