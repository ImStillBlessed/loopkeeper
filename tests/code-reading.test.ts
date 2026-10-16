import { describe, expect, it } from "vitest";
import { readCode, words } from "../src/github/code-reading.js";
import { readStatistics } from "../src/graph/activity.js";

describe("reading a source file", () => {
  it("names what a TypeScript file defines, its routes and what it's about", () => {
    const source = `/**
 * Saves a class's scores for one assessment.
 */
import { db } from "../db";

export async function saveScores(classId: string, scores: Score[]) {}
export const validateScore = (score: number) => score <= 100;
class ScoreQueue {}
router.post("/api/scores", handler);
`;
    const code = readCode("lib/scores/submit.ts", source);
    expect(code.symbols).toEqual(expect.arrayContaining(["saveScores", "validateScore", "ScoreQueue"]));
    expect(code.routes).toEqual(["POST /api/scores"]);
    expect(code.outline).toContain("Saves a class's scores");
    // Plain words, so a teacher's "scores won't save" can find it.
    expect(code.searchText).toContain("save scores");
    expect(code.searchText).toContain("lib scores submit ts");
  });

  it("reads PHP, Python and Go definitions too", () => {
    expect(readCode("app/Http/ResultController.php", "class ResultController {\n  public function computeAverage($class) {}\n}\nRoute::get('/results', 'x');").symbols).toEqual(
      expect.arrayContaining(["ResultController", "computeAverage"]),
    );
    expect(readCode("results.py", "def class_average(scores):\n    pass").symbols).toContain("class_average");
    expect(readCode("timer.go", "func (t *Timer) Restart() {}").symbols).toContain("Restart");
  });

  it("splits code names into words", () => {
    expect(words("lib/cbt/restartTimer.ts")).toBe("lib cbt restart timer ts");
    expect(words("class_average")).toBe("class average");
  });
});

describe("FalkorDB's statistics", () => {
  it("reads the engine time, cache use and what a query wrote", () => {
    const stats = readStatistics(["Nodes created: 2", "Properties set: 5", "Relationships created: 0", "Cached execution: 1", "Query internal execution time: 0.412 milliseconds"]);
    expect(stats).toEqual({ engineMs: 0.412, cached: true, writes: { "Nodes created": 2, "Properties set": 5 } });
  });
});
