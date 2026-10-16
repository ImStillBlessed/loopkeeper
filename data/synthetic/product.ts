/**
 * Ednovax's products as the graph sees them: features, the code files behind them, and who owns those files.
 * The demo stand-in for each product's repo (features.yaml + CODEOWNERS) until a real repo is connected.
 */

export interface Product {
  key: string;
  name: string;
  description: string;
}

export interface Feature {
  key: string;
  name: string;
  description: string;
  product: string;
}

export interface CodeFile {
  path: string;
  feature: string;
  /** Staff id of the developer listed in CODEOWNERS. */
  owner: string;
  imports?: string[];
}

export const PRODUCTS: Product[] = [
  {
    key: "sms_v1",
    name: "Ednovax SMS v1",
    description: "The first school management system: results, CBT, scores, students. Some schools have their own repo; newer ones share one repo, a branch each.",
  },
  {
    key: "ednovax",
    name: "Ednovax",
    description: "The multi-tenant platform: many schools in one codebase and database, with Prep and lecture-centre management inside.",
  },
];

/** The repository each product's code reference is read from. Code file ids are "<repo>:<path>". */
export const DEMO_REPOS: Record<string, string> = {
  sms_v1: "ednovax/sms-v1",
  ednovax: "ednovax/ednovax",
};

export const FEATURES: Feature[] = [
  // Ednovax SMS v1
  { key: "login", name: "Login", description: "Signing in, passwords, sessions, app speed at sign-in", product: "sms_v1" },
  { key: "cbt_timer", name: "CBT timer", description: "Countdown timer shown to students during computer-based tests", product: "sms_v1" },
  { key: "cbt_tests", name: "CBT tests", description: "Creating, publishing and retaking computer-based tests, question limits", product: "sms_v1" },
  { key: "question_bank", name: "Question bank", description: "Adding and importing questions for tests", product: "sms_v1" },
  { key: "score_submission", name: "Score submission", description: "Teachers entering and saving student scores after tests and exams", product: "sms_v1" },
  { key: "results_export", name: "Results & report cards", description: "Results pages, class averages, report cards, broadsheets, exporting results", product: "sms_v1" },
  { key: "student_management", name: "Student management", description: "Student records, classes, registration, student lists", product: "sms_v1" },
  { key: "subjects", name: "Subjects & teachers", description: "Subjects and which teachers are assigned to them", product: "sms_v1" },
  { key: "profile", name: "Profiles", description: "Teacher profiles and profile pictures", product: "sms_v1" },
  { key: "notifications", name: "Notifications", description: "SMS and app notifications to parents and teachers", product: "sms_v1" },
  // Ednovax (multi-tenant): lecture-centre management
  { key: "centre_attendance", name: "Centre attendance", description: "QR attendance at lectures, attendance reports", product: "ednovax" },
  { key: "timetable", name: "Timetable", description: "Lecture timetables, rooms and tutors", product: "ednovax" },
  { key: "centre_payments", name: "Centre payments", description: "Fees, receipts and payment reminders for candidates", product: "ednovax" },
  // Ednovax (multi-tenant): Prep
  { key: "practice_tests", name: "Practice tests", description: "Timed UTME/WAEC practice tests on the phone", product: "ednovax" },
  { key: "progress_reports", name: "Progress reports", description: "Scores over time and weak topics for each candidate", product: "ednovax" },
];

export const CODE_FILES: Record<string, CodeFile[]> = {
  sms_v1: [
    { path: "app/login/page.tsx", feature: "login", owner: "stf_maro", imports: ["lib/auth/session.ts"] },
    { path: "lib/auth/session.ts", feature: "login", owner: "stf_maro", imports: ["lib/db.ts"] },
    { path: "components/cbt/Timer.tsx", feature: "cbt_timer", owner: "stf_maro", imports: ["lib/cbt/clock.ts"] },
    { path: "lib/cbt/clock.ts", feature: "cbt_timer", owner: "stf_maro" },
    { path: "app/cbt/[testId]/page.tsx", feature: "cbt_tests", owner: "stf_maro", imports: ["components/cbt/Timer.tsx", "lib/cbt/tests.ts"] },
    { path: "lib/cbt/tests.ts", feature: "cbt_tests", owner: "stf_maro", imports: ["lib/db.ts"] },
    { path: "lib/questions/import.ts", feature: "question_bank", owner: "stf_maro", imports: ["lib/cbt/tests.ts"] },
    { path: "app/scores/page.tsx", feature: "score_submission", owner: "stf_blessed", imports: ["lib/scores/submit.ts"] },
    { path: "lib/scores/submit.ts", feature: "score_submission", owner: "stf_blessed", imports: ["lib/db.ts", "lib/scores/validate.ts"] },
    { path: "lib/scores/validate.ts", feature: "score_submission", owner: "stf_blessed" },
    { path: "app/results/page.tsx", feature: "results_export", owner: "stf_blessed", imports: ["lib/results/averages.ts"] },
    { path: "lib/results/averages.ts", feature: "results_export", owner: "stf_blessed", imports: ["lib/scores/submit.ts"] },
    { path: "lib/results/export.ts", feature: "results_export", owner: "stf_blessed", imports: ["lib/results/averages.ts"] },
    { path: "app/students/page.tsx", feature: "student_management", owner: "stf_blessed", imports: ["lib/db.ts"] },
    { path: "app/subjects/page.tsx", feature: "subjects", owner: "stf_blessed", imports: ["lib/db.ts"] },
    { path: "app/profile/page.tsx", feature: "profile", owner: "stf_maro", imports: ["lib/uploads.ts"] },
    { path: "lib/uploads.ts", feature: "profile", owner: "stf_maro" },
    { path: "lib/notify/sms.ts", feature: "notifications", owner: "stf_blessed" },
    { path: "lib/db.ts", feature: "student_management", owner: "stf_blessed" },
  ],
  ednovax: [
    { path: "app/attendance/scan.tsx", feature: "centre_attendance", owner: "stf_maro", imports: ["lib/attendance/qr.ts"] },
    { path: "lib/attendance/qr.ts", feature: "centre_attendance", owner: "stf_maro" },
    { path: "app/timetable/page.tsx", feature: "timetable", owner: "stf_maro", imports: ["lib/timetable.ts"] },
    { path: "lib/timetable.ts", feature: "timetable", owner: "stf_maro" },
    { path: "lib/payments/receipts.ts", feature: "centre_payments", owner: "stf_blessed" },
    { path: "app/practice/[testId].tsx", feature: "practice_tests", owner: "stf_maro", imports: ["lib/practice/timer.ts"] },
    { path: "lib/practice/timer.ts", feature: "practice_tests", owner: "stf_maro" },
    { path: "lib/progress/report.ts", feature: "progress_reports", owner: "stf_blessed" },
  ],
};
