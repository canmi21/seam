<script>let { p } = $props()</script><article class="card"><h1>{p.name}</h1>{#if p.available}<button>Buy</button>{/if}{#each p.tags as t}<span>{t}</span>{/each}</article>
