/* examples/github-dashboard/shared/components/username-form.tsx */

import { useState } from "react";

export function UsernameForm({ onSubmit }: { onSubmit: (username: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = value.trim();
        if (trimmed) onSubmit(trimmed);
      }}
      className="flex gap-3"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="GitHub username"
        className="flex-1 rounded-lg border border-border bg-input px-4 py-2 text-primary placeholder:text-muted focus:border-accent focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-lg bg-accent px-6 py-2 font-medium text-white transition-colors hover:bg-accent-hover"
      >
        View
      </button>
    </form>
  );
}
