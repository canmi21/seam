/* tests/e2e/fixture/src/client/pages/react19-skeleton.tsx */

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
    <div>
      <button type="button" onClick={increment} data-testid="increment-btn">
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
    <div>
      <title>{data.heading}</title>
      <meta name="description" content="React 19 feature demonstration page" />

      <h1>{data.heading}</h1>
      <p>{data.description}</p>

      {/* useId: two form fields with label/input association */}
      <section>
        <h2>useId Form</h2>
        <div>
          <label htmlFor={nameId}>Name</label>
          <input id={nameId} type="text" placeholder="Enter name" />
        </div>
        <div>
          <label htmlFor={emailId}>Email</label>
          <input id={emailId} type="email" placeholder="Enter email" />
        </div>
      </section>

      {/* Suspense boundary */}
      <Suspense fallback={<p>Loading...</p>}>
        <p data-testid="suspense-content">Suspense-wrapped content loaded successfully.</p>
      </Suspense>

      {/* Interactive counter (useState + useCallback) */}
      <Counter />
    </div>
  );
}
