<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<h1>Hello {data.name}</h1>
<p>Rendered at build time, filled in at {data.at}.</p>
