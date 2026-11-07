<script lang="ts">
	// Progreso de una generación con IA: etapas, tiempo, tarjetas recibidas y Cancelar.
	import { onDestroy } from 'svelte';
	import type { Stage } from '$lib/gemini/stream';
	import { fmtUsd } from '$lib/gemini/pricing';

	let {
		stage,
		startedAt,
		count = 0,
		label = 'Generando',
		retrying = false,
		step = null,
		estimate = null,
		oncancel,
	}: {
		stage: Stage;
		startedAt: number;
		count?: number;
		label?: string;
		/** Reintento automático en curso (la IA se atascó). */
		retrying?: boolean;
		/** Foto i de n en una cola. */
		step?: { i: number; n: number } | null;
		estimate?: number | null;
		oncancel: () => void;
	} = $props();

	let now = $state(Date.now());
	const timer = setInterval(() => (now = Date.now()), 250);
	onDestroy(() => clearInterval(timer));

	const STAGES: { key: Stage; label: string }[] = [
		{ key: 'sending', label: 'Enviando' },
		{ key: 'thinking', label: 'Pensando' },
		{ key: 'writing', label: 'Escribiendo' },
	];
	const order = (s: Stage) => (s === 'done' ? 3 : STAGES.findIndex((x) => x.key === s));
	const secs = $derived(Math.max(0, (now - startedAt) / 1000));
</script>

<div class="bg-surface rounded-2xl border border-sky-200 p-4 shadow-sm" role="status" aria-live="polite">
	<div class="flex items-center gap-3">
		<span class="relative flex size-3 shrink-0">
			<span class="absolute inline-flex size-full animate-ping rounded-full bg-sky-400 opacity-75"></span>
			<span class="relative inline-flex size-3 rounded-full bg-sky-500"></span>
		</span>
		<p class="min-w-0 flex-1 font-medium">
			{label}{#if step && step.n > 1}<span class="text-slate-500"> · foto {step.i} de {step.n}</span>{/if}
		</p>
		<span class="text-sm text-slate-500 tabular-nums">{secs.toFixed(0)} s</span>
	</div>

	<ol class="mt-3 flex items-center gap-1 text-xs" aria-label="Etapas">
		{#each STAGES as s, i (s.key)}
			{@const state = order(stage) > i ? 'done' : order(stage) === i ? 'now' : 'todo'}
			<li class="flex flex-1 flex-col gap-1">
				<span class="h-1.5 rounded-full {state === 'done' ? 'bg-sky-500' : state === 'now' ? 'animate-pulse bg-sky-300' : 'bg-slate-200'}"></span>
				<span class={state === 'todo' ? 'text-slate-400' : 'text-slate-700'}>{s.label}</span>
			</li>
		{/each}
	</ol>

	<div class="mt-3 flex items-center gap-3">
		<p class="min-w-0 flex-1 text-sm text-slate-600">
			{#if retrying}
				<span class="text-amber-600">La IA se atascó; reintentando…</span>
			{:else if count}
				{count} {count === 1 ? 'tarjeta lista' : 'tarjetas listas'}
			{:else if stage === 'thinking'}
				Leyendo y eligiendo palabras…
			{:else}
				Un momento…
			{/if}
			{#if estimate != null}<span class="text-slate-400"> · ≈ {fmtUsd(estimate)}</span>{/if}
		</p>
		<button class="min-h-10 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-slate-100" onclick={oncancel}>Cancelar</button>
	</div>
</div>
