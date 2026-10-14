# Data

**Everything in this folder is 100% fictional.** The schools, teachers, staff and the one phone number (`+234 803 555 0142`, in the reserved 555 range) are invented. No real chats, people or student data are used anywhere in Loopkeeper.

## `synthetic/`

A generator for the "Ednovax Schools Support" WhatsApp group: 3 schools, 8 teachers/admins and 3 Ednovax staff, over 3 weeks (21 Sep – 11 Oct 2026).

| File | What it is |
|---|---|
| `cast.ts` | Schools and people |
| `scenarios.ts` | The scripted real work, one block per demo scenario (S1–S7 + everyday support) |
| `noise.ts` | Seeded generator for greetings, prayers, birthdays, broadcasts and stickers |
| `generator.ts` | Merges and orders everything, then renders it as an Android or iOS WhatsApp export |
| `generate.ts` | CLI: `npm run data:generate` |
| `output/` | The generated exports, the ground-truth labels and the roster |

### Planted scenarios

| ID | Scenario | Tests |
|---|---|---|
| S1 (+S8) | Three schools report "scores not saving" in different words over 2 days. Still open at the end → dispatched to the code agent | Duplicate merge (WCC), dispatch fix |
| S2 | CBT timer missing on Tecno phones → screenshot → fix promised → "It's working now 🙏🏾" | Full lifecycle, auto-close with provenance |
| S3 | Admin promises the student list "by Thursday", never sends it | Follow-up → overdue reminder |
| S4 | "We've agreed to move our mock exam to Friday" | Decision traced to its message |
| S5 | "Can we export results to Excel?" | Feature request → `results_export` |
| S6 | "Login is very slow" → "It's fine now" 20 min later | Quick, low-severity resolve |
| S7 | Teacher with two open issues says "It's working now" | "Possibly resolved" guardrail |
| BG | Everyday questions, small bugs, promises that are kept | Realistic volume of real work |

`ednovax-schools-support.labels.json` gives every message its true label (`relevant`, `type`, `scenario`), so we can measure how well triage does.
