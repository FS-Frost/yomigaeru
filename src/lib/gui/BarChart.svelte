<script lang="ts">
	// Gráfico de barras en SVG propio (sin librería). Colores vía tokens CSS, legible en claro y oscuro.
	let {
		data,
		label,
		format = (v: number) => String(Math.round(v)),
		height = 140,
		highlight = -1,
	}: {
		data: { x: string; y: number }[];
		/** Descripción accesible del gráfico. */
		label: string;
		format?: (v: number) => string;
		height?: number;
		/** Índice resaltado (p. ej. hoy). */
		highlight?: number;
	} = $props();

	const max = $derived(Math.max(1, ...data.map((d) => d.y)));
	const W = 600;
	const pad = { top: 16, bottom: 20 };
	const bw = $derived(data.length ? W / data.length : W);
	// Mostrar etiquetas del eje x espaciadas para no amontonarlas.
	const every = $derived(Math.max(1, Math.ceil(data.length / 10)));
	let hover = $state<number | null>(null);
</script>

<figure class="w-full">
	<svg viewBox={`0 0 ${W} ${height}`} class="h-auto w-full" role="img" aria-label={label}>
		<line x1="0" x2={W} y1={height - pad.bottom} y2={height - pad.bottom} class="stroke-slate-200" stroke-width="1" />
		{#each data as d, i (i)}
			{@const h = ((height - pad.top - pad.bottom) * d.y) / max}
			<g role="presentation" onmouseenter={() => (hover = i)} onmouseleave={() => (hover = null)}>
				<rect x={i * bw} y={pad.top} width={bw} height={height - pad.top - pad.bottom} fill="transparent" />
				<rect
					x={i * bw + bw * 0.15}
					y={height - pad.bottom - h}
					width={bw * 0.7}
					height={Math.max(0, h)}
					rx="2"
					class={i === highlight ? 'fill-amber-500' : hover === i ? 'fill-sky-500' : 'fill-sky-600'}
				/>
				{#if i % every === 0}
					<text x={i * bw + bw / 2} y={height - 6} text-anchor="middle" class="fill-slate-400 text-[11px]">{d.x}</text>
				{/if}
				{#if hover === i}
					<text x={Math.min(W - 30, Math.max(30, i * bw + bw / 2))} y={Math.max(12, height - pad.bottom - h - 4)} text-anchor="middle" class="fill-slate-700 text-[12px] font-semibold"
						>{format(d.y)}</text
					>
				{/if}
			</g>
		{/each}
	</svg>
</figure>
