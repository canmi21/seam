/* tests/e2e/fixture/src/client/pages/form-skeleton.tsx */

import { type FormEvent, useState } from "react";
import { useSeamData } from "@canmi/seam-react";

interface FormData extends Record<string, unknown> {
  heading: string;
}

export function FormSkeleton() {
  const data = useSeamData<FormData>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  // eslint-disable-next-line seam/no-async-in-skeleton -- client-only handler
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      setState("error");
      setMessage("Name and email are required");
      return;
    }
    try {
      const res = await fetch("/_seam/rpc/submitContact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const json = (await res.json()) as {
        message?: string;
        error?: { code: string; message: string };
      };
      if (!res.ok || json.error) {
        setState("error");
        setMessage(json.error?.message ?? "Request failed");
        return;
      }
      setState("success");
      setMessage(json.message ?? "Submitted");
    } catch {
      setState("error");
      setMessage("Network error");
    }
  }

  return (
    <div>
      <h1>{data.heading}</h1>
      {state === "idle" && (
        <form data-testid="form" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="name-input">Name</label>
            <input
              id="name-input"
              data-testid="name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="email-input">Email</label>
            <input
              id="email-input"
              data-testid="email-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" data-testid="submit-btn">
            Submit
          </button>
        </form>
      )}
      {state === "success" && <p data-testid="success-msg">{message}</p>}
      {state === "error" && <p data-testid="error-msg">{message}</p>}
      <a href="/" data-testid="link-home">
        Back to Home
      </a>
    </div>
  );
}
