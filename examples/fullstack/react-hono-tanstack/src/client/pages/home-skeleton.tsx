/* examples/fullstack/react-hono-tanstack/src/client/pages/home-skeleton.tsx */

import { useSeamData } from "@canmi/seam-react";

interface Tag {
  name: string;
}

interface Post {
  id: string;
  title: string;
  isPublished: boolean;
  priority: "high" | "medium" | "low";
  author: string | null;
  tags: Tag[];
}

interface PageData extends Record<string, unknown> {
  title: string;
  isAdmin: boolean;
  isLoggedIn: boolean;
  subtitle: string | null;
  role: "admin" | "member" | "guest";
  posts: Post[];
}

const priorityStyles: Record<string, string> = {
  high: "border-red-300 dark:border-red-700",
  medium: "border-amber-300 dark:border-amber-700",
  low: "border-neutral-200 dark:border-neutral-700",
};

/** SSR skeleton and hydration component — demonstrates 12 React rendering patterns */
export function HomeSkeleton() {
  const data = useSeamData<PageData>();

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      {/* Nav */}
      <nav className="mb-10 flex items-center gap-6 text-sm">
        <span className="font-semibold text-accent">SeamJS</span>
        <a href="/" className="font-medium text-accent">Home</a>
        <a href="/about" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">About</a>
        <a href="/posts" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">Posts</a>
      </nav>

      {/* 1. Static content */}
      <header className="mb-8">
        {/* 2. Text binding */}
        <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          {data.title}
        </h1>

        {/* 5. Nullable */}
        {data.subtitle && (
          <p className="mt-2 text-base text-neutral-500 dark:text-neutral-400">{data.subtitle}</p>
        )}
      </header>

      {/* Status strip: each conditional isolated in its own wrapper for CTR extraction */}
      <div className="mb-8 flex items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-sm dark:border-neutral-700">
        {/* 3. Boolean && */}
        <div>
          {data.isAdmin && (
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
              Admin
            </span>
          )}
        </div>

        {/* 4. Boolean ternary */}
        <div>
          {data.isLoggedIn ? (
            <span className="text-green-700 dark:text-green-400">Signed in</span>
          ) : (
            <span className="text-neutral-500 dark:text-neutral-400">Please sign in</span>
          )}
        </div>

        <span className="text-neutral-300 dark:text-neutral-600">|</span>

        {/* 6. Enum match */}
        <div>
          {data.role === "admin" && (
            <span className="font-medium text-red-700 dark:text-red-400">Full access</span>
          )}
          {data.role === "member" && (
            <span className="font-medium text-blue-700 dark:text-blue-400">Member access</span>
          )}
          {data.role === "guest" && (
            <span className="font-medium text-neutral-500 dark:text-neutral-400">Read-only</span>
          )}
        </div>
      </div>

      {/* 7. List map */}
      {data.posts.length > 0 ? (
        <ul className="space-y-4">
          {data.posts.map((post) => (
            <li
              key={post.id}
              className={`rounded-lg border px-5 py-4 ${priorityStyles[post.priority] ?? priorityStyles.low}`}
            >
              <div className="flex items-center gap-2">
                {/* 8. Item text binding */}
                <h2 className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                  {post.title}
                </h2>

                {/* 9. Item boolean condition */}
                {post.isPublished ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">Published</span>
                ) : (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Draft</span>
                )}
              </div>

              <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
                {/* 10. Item enum (priority) */}
                <span>
                  {post.priority === "high" && "Priority: High"}
                  {post.priority === "medium" && "Priority: Medium"}
                  {post.priority === "low" && "Priority: Low"}
                </span>

                {/* Post author (nullable inside array item) */}
                {post.author && (
                  <span className="text-neutral-400">by {post.author}</span>
                )}
              </div>

              {/* 11. Nested array (tags) — wrapper always renders so extraction
                  captures only the inner <span> as the repeating element */}
              <div className="mt-2 flex gap-1.5">
                {post.tags.map((tag) => (
                  <span
                    key={tag.name}
                    className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        // 12. Empty array fallback
        <p className="text-sm text-neutral-400">No posts yet</p>
      )}

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-400 dark:border-neutral-800">
        Built with <span className="text-accent">SeamJS</span>
      </footer>
    </div>
  );
}
