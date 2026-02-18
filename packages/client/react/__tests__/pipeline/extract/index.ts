/* packages/client/react/__tests__/pipeline/extract/index.ts */

import { parseHtml, serialize } from "../dom.js";
import type { Axis } from "./combo.js";
import { classifyAxes } from "./combo.js";
import { processBoolean } from "./boolean.js";
import { processArray, processArrayWithChildren } from "./array.js";
import { processEnum } from "./enum.js";

// -- Re-exports --

export type { Axis, AxisGroup } from "./combo.js";
export { generateCombos, classifyAxes } from "./combo.js";
export { isDirectiveComment, contentIndices, nthContentIndex } from "./helpers.js";
export { renameSlotMarkers, navigateToChildren } from "./helpers.js";
export { isListContainer, unwrapContainerTree, hoistListContainer } from "./helpers.js";
export { insertBooleanDirectives } from "./boolean.js";
export { wrapArrayBody, processArrayWithChildren } from "./array.js";
export { findEnumRegion, applyEnumDirectives } from "./enum.js";
export {
  findPairForAxis,
  findEnumGroupForAxis,
  findEnumAllVariantsForAxis,
  findScopedVariantIndices,
} from "./combo.js";

// -- Entry points (from mod.rs) --

export function extractTemplateInner(axes: Axis[], variants: string[]): string {
  if (variants.length === 0) return "";
  if (variants.length === 1 || axes.length === 0) return variants[0];

  let result = parseHtml(variants[0]);

  // 1. Classify axes
  const { topLevel, groups } = classifyAxes(axes);

  // 2. Track handled axes
  const handled = new Set<number>();
  for (const group of groups) {
    handled.add(group.parentIdx);
    for (const child of group.children) handled.add(child);
    result = processArrayWithChildren(result, axes, variants, group, extractTemplateInner);
  }

  // 3. Process remaining top-level axes
  for (const idx of topLevel) {
    if (handled.has(idx)) continue;
    const axis = axes[idx];
    if (axis.kind === "boolean" || axis.kind === "nullable") {
      result = processBoolean(result, axes, variants, idx);
    } else if (axis.kind === "enum") {
      const [newResult, consumedSiblings] = processEnum(
        result,
        axes,
        variants,
        idx,
        extractTemplateInner,
      );
      if (consumedSiblings) {
        for (const other of topLevel) {
          if (other !== idx) handled.add(other);
        }
      }
      result = newResult;
    } else if (axis.kind === "array") {
      result = processArray(result, axes, variants, idx);
    }
  }

  return serialize(result);
}

export function extractTemplate(axes: Axis[], variants: string[]): string {
  return extractTemplateInner(axes, variants);
}
