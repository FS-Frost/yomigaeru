<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { loadStats, type Stats } from '$lib/srs/stats';
	import { LEECH_LAPSES, MASTERED_DAYS } from '$lib/srs/constants';
	import { app } from '$lib/state/app.svelte';
	import BarChart from '$lib/gui/BarChart.svelte';
	import Furigana from '$lib/gui/Furigana.svelte';

	let stats = $state<Stats | null>(null);

	onMount(async () => {
		try {
			stats = await loadStats();
		} catch {
			app.toast('No se pudieron calcular las estadísticas', 'error');
		}
	});

	const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`);
	const today = new Date();
	const dayLabel = (offset: number) => {
		const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
		return `${d.getDate()}/${d.getMonth() + 1}`;
	};
	const STATUS = [
		['new', 'Nuevas', 'bg-slate-300'],
		['learning', 'Aprendiendo', 'bg-amber-500'],
		['review', 'En repaso', 'bg-sky-600'],
		['mastered', `Dominadas (≥ ${MASTERED_DAYS} d)`, 'bg-emerald-600'],
	] as const;
	const totalFaces = $derived(stats ? Object.values(stats.status).reduce((a, b) => a + b, 0) : 0);
</script>

<h1 class="mb-4 text-2xl font-bold">Estadísticas</h1>

{#if !stats}
	<p class="text-slate-400">Calculando…</p>
{:else}
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		{#each [[`${stats.streak.current} d`, `Racha (máx. ${stats.streak.best})`], [pct(stats.retention30.rate), `Retención 30 d (${stats.retention30.n})`], [String(stats.totalReviews), 'Repasos totales'], [stats.avgSeconds == null ? '—' : `${stats.avgSeconds.toFixed(1)} s`, 'Tiempo por tarjeta']] as [v, l] (l)}
			<div class="bg-surface rounded-xl border border-slate-200 p-3 shadow-sm">
				<div class="text-2xl font-bold">{v}</div>
				<div class="text-xs text-slate-500">{l}</div>
			</div>
		{/each}
	</div>
	<p class="mt-2 text-xs text-slate-400">
		Retención = aciertos en repasos de caras ya consolidadas, hechos al menos un día después del anterior. Histórica: {pct(stats.retentionAll.rate)}.
	</p>

	<section class="bg-surface mt-6 rounded-xl border border-slate-200 p-4 shadow-sm">
		<h2 class="mb-2 font-semibold">Previsión: repasos de los próximos 30 días</h2>
		<BarChart label="Repasos previstos por día" data={stats.forecast.map((y, i) => ({ x: i === 0 ? 'hoy' : dayLabel(i), y }))} highlight={0} />
	</section>

	<section class="bg-surface mt-4 rounded-xl border border-slate-200 p-4 shadow-sm">
		<h2 class="mb-2 font-semibold">Repasos hechos: últimos 30 días</h2>
		<BarChart label="Repasos por día" data={stats.perDay.map((y, i) => ({ x: i === 29 ? 'hoy' : dayLabel(i - 29), y }))} highlight={29} />
	</section>

	<section class="bg-surface mt-4 rounded-xl border border-slate-200 p-4 shadow-sm">
		<h2 class="mb-2 font-semibold">Estado de las caras ({totalFaces})</h2>
		{#if totalFaces}
			<div class="flex h-4 overflow-hidden rounded-full" role="img" aria-label="Distribución por estado">
				{#each STATUS as [k, , cls] (k)}
					<div class={cls} style:width={`${(stats.status[k] / totalFaces) * 100}%`}></div>
				{/each}
			</div>
		{/if}
		<ul class="mt-2 grid grid-cols-2 gap-1 text-sm sm:grid-cols-4">
			{#each STATUS as [k, label, cls] (k)}
				<li class="flex items-center gap-2"><span class="size-3 rounded-sm {cls}"></span>{label}: <b>{stats.status[k]}</b></li>
			{/each}
		</ul>
	</section>

	<section class="bg-surface mt-4 rounded-xl border border-slate-200 p-4 shadow-sm">
		<h2 class="mb-2 font-semibold">Por mazo</h2>
		<div class="overflow-x-auto">
			<table class="w-full text-sm">
				<thead class="text-left text-slate-500">
					<tr><th class="py-1 pr-2">Mazo</th><th class="px-2">Tarjetas</th><th class="px-2">Vencidas</th><th class="px-2">Se resisten</th><th class="px-2">Suspendidas</th></tr>
				</thead>
				<tbody>
					{#each stats.decks as d (d.id)}
						<tr class="border-t border-slate-100">
							<td class="py-1 pr-2"><a class="underline" href={`${base}/estudio?mazo=${d.id}`}>{d.name}</a></td>
							<td class="px-2">{d.cards}</td>
							<td class="px-2">{d.due}</td>
							<td class="px-2">{d.leeches}</td>
							<td class="px-2">{d.suspended}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<section class="bg-surface mt-4 rounded-xl border border-slate-200 p-4 shadow-sm">
		<h2 class="mb-1 font-semibold">Tarjetas que se resisten</h2>
		<p class="mb-2 text-sm text-slate-500">≥ {LEECH_LAPSES} fallos tras haberlas aprendido. Edítalas (mejor contexto, otra pista) o suspéndelas desde Mazos.</p>
		{#if stats.leeches.length}
			<ul class="divide-y divide-slate-100">
				{#each stats.leeches.slice(0, 30) as l (l.card.id)}
					<li class="flex justify-between gap-2 py-1"><span><Furigana text={l.card.front} /> — {l.card.back}</span><span class="text-slate-400">{l.lapses} fallos</span></li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-slate-400">Ninguna. 🎉</p>
		{/if}
	</section>
{/if}
