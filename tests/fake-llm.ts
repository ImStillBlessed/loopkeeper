import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSION } from "../src/graph/schema.js";
import type { IssueCard } from "../src/pipeline/extract.js";
import type { Extraction } from "../src/pipeline/types.js";
import type { Llm } from "../src/llm/llm.js";

/**
 * A scripted stand-in for OpenAI so the pipeline can be tested against a real FalkorDB without an API key.
 * - triage: answers from the synthetic chat's ground-truth labels
 * - extract: a hand-written extraction for the key scenario messages (it uses the open issues
 *   the pipeline pulled from the graph, just like the real model has to)
 * - embeddings: topic words decide the direction, so "score" texts land close together
 */
export function createFakeLlm(labels: Map<string, { relevant: boolean; type?: string }>): Llm {
  return {
    async json<T>(_tier: "fast" | "smart", system: string, user: unknown): Promise<T> {
      const input = user as Record<string, any>;
      if (input.messages_to_triage) {
        const results = input.messages_to_triage.map((m: { id: string }) => {
          const label = labels.get(m.id);
          return { id: m.id, relevant: label?.relevant ?? false, type: label?.type ?? null, confidence: 0.9 };
        });
        return { results } as T;
      }
      if (input.issues) {
        return { groups: [input.issues.map((i: { id: string }) => i.id)] } as T;
      }
      if (system.includes("work graph")) {
        return scriptedExtraction(input.message.text, input.open_issues) as T;
      }
      throw new Error("Fake LLM got an unexpected prompt");
    },

    async embed(texts: string[]): Promise<number[][]> {
      return texts.map(fakeEmbedding);
    },
  };
}

const TOPICS = [/score|marks/i, /timer/i, /average/i, /student list/i];

function fakeEmbedding(text: string): number[] {
  const vector = new Array(EMBEDDING_DIMENSION).fill(0);
  const hash = createHash("sha256").update(text).digest();
  const topic = TOPICS.findIndex((pattern) => pattern.test(text));
  vector[topic >= 0 ? topic : 10 + (hash[0] % 300)] = 1;
  vector[320 + (hash[1] % 60)] = 0.15; // a little per-text wobble
  return vector;
}

const empty = (): Extraction => ({ new_issues: [], issue_updates: [], new_followups: [], completed_followups: [], decisions: [] });

function scriptedExtraction(text: string, openIssues: IssueCard[]): Extraction {
  const result = empty();
  const find = (pattern: RegExp) => openIssues.find((issue) => pattern.test(issue.title))?.id;
  const update = (pattern: RegExp, kind: Extraction["issue_updates"][number]["kind"], confidence = 0.95) => {
    const id = find(pattern);
    if (id) result.issue_updates.push({ issue_id: id, kind, confidence });
  };

  if (text.includes("scores I entered for JSS2 Maths")) {
    result.new_issues.push({ title: "Scores not saving after exam", summary: "JSS2 Maths scores keep loading on submit", kind: "bug", feature_key: "score_submission", severity: "high" });
  } else if (text.includes("Same here o, JSS3")) {
    update(/score/i, "confirmed");
  } else if (text.includes("our SS1 scores are not saving")) {
    // Simulates the model missing the existing issue: vector search + WCC must catch the duplicate.
    result.new_issues.push({ title: "SS1 scores not saving", summary: "Scores empty after submitting", kind: "bug", feature_key: "score_submission", severity: "high" });
  } else if (text.includes("score submission no dey work")) {
    update(/score/i, "confirmed");
  } else if (text.includes("timing out for big classes")) {
    update(/score/i, "in_progress");
  } else if (text.includes("CBT timer is not showing")) {
    result.new_issues.push({ title: "CBT timer missing on Tecno phones", summary: "Timer not shown during tests on Tecno", kind: "bug", feature_key: "cbt_timer", severity: "high" });
  } else if (text.includes("fix will be out by tomorrow evening")) {
    result.new_followups.push({ text: "Release the CBT timer fix", owner_name: "Kemi Ojo", due: "2026-09-29T18:00", issue_id: find(/timer/i) ?? null });
  } else if (text.includes("the timer is showing on all the phones")) {
    update(/timer/i, "resolved");
  } else if (text.includes("student list for the new JSS1 intake")) {
    result.new_followups.push({ text: "Send the updated JSS1 student list", owner_name: "Osaro", due: "2026-10-01T17:00", issue_id: null });
  } else if (text.includes("agreed to move our mock exam")) {
    result.decisions.push({ text: "Unity Model School mock exam moved to Friday 9 Oct", feature_key: "cbt_tests" });
  } else if (text.includes("wrong class average")) {
    result.new_issues.push({ title: "Wrong class average on results page", summary: "SS2 average is wrong", kind: "bug", feature_key: "results_export", severity: "medium" });
  } else if (text === "It's working now, thank you") {
    update(/score/i, "resolved", 0.4);
    update(/average/i, "resolved", 0.4);
  }
  return result;
}
