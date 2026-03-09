/* examples/fs-router-demo/src/pages/blog/[slug]/page.ts */

export const loaders = {
	post: { procedure: 'getBlogPost', params: { slug: 'route' } },
}

export const mock = {
	post: { title: 'Hello World', content: 'This is a blog post.', author: 'Author' },
}

export const head = (data: Record<string, unknown>) => ({
	title: `${data.title} | Blog`,
})
