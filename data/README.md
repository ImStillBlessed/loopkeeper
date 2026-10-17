# Data

No real chats, contacts or student data are used anywhere in Loopkeeper. The live demo is connected to a real Ednovax school's GitHub repositories (Henson); the people and conversations in it are invented.

## `demo/`: the live demo

| File | What it is |
|---|---|
| `staff.ts` | The Ednovax staff who sign in to the desk (always real people at the keyboard) and the SLA per plan |
| `henson.ts` | The demo school: its deployments (its GitHub repositories), its four teachers (invented, played by AI), the problems they raise in order, and the small talk they post |

The teachers are run by [`src/runtime/teachers.ts`](../src/runtime/teachers.ts) with the prompt in [`prompts/teachers.md`](../prompts/teachers.md). They only react: they raise one problem at a time, answer what Ednovax asks with the facts they were given, chase when nobody replies, and test a fix once its ticket is closed. One problem fails its first fix on purpose.

## `synthetic/`: test fixtures and the product reference

A generator for a fictional "Ednovax Schools Support" WhatsApp group: four schools, their teachers and admins and three Ednovax staff over three weeks. Every person and phone number is invented (the one number, `+234 803 555 0142`, is in the reserved 555 range). The tests run this chat through the whole pipeline against a real FalkorDB, with a scripted model, to check tenancy, duplicates, patterns across clients and that HQ never holds message text.

| File | What it is |
|---|---|
| `cast.ts` | The fictional clients and people, and the client and deployment types |
| `scenarios.ts` | The scripted real work, one block per scenario |
| `noise.ts` | Seeded generator for greetings, prayers, birthdays, broadcasts and stickers |
| `generator.ts` | Merges and orders everything, then renders it as an Android or iOS WhatsApp export |
| `generate.ts` | CLI: `npm run data:generate` writes the exports to `output/` |
| `product.ts` | Ednovax's products and features, and a stand-in code reference used until a product's real repository is connected |

`output/ednovax-schools-support.labels.json` gives every message its true label (`relevant`, `type`, `scenario`), so triage can be measured.
