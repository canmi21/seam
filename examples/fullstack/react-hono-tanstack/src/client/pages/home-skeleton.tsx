/* examples/fullstack/react-hono-tanstack/src/client/pages/home-skeleton.tsx */

/** SSR-safe skeleton for the home page; hydrated by client-side App */
export function HomeSkeleton() {
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Message Board
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        RPC query + mutation via TanStack Query, real-time SSE subscription
      </p>
      <div className="mt-6">
        <p className="p-8 text-sm text-neutral-400">Loading...</p>
      </div>
    </div>
  );
}
