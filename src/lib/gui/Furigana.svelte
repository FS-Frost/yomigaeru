<script lang="ts">
	import { parseFurigana } from '$lib/furigana';

	let {
		text,
		class: className = '',
		showReadings = true,
	}: { text: string; class?: string; showReadings?: boolean } = $props();

	const segments = $derived(parseFurigana(text));
</script>

<span class={className}>
	{#each segments as seg, i (i)}
		{#if seg.rt && showReadings}
			<ruby>{seg.base}<rt>{seg.rt}</rt></ruby>
		{:else}
			{seg.base}
		{/if}
	{/each}
</span>
