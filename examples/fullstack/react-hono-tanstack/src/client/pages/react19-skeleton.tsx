/* examples/fullstack/react-hono-tanstack/src/client/pages/react19-skeleton.tsx */

import { Suspense, useCallback, useId, useMemo, useRef, useState } from "react";
import { useSeamData } from "@canmi/seam-react";

interface React19Data extends Record<string, unknown> {
  heading: string;
  description: string;
}

function Counter() {
  const [count, setCount] = useState(0);
  const increment = useCallback(() => setCount((c) => c + 1), []);

  return (
    <div className="mt-6 flex items-center gap-4">
      <button
        type="button"
        onClick={increment}
        className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        data-testid="increment-btn"
      >
        Increment
      </button>
      <span data-testid="counter-value">Count: {count}</span>
    </div>
  );
}

export function React19Skeleton() {
  const data = useSeamData<React19Data>();
  const nameId = useId();
  const emailId = useId();
  // useRef + useMemo exercised during SSR to verify they don't crash the pipeline
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const _headingLength = useMemo(() => data.heading.length, [data.heading]);
  void _headingLength;

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <title>{data.heading}</title>
      <meta name="description" content="React 19 feature demonstration page" />

      {/* Nav */}
      <nav className="mb-10 flex items-center gap-6 text-sm">
        <span className="font-semibold text-accent">SeamJS</span>
        <a href="/" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
          Home
        </a>
        <a
          href="/about"
          className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          About
        </a>
        <a
          href="/posts"
          className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          Posts
        </a>
        <a href="/react19" className="font-medium text-accent">
          React 19
        </a>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          {data.heading}
        </h1>
        <p className="mt-3 text-base text-neutral-600 dark:text-neutral-400">{data.description}</p>
      </header>

      {/* useId: two form fields with label/input association */}
      <section className="mb-8 space-y-4">
        <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-200">useId Form</h2>
        <div>
          <label
            htmlFor={nameId}
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            Name
          </label>
          <input
            id={nameId}
            type="text"
            className="mt-1 block w-full rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Enter name"
          />
        </div>
        <div>
          <label
            htmlFor={emailId}
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300"
          >
            Email
          </label>
          <input
            id={emailId}
            type="email"
            className="mt-1 block w-full rounded border border-neutral-300 px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Enter email"
          />
        </div>
      </section>

      {/* Suspense boundary */}
      <Suspense fallback={<p>Loading...</p>}>
        <p
          data-testid="suspense-content"
          className="text-sm text-neutral-600 dark:text-neutral-400"
        >
          Suspense-wrapped content loaded successfully.
        </p>
      </Suspense>

      {/* Interactive counter (useState + useCallback) */}
      <Counter />

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-400 dark:border-neutral-800">
        Built with <span className="text-accent">SeamJS</span>
      </footer>
    </div>
  );
}
