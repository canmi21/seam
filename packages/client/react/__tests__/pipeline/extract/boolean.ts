/* packages/client/react/__tests__/pipeline/extract/boolean.ts */

import type { DomNode } from "../dom.js";
import { parseHtml } from "../dom.js";
import { diffChildren } from "../tree-diff.js";
import type { Axis } from "./combo.js";
import { findPairForAxis } from "./combo.js";
import { contentIndices } from "./helpers.js";

export function insertBooleanDirectives(
  tree: DomNode[],
  aNodes: DomNode[],
  bNodes: DomNode[],
  path: string,
): DomNode[] {
  const ops = diffChildren(aNodes, bNodes);
  const contentMap = contentIndices(tree);

  const result: DomNode[] = [];
  let treeContentIdx = 0;
  let treePos = 0;

  function copyLeadingDirectives(): void {
    const target = treeContentIdx < contentMap.length ? contentMap[treeContentIdx] : tree.length;
    while (treePos < target) {
      result.push(structuredClone(tree[treePos]));
      treePos++;
    }
  }

  let opIdx = 0;
  while (opIdx < ops.length) {
    const op = ops[opIdx];

    if (op.type === "identical") {
      copyLeadingDirectives();
      result.push(structuredClone(tree[treePos]));
      treePos++;
      treeContentIdx++;
      opIdx++;
    } else if (op.type === "modified") {
      copyLeadingDirectives();
      const treeNode = tree[treePos];
      const aNode = aNodes[op.aIdx];
      const bNode = bNodes[op.bIdx];

      if (
        treeNode.type === "element" &&
        aNode.type === "element" &&
        bNode.type === "element" &&
        aNode.attrs === bNode.attrs
      ) {
        // Same attrs -- recurse into children
        const merged = insertBooleanDirectives(
          structuredClone(treeNode.children),
          aNode.children,
          bNode.children,
          path,
        );
        result.push({
          type: "element",
          tag: treeNode.tag,
          attrs: treeNode.attrs,
          children: merged,
          selfClosing: treeNode.selfClosing,
        });
      } else {
        // Different attrs or node types -- wrap in if/else
        result.push({ type: "comment", value: `seam:if:${path}` });
        result.push(structuredClone(aNodes[op.aIdx]));
        result.push({ type: "comment", value: "seam:else" });
        result.push(structuredClone(bNodes[op.bIdx]));
        result.push({ type: "comment", value: `seam:endif:${path}` });
      }
      treePos++;
      treeContentIdx++;
      opIdx++;
    } else if (op.type === "onlyLeft") {
      copyLeadingDirectives();
      // Check if next op is OnlyRight -- forms an if/else replacement pair
      if (opIdx + 1 < ops.length && ops[opIdx + 1].type === "onlyRight") {
        const nextOp = ops[opIdx + 1] as { type: "onlyRight"; bIdx: number };
        result.push({ type: "comment", value: `seam:if:${path}` });
        result.push(structuredClone(aNodes[op.aIdx]));
        result.push({ type: "comment", value: "seam:else" });
        result.push(structuredClone(bNodes[nextOp.bIdx]));
        result.push({ type: "comment", value: `seam:endif:${path}` });
        treePos++;
        treeContentIdx++;
        opIdx += 2;
        continue;
      }
      // If-only
      result.push({ type: "comment", value: `seam:if:${path}` });
      result.push(structuredClone(tree[treePos]));
      result.push({ type: "comment", value: `seam:endif:${path}` });
      treePos++;
      treeContentIdx++;
      opIdx++;
    } else {
      // onlyRight
      copyLeadingDirectives();
      const orOp = op as { type: "onlyRight"; bIdx: number };
      result.push({ type: "comment", value: `seam:if:${path}` });
      result.push({ type: "comment", value: "seam:else" });
      result.push(structuredClone(bNodes[orOp.bIdx]));
      result.push({ type: "comment", value: `seam:endif:${path}` });
      // Don't advance tree positions
      opIdx++;
    }
  }

  // Copy remaining tree nodes (trailing directive comments)
  while (treePos < tree.length) {
    result.push(structuredClone(tree[treePos]));
    treePos++;
  }

  return result;
}

export function processBoolean(
  result: DomNode[],
  axes: Axis[],
  variants: string[],
  axisIdx: number,
): DomNode[] {
  const axis = axes[axisIdx];
  const pair = findPairForAxis(axes, variants.length, axisIdx);
  if (pair === null) return result;
  const [viA, viB] = pair;

  const treeA = parseHtml(variants[viA]);
  const treeB = parseHtml(variants[viB]);

  return insertBooleanDirectives(result, treeA, treeB, axis.path);
}
