<script lang="ts">
	// Sección plegable de Ajustes con resumen en la cabecera. Se abre sola si la URL apunta a ella (#id).
	import { onMount, type Snippet } from 'svelte';

	let { id, title, summary = '', open = $bindable(false), children }: { id: string; title: string; summary?: string; open?: boolean; children: Snippet } = $props();
	let el = $state<HTMLDetailsElement | null>(null);

	onMount(() => {
		const check = () => {
			if (location.hash === `#${id}`) {
				open = true;
				requestAnimationFrame(() => el?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
			}
		};
		check();
		window.addEventListener('hashchange', check);
		return () => window.removeEventListener('hashchange', check);
	});
</script>

<!-- `name` común = acordeón nativo: abrir una sección cierra las demás. -->
<details {id} name="ajustes" bind:this={el} bind:open class="group bg-surface scroll-mt-4 rounded-2xl border border-slate-200 shadow-sm">
	<summary class="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 select-none [&::-webkit-details-marker]:hidden">
		<span class="min-w-0 flex-1">
			<span class="block font-semibold">{title}</span>
			{#if summary}<span class="block truncate text-xs text-slate-500">{summary}</span>{/if}
		</span>
		<span class="shrink-0 text-slate-400 transition group-open:rotate-180" aria-hidden="true">⌄</span>
	</summary>
	<div class="border-t border-slate-100 px-4 pt-3 pb-4">
		{@render children()}
	</div>
</details>
