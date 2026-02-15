/* examples/fullstack/react-hono-tanstack/src/client/pages/posts-skeleton.tsx */

import { useSeamData } from "@canmi/seam-react";

interface Post {
  id: string;
  title: string;
  isPublished: boolean;
  excerpt: string;
  author: string | null;
}

interface PostsData extends Record<string, unknown> {
  heading: string;
  showDrafts: boolean;
  posts: Post[];
}

export function PostsSkeleton() {
  const data = useSeamData<PostsData>();

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          {data.heading}
        </h1>

        {data.showDrafts && (
          <span className="mt-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            Drafts visible
          </span>
        )}
      </header>

      {data.posts.length > 0 ? (
        <ul className="space-y-3">
          {data.posts.map((post) => (
            <li
              key={post.id}
              className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-700"
            >
              <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {post.title}
              </h2>

              {post.isPublished ? (
                <span className="text-xs text-green-600 dark:text-green-400">Published</span>
              ) : (
                <span className="text-xs text-neutral-400">Draft</span>
              )}

              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{post.excerpt}</p>

              {post.author && (
                <span className="mt-1 block text-xs text-neutral-400">by {post.author}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-400">No posts yet</p>
      )}

      <footer className="mt-10 text-xs text-neutral-400">Powered by SeamJS CTR</footer>
    </div>
  );
}
