/* examples/github-dashboard/next-app/app/username-form-wrapper.tsx */

"use client";

import { useRouter } from "next/navigation";
import { UsernameForm } from "@github-dashboard/shared/components/username-form.js";

export function UsernameFormWrapper() {
  const router = useRouter();
  return <UsernameForm onSubmit={(username) => router.push(`/dashboard/${username}`)} />;
}
