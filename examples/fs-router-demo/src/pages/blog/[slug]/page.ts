/* examples/fs-router-demo/src/pages/blog/[slug]/page.ts */

export const loaders = {
  post: { procedure: 'getBlogPost', params: { slug: { from: 'route' } } },
}

export const mock = {
  post: { title: 'Hello World', content: 'This is a blog post.', author: 'Author' },
}
