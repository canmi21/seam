<script lang="ts">
	let count = $state(0);
</script>

<h1>Compiled at build time</h1>
<p>This page was rendered once, by the compiler, and is served as it stands.</p>
<button onclick={() => count++}>Clicked {count} times</button>
