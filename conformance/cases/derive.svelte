<script>let { data } = $props()</script><div>{#if data.price > 10}<b>pricey</b>{:else}<i>cheap</i>{/if}<span>{data.name.toUpperCase()}</span>{#if data.tags.length === 0}<em>none</em>{/if}</div>
