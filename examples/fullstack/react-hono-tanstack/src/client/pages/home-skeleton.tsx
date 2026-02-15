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
    <div className="mx-auto max-w-2xl px-4 py-10">
      {/* 1. Static content */}
      <header className="mb-8">
        {/* 2. Text binding */}
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {data.title}
        </h1>

        {/* 5. Nullable */}
        {data.subtitle && (
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{data.subtitle}</p>
        )}
      </header>

      {/* 3. Boolean && */}
      {data.isAdmin && (
        <span className="mb-4 inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900 dark:text-red-200">
          Admin
        </span>
      )}

      {/* 4. Boolean ternary */}
      {data.isLoggedIn ? (
        <p className="mb-6 text-sm text-green-700 dark:text-green-400">Signed in</p>
      ) : (
        <p className="mb-6 text-sm text-neutral-500 dark:text-neutral-400">Please sign in</p>
      )}

      {/* 6. Enum match */}
      <div className="mb-6 rounded border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700">
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

      {/* 7. List map */}
      {data.posts.length > 0 ? (
        <ul className="space-y-3">
          {data.posts.map((post) => (
            <li
              key={post.id}
              className={`rounded-lg border px-4 py-3 ${priorityStyles[post.priority] ?? priorityStyles.low}`}
            >
              {/* 8. Item text binding */}
              <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {post.title}
              </h2>

              {/* 9. Item boolean condition */}
              {post.isPublished ? (
                <span className="text-xs text-green-600 dark:text-green-400">Published</span>
              ) : (
                <span className="text-xs text-neutral-400">Draft</span>
              )}

              {/* 10. Item enum (priority) */}
              <span className="ml-2 text-xs text-neutral-500">
                {post.priority === "high" && "Priority: High"}
                {post.priority === "medium" && "Priority: Medium"}
                {post.priority === "low" && "Priority: Low"}
              </span>

              {/* Post author (nullable inside array item) */}
              {post.author && (
                <span className="ml-2 text-xs text-neutral-400">by {post.author}</span>
              )}

              {/* 11. Nested array (tags) */}
              {post.tags.length > 0 && (
                <div className="mt-1 flex gap-1">
                  {post.tags.map((tag) => (
                    <span
                      key={tag.name}
                      className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        // 12. Empty array fallback
        <p className="text-sm text-neutral-400">No posts yet</p>
      )}

      <footer className="mt-10 text-xs text-neutral-400">Powered by SeamJS CTR</footer>
    </div>
  );
}
