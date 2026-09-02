<script>let { data } = $props()</script><div>{#each data.xs as x}item {x}<b>.</b>{/each}</div>{#if data.t}<b>y</b>{/if}
