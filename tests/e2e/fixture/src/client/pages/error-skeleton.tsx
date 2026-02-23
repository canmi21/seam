/* tests/e2e/fixture/src/client/pages/error-skeleton.tsx */

import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import { useSeamData } from "@canmi/seam-react";

interface ErrorData extends Record<string, unknown> {
  heading: string;
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void error;
    void info;
  }

  render() {
    if (this.state.hasError) {
      return <p data-testid="error-fallback">Something went wrong: a rendering error occurred.</p>;
    }
    return this.props.children;
  }
}

function BrokenComponent() {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    throw new Error("Intentional test error");
  }

  return (
    <div>
      <p data-testid="normal-content">Everything is working normally.</p>
      <button type="button" data-testid="trigger-error" onClick={() => setShouldThrow(true)}>
        Trigger Error
      </button>
    </div>
  );
}

export function ErrorSkeleton() {
  const data = useSeamData<ErrorData>();

  return (
    <div>
      <h1>{data.heading}</h1>
      <ErrorBoundary>
        <BrokenComponent />
      </ErrorBoundary>
      <a href="/" data-testid="link-home">
        Back to Home
      </a>
    </div>
  );
}
