<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		onclick,
		children,
	}: {
		/** aria-label; el contenido suele ser un ícono/glifo. */
		label: string;
		onclick?: () => void;
		children: Snippet;
	} = $props();
</script>

<button
	type="button"
	aria-label={label}
	{onclick}
	class="bottom-nav fixed right-4 z-30 inline-flex min-h-14 items-center gap-2 rounded-full bg-slate-900 px-5 text-base font-semibold text-white shadow-lg transition select-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-95 sm:bottom-6"
>
	{@render children()}
</button>
