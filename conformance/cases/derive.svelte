<script>let { p } = $props()</script><div>{#if p.price > 10}<b>pricey</b>{:else}<i>cheap</i>{/if}<span>{p.name.toUpperCase()}</span>{#if p.tags.length === 0}<em>none</em>{/if}</div>
