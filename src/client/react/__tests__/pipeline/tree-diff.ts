/* src/client/react/__tests__/pipeline/tree-diff.ts */

import type { DomNode } from "./dom.js";
import { fingerprint } from "./dom.js";

export type DiffOp =
  | { type: "identical"; aIdx: number; bIdx: number }
  | { type: "modified"; aIdx: number; bIdx: number }
  | { type: "onlyLeft"; aIdx: number }
  | { type: "onlyRight"; bIdx: number };

export function diffChildren(a: DomNode[], b: DomNode[]): DiffOp[] {
  const fpA = a.map(fingerprint);
  const fpB = b.map(fingerprint);

  const n = fpA.length;
  const m = fpB.length;

  // Phase 1: LCS on fingerprints
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from<number>({ length: m + 1 }).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = fpA[i] === fpB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const lcsPairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (fpA[i] === fpB[j]) {
      lcsPairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }

  const matchedA = Array.from<boolean>({ length: n }).fill(false);
  const matchedB = Array.from<boolean>({ length: m }).fill(false);
  for (const [ai, bj] of lcsPairs) {
    matchedA[ai] = true;
    matchedB[bj] = true;
  }

  // Phase 2: greedy tag matching on unmatched nodes
  const unmatchedB: number[] = [];
  for (let j = 0; j < m; j++) {
    if (!matchedB[j]) unmatchedB.push(j);
  }
  const usedB = Array.from<boolean>({ length: unmatchedB.length }).fill(false);
  const modifiedPairs: [number, number][] = [];

  for (let ai = 0; ai < n; ai++) {
    if (matchedA[ai]) continue;
    const nodeA = a[ai];
    if (nodeA.type !== "element") continue;
    for (let kb = 0; kb < unmatchedB.length; kb++) {
      if (usedB[kb]) continue;
      const bj = unmatchedB[kb];
      const nodeB = b[bj];
      if (nodeB.type === "element" && nodeA.tag === nodeB.tag) {
        usedB[kb] = true;
        matchedA[ai] = true;
        matchedB[bj] = true;
        modifiedPairs.push([ai, bj]);
        break;
      }
    }
  }

  // Collect all matched pairs sorted by a-index
  const pairs: [number, number, boolean][] = [];
  for (const [ai, bj] of lcsPairs) pairs.push([ai, bj, true]);
  for (const [ai, bj] of modifiedPairs) pairs.push([ai, bj, false]);
  pairs.sort((a, b) => a[0] - b[0]);

  // Phase 3: interleave to build ordered output
  const result: DiffOp[] = [];
  let prevA = 0;
  let prevB = 0;

  for (const [ai, bj, isIdentical] of pairs) {
    // Emit unmatched a-nodes in [prevA, ai)
    for (let idx = prevA; idx < ai; idx++) {
      if (!matchedA[idx]) result.push({ type: "onlyLeft", aIdx: idx });
    }
    // Emit unmatched b-nodes in [prevB, bj)
    for (let idx = prevB; idx < bj; idx++) {
      if (!matchedB[idx]) result.push({ type: "onlyRight", bIdx: idx });
    }
    // Emit the matched pair
    if (isIdentical) {
      result.push({ type: "identical", aIdx: ai, bIdx: bj });
    } else {
      result.push({ type: "modified", aIdx: ai, bIdx: bj });
    }
    prevA = ai + 1;
    prevB = bj + 1;
  }

  // Emit remaining unmatched after the last pair
  for (let idx = prevA; idx < n; idx++) {
    if (!matchedA[idx]) result.push({ type: "onlyLeft", aIdx: idx });
  }
  for (let idx = prevB; idx < m; idx++) {
    if (!matchedB[idx]) result.push({ type: "onlyRight", bIdx: idx });
  }

  return result;
}
