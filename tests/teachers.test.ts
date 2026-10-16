import type { Graph } from "falkordb";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CHATTER, PROBLEMS, TEACHERS, type Teacher } from "../data/demo/henson.js";
import { closeFalkorDB, getFalkorDB } from "../src/graph/client.js";
import { resetGraph } from "../src/hq/seed.js";
import type { Llm } from "../src/llm/llm.js";
import { SimulatedSchool, type Pace } from "../src/runtime/teachers.js";

/**
 * The simulated school against a real FalkorDB (lk_test_school), with a scripted model and a fast
 * clock. The pipeline isn't involved: the test plays the desk by writing the ticket itself.
 */

const FAST: Pace = { tick: 10, firstReport: 0, betweenReports: 60_000, maxOpen: 2, typing: [0, 0], checking: [0, 0], nudge: 60_000, update: 60_000, chatter: [600_000, 600_000] };
const SCRIPT = { name: "Henson", city: "Benin City", teachers: TEACHERS, problems: PROBLEMS, chatter: CHATTER };

let graph: Graph;
let posted: Array<{ by: string; text: string; id: string }>;

/** The model answers Ednovax's questions as the teacher who raised the problem; anything it writes alone falls back to the scripted lines. */
const llm: Llm = {
  async json<T>(_tier: "fast" | "smart", _system: string, user: unknown): Promise<T> {
    const input = user as { task: string; problems: Array<{ id: string; raised_by: string }>; new_from_ednovax: string[] };
    if (input.task !== "respond") throw new Error("model unavailable");
    const said = input.new_from_ednovax.join(" ");
    const problem = input.problems.find((p) => new RegExp(p.raised_by, "i").test(said)) ?? input.problems[0];
    const fixed = /fixed/i.test(said);
    return { replies: [{ teacher: problem.raised_by, problem: problem.id, text: fixed ? "Ok let me check" : "JSS 2B maths", outcome: fixed ? "will_check" : "answered" }] } as T;
  },
  embed: async (texts) => texts.map(() => []),
};

async function school(pace = FAST) {
  return SimulatedSchool.load(SCRIPT, {
    graph,
    llm,
    post: async (teacher: Teacher, text: string) => {
      const id = `msg_${posted.length}`;
      posted.push({ by: teacher.name, text, id });
      await graph.query("CREATE (:Message {id: $id})", { params: { id } });
      return id;
    },
  }, pace);
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(check()).toBe(true);
};

beforeEach(async () => {
  graph = (await getFalkorDB()).selectGraph("lk_test_school");
  await resetGraph(graph);
  posted = [];
});

afterAll(async () => {
  await resetGraph(graph);
  await closeFalkorDB();
});

describe("the simulated school", () => {
  it("raises its first problem once live, and waits for Ednovax", async () => {
    const henson = await school();
    henson.start();
    await until(() => henson.view().cases.length === 1);
    henson.stop();
    expect(posted[0]).toMatchObject({ by: "Mr Efosa Ogbeide", text: PROBLEMS[0].opening });
    expect(henson.view().cases[0]).toMatchObject({ problemId: "scores_not_saving", state: "waiting_reply" });
  });

  it("answers Ednovax, then tries the fix when the ticket is closed", async () => {
    const henson = await school();
    henson.start();
    await until(() => henson.view().cases.length === 1);
    await graph.query("MATCH (m:Message {id: 'msg_0'}) CREATE (m)-[:EVIDENCE_OF]->(:Issue {id: 'iss_1', status: 'open', title: 'Scores not saving'})");

    henson.heard("Ednovax Support", "Sorry about that. Which class?");
    await until(() => posted.length === 2);
    await until(() => henson.view().cases[0].state === "waiting_fix");
    expect(posted[1]).toMatchObject({ by: "Mr Efosa Ogbeide", text: "JSS 2B maths" });
    await until(() => henson.view().cases[0].ticketId === "iss_1");
    expect(henson.view().cases[0].state).toBe("waiting_fix");

    // Closed from the desk, without a word in the group: the teacher goes and checks.
    await graph.query("MATCH (i:Issue {id: 'iss_1'}) SET i.status = 'resolved'");
    await until(() => henson.view().cases[0].state === "settled");
    henson.stop();
    expect(posted[2].text).toMatch(/working now/i);
    expect(henson.view().cases[0].state).toBe("settled");
  });

  it("reports a fix that doesn't hold, once", async () => {
    const henson = await school();
    henson.start();
    await until(() => henson.view().cases.length === 1);
    // The report card problem (the second one) fails its first fix.
    expect(henson.raiseNext()).toBe("Mrs Osasere Igbinoba");
    await until(() => henson.view().cases.length === 2);
    henson.heard("Blessed Oigbochie", "Mrs Osasere, it's fixed now. Please try again");
    await until(() => henson.view().cases[1].state === "waiting_fix" && posted.some((p) => /still the same/i.test(p.text)));
    henson.stop();
    expect(henson.view().cases.find((c) => c.problemId === "report_card_average")?.state).toBe("waiting_fix");
  });

  it("chases when nobody answers, and the principal steps in the second time", async () => {
    const henson = await school({ ...FAST, nudge: 0 });
    henson.start();
    await until(() => posted.length >= 3);
    henson.stop();
    expect(posted[1].by).toBe("Mr Efosa Ogbeide");
    expect(posted[2].by).toBe("Mr Kingsley Omoruyi");
  });

  it("remembers where it was after a restart", async () => {
    const first = await school();
    first.start();
    await until(() => first.view().cases.length === 1);
    first.stop();
    const again = await school();
    expect(again.view().cases).toHaveLength(1);
    expect(again.view().next?.teacher).toBe("Mrs Osasere Igbinoba");
  });
});
