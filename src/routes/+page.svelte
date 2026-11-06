<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { listDecks } from '$lib/db/decks';
	import { queueSummary, type QueueSummary } from '$lib/srs/queue';
	import { quotaMessage } from '$lib/srs/quota';
	import type { Deck } from '$lib/db/schema';
	import { app } from '$lib/state/app.svelte';

	let decks = $state<Deck[]>([]);
	let summary = $state<QueueSummary | null>(null);
	let loading = $state(true);

	onMount(async () => {
		try {
			decks = await listDecks();
			summary = await queueSummary();
		} catch {
			app.toast('No se pudieron cargar los datos', 'error');
		} finally {
			loading = false;
		}
	});

	const brakeMsg = $derived(summary ? quotaMessage(summary.quota, summary.reviews) : null);
</script>

<h1 class="mb-1 text-2xl font-bold">蘇る Yomigaeru</h1>
<p class="mb-2 text-slate-500">Repaso espaciado de japonés con IA.</p>
<p class="mb-6">
	<a href="https://github.com/FS-Frost/yomigaeru" target="_blank" rel="noopener noreferrer" class="text-sm font-medium text-slate-600 underline hover:text-slate-900"> Ver en GitHub </a>
</p>

{#if loading}
	<p class="text-slate-400">Cargando…</p>
{:else}
	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<a href={`${base}/estudio`} class="bg-surface rounded-xl border border-slate-200 p-4 shadow-sm transition hover:border-slate-900">
			<div class="text-3xl font-bold">{(summary?.reviews ?? 0) + (summary?.newToday ?? 0)}</div>
			<div class="text-sm text-slate-500">
				pendientes hoy · {summary?.reviews ?? 0} repasos + {summary?.newToday ?? 0} nuevas
			</div>
			{#if summary && summary.newAvailable > summary.newToday}
				<div class="mt-1 text-xs text-slate-400">{summary.newAvailable - summary.newToday} nuevas esperan (cupo {summary.quota.limit}/día)</div>
			{/if}
		</a>
		<a href={`${base}/mazos`} class="bg-surface rounded-xl border border-slate-200 p-4 shadow-sm transition hover:border-slate-900">
			<div class="text-3xl font-bold">{decks.length}</div>
			<div class="text-sm text-slate-500">mazos</div>
		</a>
		<a href={`${base}/estadisticas`} class="bg-surface rounded-xl border border-slate-200 p-4 shadow-sm transition hover:border-slate-900 sm:col-span-2">
			<div class="font-semibold">📊 Estadísticas</div>
			<div class="text-sm text-slate-500">Previsión, retención, racha y tarjetas que se resisten.</div>
		</a>
	</div>

	{#if brakeMsg}
		<p class="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">{brakeMsg}</p>
	{/if}

	{#if decks.length === 0}
		<div class="mt-6 rounded-xl border border-dashed border-slate-300 p-6 text-center text-slate-500">
			Aún no tienes mazos. <a href={`${base}/mazos`} class="font-medium text-slate-900 underline">Crea el primero</a>,
			<a href={`${base}/foto`} class="font-medium text-slate-900 underline">saca una foto</a> o
			<a href={`${base}/crear`} class="font-medium text-slate-900 underline">pega un texto</a>.
		</div>
	{/if}
{/if}
