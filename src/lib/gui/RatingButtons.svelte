<script lang="ts">
	import type { RatingKey } from '$lib/srs/fsrs';

	let { intervals, onrate }: { intervals: Record<RatingKey, number>; onrate: (key: RatingKey) => void } = $props();

	const buttons: { key: RatingKey; label: string; class: string }[] = [
		{ key: 'again', label: 'Repetir', class: 'bg-red-600' },
		{ key: 'hard', label: 'Difícil', class: 'bg-orange-500' },
		{ key: 'good', label: 'Bien', class: 'bg-emerald-600' },
		{ key: 'easy', label: 'Fácil', class: 'bg-sky-600' },
	];

	function fmt(days: number): string {
		if (days < 1) return '<1d';
		if (days < 30) return `${Math.round(days)}d`;
		if (days < 365) return `${Math.round(days / 30)}mes`;
		return `${(days / 365).toFixed(1)}a`;
	}
</script>

<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
	{#each buttons as b (b.key)}
		<button
			class="flex min-h-14 flex-col items-center justify-center rounded-lg px-2 py-4 font-medium text-white transition select-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[.97] sm:py-3 {b.class}"
			onclick={() => onrate(b.key)}
		>
			<span>{b.label}</span>
			<span class="text-xs opacity-80">{fmt(intervals[b.key])}</span>
		</button>
	{/each}
</div>
