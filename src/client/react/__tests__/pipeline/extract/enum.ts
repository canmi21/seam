/* src/client/react/__tests__/pipeline/extract/enum.ts */

import type { DomNode } from "../dom.js";
import { fingerprint, parseHtml, serialize } from "../dom.js";
import type { Axis } from "./combo.js";
import { findEnumAllVariantsForAxis, findEnumGroupForAxis } from "./combo.js";
import { navigateToChildren } from "./helpers.js";
import type { InnerExtractFn } from "./array.js";

// -- Enum region --

interface EnumRegion {
  parentPath: number[];
  prefixLen: number;
  suffixLen: number;
}

// -- Enum (from enum_axis.rs) --

export function findEnumRegion(base: DomNode[], others: DomNode[][]): EnumRegion | null {
  const allSame = others.every(
    (o) => o.length === base.length && o.every((n, i) => fingerprint(n) === fingerprint(base[i])),
  );
  if (allSame) return null;

  const minLen = Math.min(base.length, ...others.map((o) => o.length));

  let commonPrefix = 0;
  prefixLoop: for (let i = 0; i < minLen; i++) {
    const fpBase = fingerprint(base[i]);
    for (const other of others) {
      if (fingerprint(other[i]) !== fpBase) break prefixLoop;
    }
    commonPrefix++;
  }

  let commonSuffix = 0;
  suffixLoop: for (let i = 0; i < minLen - commonPrefix; i++) {
    const bi = base.length - 1 - i;
    const fpBase = fingerprint(base[bi]);
    for (const other of others) {
      const oi = other.length - 1 - i;
      if (fingerprint(other[oi]) !== fpBase) break suffixLoop;
    }
    commonSuffix++;
  }

  if (commonPrefix + commonSuffix >= base.length) {
    // All content is shared -- recurse into shared elements
    for (let i = 0; i < base.length; i++) {
      const baseNode = base[i];
      if (baseNode.type !== "element") continue;

      const childOthers: DomNode[][] = [];
      let allElements = true;
      for (const other of others) {
        if (other[i].type === "element") {
          childOthers.push((other[i] as { type: "element"; children: DomNode[] }).children);
        } else {
          allElements = false;
          break;
        }
      }
      if (!allElements || childOthers.length !== others.length) continue;

      const region = findEnumRegion(baseNode.children, childOthers);
      if (region !== null) {
        return {
          parentPath: [i, ...region.parentPath],
          prefixLen: region.prefixLen,
          suffixLen: region.suffixLen,
        };
      }
    }
    return null;
  }

  return { parentPath: [], prefixLen: commonPrefix, suffixLen: commonSuffix };
}

export function applyEnumDirectives(
  result: DomNode[],
  region: EnumRegion,
  path: string,
  branches: [string, DomNode[]][],
): DomNode[] {
  if (region.parentPath.length === 0) {
    const bodyEnd = result.length - region.suffixLen;
    const newNodes: DomNode[] = [];
    newNodes.push(...result.slice(0, region.prefixLen));
    newNodes.push({ type: "comment", value: `seam:match:${path}` });
    for (const [value, body] of branches) {
      newNodes.push({ type: "comment", value: `seam:when:${value}` });
      newNodes.push(...structuredClone(body));
    }
    newNodes.push({ type: "comment", value: "seam:endmatch" });
    newNodes.push(...result.slice(bodyEnd));
    return newNodes;
  }

  // Navigate into the target element
  const idx = region.parentPath[0];
  const node = result[idx];
  if (node.type === "element") {
    const subRegion: EnumRegion = {
      parentPath: region.parentPath.slice(1),
      prefixLen: region.prefixLen,
      suffixLen: region.suffixLen,
    };
    node.children = applyEnumDirectives(node.children, subRegion, path, branches);
  }
  return result;
}

export function processEnum(
  result: DomNode[],
  axes: Axis[],
  variants: string[],
  axisIdx: number,
  innerExtract: InnerExtractFn,
): [DomNode[], boolean] {
  const axis = axes[axisIdx];
  const groups = findEnumGroupForAxis(axes, variants.length, axisIdx);
  if (groups.length < 2) return [result, false];

  const trees = groups.map(([, vi]) => parseHtml(variants[vi]));
  const baseTree = trees[0];

  const otherTrees = trees.slice(1);
  const region = findEnumRegion(baseTree, otherTrees);
  if (region === null) return [result, false];

  // Collect sibling axes for recursive processing within each arm
  const siblingAxes: Axis[] = axes.filter((_, i) => i !== axisIdx);
  const hasSiblings = siblingAxes.length > 0;
  const allGroups = hasSiblings ? findEnumAllVariantsForAxis(axes, variants.length, axisIdx) : [];

  // Build match/when branches
  const branches: [string, DomNode[]][] = [];
  for (let idx = 0; idx < groups.length; idx++) {
    const [value] = groups[idx];
    const armTree = trees[idx];
    const armChildren = navigateToChildren(armTree, region.parentPath);
    const bodyStart = region.prefixLen;
    const bodyEnd = armChildren.length - region.suffixLen;
    const armBodyNodes = armChildren.slice(bodyStart, bodyEnd);

    let armBody: DomNode[];
    if (hasSiblings) {
      const [, armIndices] = allGroups[idx];
      const armBodies: string[] = armIndices.map((i) => {
        const vTree = parseHtml(variants[i]);
        const vChildren = navigateToChildren(vTree, region.parentPath);
        const end = Math.max(vChildren.length - region.suffixLen, bodyStart);
        return serialize(vChildren.slice(bodyStart, end));
      });
      const innerTemplate = innerExtract(siblingAxes, armBodies);
      armBody = parseHtml(innerTemplate);
    } else {
      armBody = structuredClone(armBodyNodes);
    }

    branches.push([value, armBody]);
  }

  return [applyEnumDirectives(structuredClone(result), region, axis.path, branches), hasSiblings];
}
