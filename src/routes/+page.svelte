<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { listDecks } from '$lib/db/decks';
	import { queueSummary, type QueueSummary } from '$lib/srs/queue';
	import { quotaMessage } from '$lib/srs/quota';
	import type { Deck } from '$lib/db/schema';
	import { loadDraft } from '$lib/db/drafts';
	import { app } from '$lib/state/app.svelte';

	let decks = $state<Deck[]>([]);
	let summary = $state<QueueSummary | null>(null);
	let loading = $state(true);
	let draftCount = $state(0);

	onMount(async () => {
		try {
			decks = await listDecks();
			summary = await queueSummary();
			const d = await loadDraft();
			draftCount = d?.groups.reduce((a, g) => a + g.proposals.length, 0) ?? 0;
		} catch (e) {
			app.error(e, 'No se pudieron cargar los datos');
		} finally {
			loading = false;
		}
	});

	const brakeMsg = $derived(summary ? quotaMessage(summary.quota, summary.reviews) : null);
	const due = $derived((summary?.reviews ?? 0) + (summary?.newToday ?? 0));
</script>

<header class="mb-5">
	<h1 class="text-2xl font-bold whitespace-nowrap">蘇る Yomigaeru</h1>
	<p class="text-sm text-slate-500">Japonés con repaso espaciado e IA</p>
</header>

{#if loading}
	<div class="space-y-3">
		<div class="h-36 animate-pulse rounded-2xl bg-slate-100"></div>
		<div class="h-16 animate-pulse rounded-2xl bg-slate-100"></div>
	</div>
{:else}
	<!-- Acción principal: estudiar -->
	<a href={`${base}/estudio`} class="block rounded-2xl p-5 shadow-sm transition active:scale-[.99] {due ? 'bg-brand text-brand-fg' : 'bg-surface border border-slate-200 text-slate-900'}">
		<div class="flex items-end justify-between gap-3">
			<div>
				<div class="text-5xl leading-none font-bold tabular-nums">{due}</div>
				<div class="mt-2 text-sm opacity-80">
					{due ? `para hoy · ${summary?.reviews ?? 0} repasos + ${summary?.newToday ?? 0} nuevas` : '¡Al día! No hay nada pendiente.'}
				</div>
			</div>
			{#if due}<span class="shrink-0 rounded-full bg-white/15 px-4 py-2 text-base font-semibold">Estudiar →</span>{/if}
		</div>
		{#if summary && summary.newAvailable > summary.newToday}
			<div class="mt-3 text-xs opacity-70">{summary.newAvailable - summary.newToday} nuevas esperan (cupo {summary.quota.limit}/día)</div>
		{/if}
	</a>

	{#if brakeMsg}
		<p class="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">{brakeMsg}</p>
	{/if}

	{#if draftCount}
		<a href={`${base}/crear`} class="mt-3 flex min-h-12 items-center gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 text-sm text-sky-800">
			<span class="flex-1">Tienes {draftCount} propuestas sin guardar</span>
			<span class="font-semibold">Revisar →</span>
		</a>
	{/if}

	<!-- Accesos -->
	<div class="mt-3 grid grid-cols-2 gap-3">
		<a href={`${base}/crear`} class="bg-surface flex min-h-20 flex-col justify-center rounded-2xl border border-slate-200 px-4 py-3 shadow-sm transition active:scale-[.98]">
			<span class="text-xl" aria-hidden="true">＋</span>
			<span class="font-semibold">Crear</span>
			<span class="text-xs text-slate-500">Palabra, texto o foto</span>
		</a>
		<a href={`${base}/crear?camara=1`} class="bg-surface flex min-h-20 flex-col justify-center rounded-2xl border border-slate-200 px-4 py-3 shadow-sm transition active:scale-[.98]">
			<span class="text-xl" aria-hidden="true">📷</span>
			<span class="font-semibold">Foto</span>
			<span class="text-xs text-slate-500">De un cartel o manga</span>
		</a>
		<a href={`${base}/mazos`} class="bg-surface flex min-h-20 flex-col justify-center rounded-2xl border border-slate-200 px-4 py-3 shadow-sm transition active:scale-[.98]">
			<span class="text-xl font-bold tabular-nums">{decks.length}</span>
			<span class="font-semibold">{decks.length === 1 ? 'Mazo' : 'Mazos'}</span>
		</a>
		<a href={`${base}/estadisticas`} class="bg-surface flex min-h-20 flex-col justify-center rounded-2xl border border-slate-200 px-4 py-3 shadow-sm transition active:scale-[.98]">
			<span class="text-xl" aria-hidden="true">📊</span>
			<span class="font-semibold">Estadísticas</span>
			<span class="text-xs text-slate-500">Racha y retención</span>
		</a>
	</div>

	{#if decks.length === 0}
		<div class="mt-6 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
			Aún no tienes tarjetas. Escribe una palabra, pega un texto o saca una foto en
			<a href={`${base}/crear`} class="font-medium text-slate-900 underline">Crear</a>, o importa un mazo de Anki en
			<a href={`${base}/mazos`} class="font-medium text-slate-900 underline">Mazos</a>.
		</div>
	{/if}

	<p class="mt-8 text-center">
		<a href="https://github.com/FS-Frost/yomigaeru" target="_blank" rel="noopener noreferrer" class="text-xs text-slate-400 underline hover:text-slate-600">Código en GitHub</a>
	</p>
{/if}
