<script lang="ts">
	import type { RatingKey } from '$lib/srs/fsrs';

	let {
		intervals,
		onrate,
		suggested = null,
		hideEasy = false,
	}: {
		intervals: Record<RatingKey, number>;
		onrate: (key: RatingKey) => void;
		/** Nota sugerida (juez IA o acierto): se resalta. */
		suggested?: RatingKey | null;
		/** Al elegir entre opciones no hay «Fácil» (reconocer no es recordar). */
		hideEasy?: boolean;
	} = $props();

	const all: { key: RatingKey; label: string; class: string; shortcut: string }[] = [
		{ key: 'again', label: 'Repetir', class: 'bg-red-600', shortcut: '1' },
		{ key: 'hard', label: 'Difícil', class: 'bg-orange-500', shortcut: '2' },
		{ key: 'good', label: 'Bien', class: 'bg-emerald-600', shortcut: '3' },
		{ key: 'easy', label: 'Fácil', class: 'bg-sky-600', shortcut: '4' },
	];
	const buttons = $derived(hideEasy ? all.filter((b) => b.key !== 'easy') : all);

	/** Intervalo legible: minutos, horas, días, meses, años. */
	function fmt(days: number): string {
		const min = days * 1440;
		if (min < 60) return `${Math.max(1, Math.round(min))}min`;
		if (days < 1) return `${Math.round(min / 60)}h`;
		if (days < 30) return `${Math.round(days)}d`;
		if (days < 365) return `${Math.round(days / 30)}mes`;
		return `${(days / 365).toFixed(1)}a`;
	}
</script>

<div class="grid gap-2 {buttons.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}">
	{#each buttons as b (b.key)}
		<button
			class="relative flex min-h-14 flex-col items-center justify-center rounded-lg px-2 py-4 font-medium text-white transition select-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[.97] sm:py-3 {b.class} {suggested &&
			suggested !== b.key
				? 'opacity-60'
				: ''} {suggested === b.key ? 'ring-4 ring-amber-300' : ''}"
			onclick={() => onrate(b.key)}
		>
			<span>{b.label}</span>
			<span class="text-xs opacity-80">{fmt(intervals[b.key])}</span>
			<kbd class="absolute top-1 left-2 hidden text-[0.65rem] opacity-60 sm:inline">{b.shortcut}</kbd>
		</button>
	{/each}
</div>
