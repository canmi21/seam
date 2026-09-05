<script>let { data } = $props()</script><ul>{#each data.rows as row, i (row.id)}<li>{i}: {row.name}{#each row.tags as tag, j}<b>{i}{j}{tag}</b>{/each}</li>{/each}</ul>
