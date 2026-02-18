/* packages/client/react/__tests__/pipeline/extract/combo.ts */

// -- Types --

export interface Axis {
  path: string;
  kind: string;
  values: unknown[];
}

export interface AxisGroup {
  parentIdx: number;
  children: number[];
}

// -- Combo (from combo.rs) --

export function generateCombos(axes: Axis[]): unknown[][] {
  let combos: unknown[][] = [[]];
  for (const axis of axes) {
    const next: unknown[][] = [];
    for (const existing of combos) {
      for (const value of axis.values) {
        next.push([...existing, value]);
      }
    }
    combos = next;
  }
  return combos;
}

export function classifyAxes(axes: Axis[]): { topLevel: number[]; groups: AxisGroup[] } {
  const topLevel: number[] = [];
  const groupMap = new Map<string, AxisGroup>();

  for (let i = 0; i < axes.length; i++) {
    const dotPos = axes[i].path.indexOf(".$.");
    if (dotPos !== -1) {
      const parentPath = axes[i].path.slice(0, dotPos);
      const parentIdx = axes.findIndex((a) => a.path === parentPath);
      if (parentIdx !== -1) {
        let group = groupMap.get(parentPath);
        if (!group) {
          group = { parentIdx, children: [] };
          groupMap.set(parentPath, group);
        }
        group.children.push(i);
      } else {
        topLevel.push(i);
      }
    } else {
      topLevel.push(i);
    }
  }

  return { topLevel, groups: [...groupMap.values()] };
}

// -- Variant (from variant.rs) --

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function findPairForAxis(
  axes: Axis[],
  variantCount: number,
  targetAxis: number,
): [number, number] | null {
  const axis = axes[targetAxis];
  if (axis.values.length < 2) return null;

  const combos = generateCombos(axes);
  const firstVal = axis.values[0];
  const secondVal = axis.values[1];

  for (let i = 0; i < combos.length; i++) {
    for (let j = 0; j < combos.length; j++) {
      if (i === j || i >= variantCount || j >= variantCount) continue;
      const comboA = combos[i];
      const comboB = combos[j];

      let differsOnlyInTarget = true;
      for (let k = 0; k < comboA.length; k++) {
        if (k === targetAxis) {
          if (!valuesEqual(comboA[k], firstVal) || !valuesEqual(comboB[k], secondVal)) {
            differsOnlyInTarget = false;
            break;
          }
        } else if (!valuesEqual(comboA[k], comboB[k])) {
          differsOnlyInTarget = false;
          break;
        }
      }
      if (differsOnlyInTarget) return [i, j];
    }
  }

  return null;
}

export function findEnumGroupForAxis(
  axes: Axis[],
  variantCount: number,
  targetAxis: number,
): [string, number][] {
  const axis = axes[targetAxis];
  const combos = generateCombos(axes);
  const result: [string, number][] = [];

  if (combos.length === 0) return result;
  const referenceCombos = combos[0];

  for (const value of axis.values) {
    const valStr = typeof value === "string" ? value : JSON.stringify(value);

    for (let i = 0; i < combos.length; i++) {
      if (i >= variantCount) break;
      const combo = combos[i];

      let matches = true;
      for (let k = 0; k < combo.length; k++) {
        if (k === targetAxis) {
          if (!valuesEqual(combo[k], value)) {
            matches = false;
            break;
          }
        } else if (!valuesEqual(combo[k], referenceCombos[k])) {
          matches = false;
          break;
        }
      }
      if (matches) {
        result.push([valStr, i]);
        break;
      }
    }
  }

  return result;
}

export function findEnumAllVariantsForAxis(
  axes: Axis[],
  variantCount: number,
  targetAxis: number,
): [string, number[]][] {
  const axis = axes[targetAxis];
  const combos = generateCombos(axes);
  const result: [string, number[]][] = [];

  for (const value of axis.values) {
    const valStr = typeof value === "string" ? value : JSON.stringify(value);
    const indices: number[] = combos
      .map((combo, i) => ({ combo, i }))
      .filter(({ i }) => i < variantCount)
      .filter(({ combo }) => valuesEqual(combo[targetAxis], value))
      .map(({ i }) => i);
    result.push([valStr, indices]);
  }

  return result;
}

export function findScopedVariantIndices(
  axes: Axis[],
  variantCount: number,
  parentAxisIdx: number,
  children: number[],
): number[] {
  const combos = generateCombos(axes);
  if (combos.length === 0) return [];
  const reference = combos[0];
  const childSet = new Set(children);

  return combos
    .map((combo, i) => ({ combo, i }))
    .filter(({ i }) => i < variantCount)
    .filter(({ combo }) =>
      combo.every((v, k) => {
        if (k === parentAxisIdx) {
          return valuesEqual(v, axes[parentAxisIdx].values[0]);
        } else if (childSet.has(k)) {
          return true;
        } else {
          return valuesEqual(v, reference[k]);
        }
      }),
    )
    .map(({ i }) => i);
}
