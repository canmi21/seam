/* src/client/react/__tests__/pipeline/extract/array.ts */

import type { DomNode } from "../dom.js";
import { parseHtml, serialize } from "../dom.js";
import { diffChildren } from "../tree-diff.js";
import type { Axis, AxisGroup } from "./combo.js";
import { findPairForAxis, findScopedVariantIndices } from "./combo.js";
import { insertBooleanDirectives } from "./boolean.js";
import {
  contentIndices,
  nthContentIndex,
  renameSlotMarkers,
  navigateToChildren,
  unwrapContainerTree,
  hoistListContainer,
} from "./helpers.js";

// -- Public type for inner extractor callback --

export type InnerExtractFn = (axes: Axis[], variants: string[]) => string;

// -- Body location --

interface BodyLocation {
  path: number[];
  bodyIndices: number[];
}

// -- Array directives (from array.rs) --

function insertArrayDirectives(
  tree: DomNode[],
  popNodes: DomNode[],
  emptyNodes: DomNode[],
  path: string,
): DomNode[] {
  const ops = diffChildren(popNodes, emptyNodes);

  const bodyIndices: number[] = [];
  let hasOnlyRight = false;
  let hasModified = false;

  for (const op of ops) {
    if (op.type === "onlyLeft") bodyIndices.push(op.aIdx);
    else if (op.type === "onlyRight") hasOnlyRight = true;
    else if (op.type === "modified") hasModified = true;
  }

  // Content only differs inside a shared element -- recurse
  if (bodyIndices.length === 0 && hasModified) {
    return insertArrayModified(tree, popNodes, emptyNodes, path);
  }

  // Replacement pair -- treat as boolean-like
  if (bodyIndices.length === 0 && hasOnlyRight) {
    return insertBooleanDirectives(tree, popNodes, emptyNodes, path);
  }

  if (bodyIndices.length === 0) return tree;

  // Extract body nodes and rename slot markers
  const body: DomNode[] = bodyIndices.map((i) => structuredClone(popNodes[i]));
  renameSlotMarkers(body, path);

  // Container unwrap + each/endeach wrapping
  const eachNodes = wrapArrayBody(body, path);

  // Build result with content map approach
  const contentMap = contentIndices(tree);
  const result: DomNode[] = [];
  let treeContentIdx = 0;
  let treePos = 0;

  for (const op of ops) {
    // Copy leading directives
    const target = treeContentIdx < contentMap.length ? contentMap[treeContentIdx] : tree.length;
    while (treePos < target) {
      result.push(structuredClone(tree[treePos]));
      treePos++;
    }

    if (op.type === "identical") {
      result.push(structuredClone(tree[treePos]));
      treePos++;
      treeContentIdx++;
    } else if (op.type === "onlyLeft") {
      // First body node gets the each_nodes, rest are consumed
      if (op.aIdx === bodyIndices[0]) {
        result.push(...structuredClone(eachNodes));
      }
      treePos++;
      treeContentIdx++;
    } else if (op.type === "onlyRight") {
      // Skip -- replaced by array when populated
    } else if (op.type === "modified") {
      result.push(structuredClone(tree[treePos]));
      treePos++;
      treeContentIdx++;
    }
  }

  while (treePos < tree.length) {
    result.push(structuredClone(tree[treePos]));
    treePos++;
  }

  return result;
}

function insertArrayModified(
  tree: DomNode[],
  popNodes: DomNode[],
  emptyNodes: DomNode[],
  path: string,
): DomNode[] {
  const ops = diffChildren(popNodes, emptyNodes);
  const result = structuredClone(tree);
  for (const op of ops) {
    if (op.type !== "modified") continue;
    const popNode = popNodes[op.aIdx];
    const emptyNode = emptyNodes[op.bIdx];
    if (popNode.type !== "element" || emptyNode.type !== "element") continue;

    const ti = nthContentIndex(result, op.aIdx);
    if (ti === undefined) continue;
    const treeNode = result[ti];
    if (treeNode.type !== "element") continue;

    treeNode.children = insertArrayDirectives(
      treeNode.children,
      popNode.children,
      emptyNode.children,
      path,
    );
  }
  return result;
}

export function wrapArrayBody(body: DomNode[], path: string): DomNode[] {
  // Simple case: single list container
  const unwrapped = unwrapContainerTree(body);
  if (unwrapped !== null) {
    const innerWithDirectives: DomNode[] = [
      { type: "comment", value: `seam:each:${path}` },
      ...structuredClone(unwrapped.children),
      { type: "comment", value: "seam:endeach" },
    ];
    return [
      {
        type: "element",
        tag: unwrapped.tag,
        attrs: unwrapped.attrs,
        children: innerWithDirectives,
        selfClosing: false,
      },
    ];
  }

  // Hoist case
  const hoisted = hoistListContainer(body);
  if (hoisted !== null) {
    const innerWithDirectives: DomNode[] = [
      { type: "comment", value: `seam:each:${path}` },
      ...hoisted.children,
      { type: "comment", value: "seam:endeach" },
    ];
    return [
      {
        type: "element",
        tag: hoisted.tag,
        attrs: hoisted.attrs,
        children: innerWithDirectives,
        selfClosing: false,
      },
    ];
  }

  // No container unwrap
  return [
    { type: "comment", value: `seam:each:${path}` },
    ...structuredClone(body),
    { type: "comment", value: "seam:endeach" },
  ];
}

export function processArray(
  result: DomNode[],
  axes: Axis[],
  variants: string[],
  axisIdx: number,
): DomNode[] {
  const axis = axes[axisIdx];
  const pair = findPairForAxis(axes, variants.length, axisIdx);
  if (pair === null) return result;
  const [viPop, viEmpty] = pair;

  const treePop = parseHtml(variants[viPop]);
  const treeEmpty = parseHtml(variants[viEmpty]);

  return insertArrayDirectives(result, treePop, treeEmpty, axis.path);
}

// -- Body location helpers --

function findBodyInTrees(pop: DomNode[], empty: DomNode[]): BodyLocation | null {
  const ops = diffChildren(pop, empty);

  const bodyIdx: number[] = ops
    .filter((op): op is { type: "onlyLeft"; aIdx: number } => op.type === "onlyLeft")
    .map((op) => op.aIdx);

  if (bodyIdx.length > 0) {
    return { path: [], bodyIndices: bodyIdx };
  }

  // Recurse into Modified elements
  for (const op of ops) {
    if (op.type !== "modified") continue;
    const popNode = pop[op.aIdx];
    const emptyNode = empty[op.bIdx];
    if (popNode.type !== "element" || emptyNode.type !== "element") continue;

    const loc = findBodyInTrees(popNode.children, emptyNode.children);
    if (loc !== null) {
      loc.path.unshift(op.aIdx);
      return loc;
    }
  }

  return null;
}

function replaceBodyAtPath(
  result: DomNode[],
  path: number[],
  bodyIndices: number[],
  replacement: DomNode[],
): DomNode[] {
  if (path.length === 0) {
    const bodySet = new Set(bodyIndices);
    const newNodes: DomNode[] = [];
    for (let i = 0; i < result.length; i++) {
      if (bodySet.has(i)) {
        if (i === bodyIndices[0]) {
          newNodes.push(...structuredClone(replacement));
        }
      } else {
        newNodes.push(result[i]);
      }
    }
    return newNodes;
  }

  // Navigate to the content node at index path[0]
  const ci = nthContentIndex(result, path[0]);
  if (ci !== undefined) {
    const node = result[ci];
    if (node.type === "element") {
      node.children = replaceBodyAtPath(node.children, path.slice(1), bodyIndices, replacement);
    }
  }
  return result;
}

// -- Array with children (from array.rs) --

export function processArrayWithChildren(
  result: DomNode[],
  axes: Axis[],
  variants: string[],
  group: AxisGroup,
  innerExtract: InnerExtractFn,
): DomNode[] {
  const arrayAxis = axes[group.parentIdx];
  if (arrayAxis.kind !== "array") return result;

  // 1. Find populated/empty pair
  const pair = findPairForAxis(axes, variants.length, group.parentIdx);
  if (pair === null) return result;
  const [, viEmpty] = pair;
  const treeEmpty = parseHtml(variants[viEmpty]);

  // 2. Find all scoped variants
  const scopedIndices = findScopedVariantIndices(
    axes,
    variants.length,
    group.parentIdx,
    group.children,
  );
  if (scopedIndices.length === 0) return result;

  // 3. Parse all scoped variants
  const scopedTrees = scopedIndices.map((i) => parseHtml(variants[i]));
  const firstPop = scopedTrees[0];

  // 4. Find body location
  const bodyLoc = findBodyInTrees(firstPop, treeEmpty);
  if (bodyLoc === null) return result;

  // 5. Extract body from each scoped variant at the found path
  const bodyVariants: string[] = scopedTrees.map((tree) => {
    const parent = navigateToChildren(tree, bodyLoc.path);
    const bodyNodes: DomNode[] = bodyLoc.bodyIndices
      .filter((i) => i < parent.length)
      .map((i) => structuredClone(parent[i]));
    return serialize(bodyNodes);
  });

  // 6. Build child axes with stripped parent prefix
  const parentDot = `${arrayAxis.path}.`;
  const childAxes: Axis[] = group.children.map((i) => {
    const orig = axes[i];
    const stripped = orig.path.startsWith(parentDot)
      ? orig.path.slice(parentDot.length)
      : orig.path;
    return { path: stripped, kind: orig.kind, values: [...orig.values] };
  });

  // 6b. Pre-rename slot markers in body variants
  const slotPrefix = `<!--seam:${arrayAxis.path}.`;
  const renamedBodyVariants = bodyVariants.map((b) => b.replaceAll(slotPrefix, "<!--seam:"));

  // 7. Recursively extract template from body variants
  const templateBody = innerExtract(childAxes, renamedBodyVariants);
  const bodyTree = parseHtml(templateBody);
  renameSlotMarkers(bodyTree, arrayAxis.path);

  // 8. Wrap with each markers
  const eachNodes = wrapArrayBody(bodyTree, arrayAxis.path);

  // 9. Insert into result tree at the body location
  let mutResult = structuredClone(result);
  mutResult = replaceBodyAtPath(mutResult, bodyLoc.path, bodyLoc.bodyIndices, eachNodes);
  return mutResult;
}
