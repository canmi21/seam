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
    <div className="mx-auto max-w-2xl px-6 py-10">
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
        <a href="/posts" className="font-medium text-accent">
          Posts
        </a>
      </nav>

      <header className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            {data.heading}
          </h1>

          {data.showDrafts && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              Drafts visible
            </span>
          )}
        </div>
      </header>

      {data.posts.length > 0 ? (
        <ul className="space-y-4">
          {data.posts.map((post) => (
            <li
              key={post.id}
              className="rounded-lg border border-neutral-200 px-5 py-4 dark:border-neutral-700"
            >
              <div className="flex items-center gap-2">
                <h2 className="text-base font-medium text-neutral-900 dark:text-neutral-100">
                  {post.title}
                </h2>

                {post.isPublished ? (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900 dark:text-green-300">
                    Published
                  </span>
                ) : (
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    Draft
                  </span>
                )}
              </div>

              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">{post.excerpt}</p>

              {post.author && (
                <span className="mt-2 block text-xs text-neutral-400">by {post.author}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-neutral-400">No posts yet</p>
      )}

      <footer className="mt-12 border-t border-neutral-200 pt-6 text-xs text-neutral-400 dark:border-neutral-800">
        Built with <span className="text-accent">SeamJS</span>
      </footer>
    </div>
  );
}
