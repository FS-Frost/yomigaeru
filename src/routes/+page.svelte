<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { listDecks } from '$lib/db/decks';
	import { countDue } from '$lib/srs/queue';
	import type { Deck } from '$lib/db/schema';

	let decks = $state<Deck[]>([]);
	let due = $state(0);
	let loading = $state(true);

	onMount(async () => {
		decks = await listDecks();
		due = await countDue();
		loading = false;
	});
</script>

<h1 class="mb-1 text-2xl font-bold">蘇る Yomigaeru</h1>
<p class="mb-6 text-slate-500">Repaso espaciado de japonés con IA.</p>

{#if loading}
	<p class="text-slate-400">Cargando…</p>
{:else}
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<a href={`${base}/estudio`} class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-900">
			<div class="text-3xl font-bold">{due}</div>
			<div class="text-sm text-slate-500">tarjetas por repasar</div>
		</a>
		<a href={`${base}/mazos`} class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-900">
			<div class="text-3xl font-bold">{decks.length}</div>
			<div class="text-sm text-slate-500">mazos</div>
		</a>
	</div>

	{#if decks.length === 0}
		<div class="mt-6 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
			Aún no tienes mazos. <a href={`${base}/mazos`} class="font-medium text-slate-900 underline">Crea el primero</a>.
		</div>
	{/if}
{/if}
