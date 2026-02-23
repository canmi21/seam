/* tests/e2e/fixture/src/server/procedures.ts */

import { t } from "@canmi/seam-server";
import type { ProcedureDef } from "@canmi/seam-server";

export const getHomeData: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    title: t.string(),
    message: t.string(),
  }),
  handler: () => ({
    title: "E2E Fixture",
    message: "Hydration test page.",
  }),
};

export const getReact19Data: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    heading: t.string(),
    description: t.string(),
  }),
  handler: () => ({
    heading: "React 19 Features",
    description: "Demonstrating useId, Suspense, useState, useRef, useMemo, and metadata hoisting.",
  }),
};

export const getFormPageData: ProcedureDef = {
  input: t.object({}),
  output: t.object({ heading: t.string() }),
  handler: () => ({ heading: "Contact Form" }),
};

export const submitContact: ProcedureDef = {
  input: t.object({
    name: t.string(),
    email: t.string(),
  }),
  output: t.object({ message: t.string() }),
  handler: (ctx) => {
    const { name, email } = (ctx as { input: { name: string; email: string } }).input;
    return { message: `Thanks, ${name}! We will contact you at ${email}.` };
  },
};

export const getErrorPageData: ProcedureDef = {
  input: t.object({}),
  output: t.object({ heading: t.string() }),
  handler: () => ({ heading: "Error Boundary Test" }),
};

export const getAsyncPageData: ProcedureDef = {
  input: t.object({}),
  output: t.object({ heading: t.string() }),
  handler: () => ({ heading: "Async Loading Test" }),
};

export const getAsyncItems: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    items: t.array(t.object({ id: t.int32(), label: t.string() })),
  }),
  handler: () => ({
    items: [
      { id: 1, label: "Alpha" },
      { id: 2, label: "Beta" },
      { id: 3, label: "Gamma" },
    ],
  }),
};
