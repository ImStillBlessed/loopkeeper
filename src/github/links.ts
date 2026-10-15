/**
 * How developer activity points at issues. A pull request or commit is linked when its title, body,
 * branch or message mentions a GitHub issue ("#12", "fixes #12") or a Loopkeeper id ("iss_9c1e…").
 */
export interface References {
  /** GitHub issue numbers, e.g. 12 for "#12". */
  numbers: number[];
  /** Loopkeeper issue ids. */
  issueIds: string[];
  /** True when the text says it fixes/closes/resolves something. */
  closes: boolean;
}

const NUMBER = /(?:^|[\s(\[,:])#(\d{1,6})\b/g;
const BRANCH_NUMBER = /(?:^|[/_-])(?:issue|fix|bug)[/_-]?(\d{1,6})\b/gi;
const LOOPKEEPER_ID = /\biss_[a-f0-9]{16}\b/g;
const CLOSING = /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\b/i;

export function parseReferences(...texts: Array<string | null | undefined>): References {
  const text = texts.filter(Boolean).join("\n");
  const numbers = new Set<number>();
  for (const match of text.matchAll(NUMBER)) numbers.add(Number(match[1]));
  for (const match of text.matchAll(BRANCH_NUMBER)) numbers.add(Number(match[1]));
  return {
    numbers: [...numbers],
    issueIds: [...new Set(text.match(LOOPKEEPER_ID) ?? [])],
    closes: CLOSING.test(text),
  };
}
