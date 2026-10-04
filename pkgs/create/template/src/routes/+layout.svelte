<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<nav>
	<a href="/">Home</a>
	<a href="/hello">Hello</a>
</nav>

{@render children()}
