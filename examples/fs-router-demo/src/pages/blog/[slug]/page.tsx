/* examples/fs-router-demo/src/pages/blog/[slug]/page.tsx */

import { useSeamData } from '@canmi/seam-react'

interface BlogData extends Record<string, unknown> {
	post: { title: string; content: string; author: string }
}

export default function BlogPostPage() {
	const data = useSeamData<BlogData>()
	return (
		<div>
			<h1>{data.post.title}</h1>
			<p>{data.post.content}</p>
			<span>By {data.post.author}</span>
		</div>
	)
}
