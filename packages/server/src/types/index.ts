import * as primitives from "./primitives.js";
import {
  object,
  optional,
  array,
  nullable,
  enumType,
  values,
  discriminator,
} from "./composites.js";

export const t = {
  ...primitives,
  object,
  optional,
  array,
  nullable,
  enum: enumType,
  values,
  discriminator,
} as const;
