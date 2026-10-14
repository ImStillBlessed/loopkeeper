/**
 * The Ednovax product as the graph sees it: features, the code files behind them, and who owns those files.
 * Stand-in for the public demo repo's features.yaml + CODEOWNERS until the repo indexer exists.
 */

export interface Feature {
  key: string;
  name: string;
  description: string;
}

export interface CodeFile {
  path: string;
  feature: string;
  /** Cast key of the developer listed in CODEOWNERS. */
  owner: string;
  imports?: string[];
}

export const DEMO_REPO = "ednovax-lite-demo";

export const FEATURES: Feature[] = [
  { key: "login", name: "Login", description: "Signing in, passwords, sessions, app speed at sign-in" },
  { key: "cbt_timer", name: "CBT timer", description: "Countdown timer shown to students during computer-based tests" },
  { key: "cbt_tests", name: "CBT tests", description: "Creating, publishing and retaking computer-based tests, question limits" },
  { key: "question_bank", name: "Question bank", description: "Adding and importing questions for tests" },
  { key: "score_submission", name: "Score submission", description: "Teachers entering and saving student scores after tests and exams" },
  { key: "results_export", name: "Results & report cards", description: "Results pages, class averages, report cards, broadsheets, exporting results" },
  { key: "student_management", name: "Student management", description: "Student records, classes, registration, student lists" },
  { key: "subjects", name: "Subjects & teachers", description: "Subjects and which teachers are assigned to them" },
  { key: "profile", name: "Profiles", description: "Teacher profiles and profile pictures" },
  { key: "notifications", name: "Notifications", description: "SMS and app notifications to parents and teachers" },
];

export const CODE_FILES: CodeFile[] = [
  { path: "app/login/page.tsx", feature: "login", owner: "kemi", imports: ["lib/auth/session.ts"] },
  { path: "lib/auth/session.ts", feature: "login", owner: "kemi", imports: ["lib/db.ts"] },
  { path: "components/cbt/Timer.tsx", feature: "cbt_timer", owner: "kemi", imports: ["lib/cbt/clock.ts"] },
  { path: "lib/cbt/clock.ts", feature: "cbt_timer", owner: "kemi" },
  { path: "app/cbt/[testId]/page.tsx", feature: "cbt_tests", owner: "kemi", imports: ["components/cbt/Timer.tsx", "lib/cbt/tests.ts"] },
  { path: "lib/cbt/tests.ts", feature: "cbt_tests", owner: "kemi", imports: ["lib/db.ts"] },
  { path: "lib/questions/import.ts", feature: "question_bank", owner: "kemi", imports: ["lib/cbt/tests.ts"] },
  { path: "app/scores/page.tsx", feature: "score_submission", owner: "tunde", imports: ["lib/scores/submit.ts"] },
  { path: "lib/scores/submit.ts", feature: "score_submission", owner: "tunde", imports: ["lib/db.ts", "lib/scores/validate.ts"] },
  { path: "lib/scores/validate.ts", feature: "score_submission", owner: "tunde" },
  { path: "app/results/page.tsx", feature: "results_export", owner: "tunde", imports: ["lib/results/averages.ts"] },
  { path: "lib/results/averages.ts", feature: "results_export", owner: "tunde", imports: ["lib/scores/submit.ts"] },
  { path: "lib/results/export.ts", feature: "results_export", owner: "tunde", imports: ["lib/results/averages.ts"] },
  { path: "app/students/page.tsx", feature: "student_management", owner: "tunde", imports: ["lib/db.ts"] },
  { path: "app/subjects/page.tsx", feature: "subjects", owner: "tunde", imports: ["lib/db.ts"] },
  { path: "app/profile/page.tsx", feature: "profile", owner: "kemi", imports: ["lib/uploads.ts"] },
  { path: "lib/uploads.ts", feature: "profile", owner: "kemi" },
  { path: "lib/notify/sms.ts", feature: "notifications", owner: "tunde" },
  { path: "lib/db.ts", feature: "student_management", owner: "tunde" },
];

/** Which school uses which features (drives "what else is affected?"). */
export const SCHOOL_FEATURES: Record<string, string[]> = {
  sch_royal: FEATURES.map((f) => f.key),
  sch_bright: FEATURES.map((f) => f.key),
  sch_unity: ["login", "cbt_timer", "cbt_tests", "question_bank", "score_submission", "results_export", "student_management", "subjects"],
};
