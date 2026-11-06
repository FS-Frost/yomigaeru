<script lang="ts">
	// Imagen de contexto de una tarjeta. `box` resalta la palabra; `crop` muestra solo la región
	// ampliada (con margen) y `mask` tapa la palabra para la cara «visual».
	import { imageUrl } from '$lib/db/images';
	import type { Box } from '$lib/db/schema';

	let {
		imageId,
		box,
		crop = false,
		mask = false,
		class: className = '',
		alt = 'Imagen de contexto',
	}: { imageId: number; box?: Box; crop?: boolean; mask?: boolean; class?: string; alt?: string } = $props();

	let url = $state<string | null>(null);
	let natural = $state<{ w: number; h: number } | null>(null);

	$effect(() => {
		const id = imageId;
		url = null;
		natural = null;
		imageUrl(id).then((u) => {
			if (id === imageId) url = u;
		});
	});

	function onload(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		natural = { w: img.naturalWidth, h: img.naturalHeight };
	}

	// Región visible (0–1) al recortar: la caja con margen alrededor, al menos 30 % del lado.
	const view = $derived.by(() => {
		if (!box || !crop) return { x: 0, y: 0, w: 1, h: 1 };
		const [y0, x0, y1, x1] = box.map((n) => n / 1000);
		const pad = 0.6;
		const bw = x1 - x0;
		const bh = y1 - y0;
		const w = Math.min(1, Math.max(0.3, bw * (1 + 2 * pad)));
		const h = Math.min(1, Math.max(0.3, bh * (1 + 2 * pad)));
		const cx = (x0 + x1) / 2;
		const cy = (y0 + y1) / 2;
		return { x: Math.min(1 - w, Math.max(0, cx - w / 2)), y: Math.min(1 - h, Math.max(0, cy - h / 2)), w, h };
	});

	const ratio = $derived(natural ? (natural.w * view.w) / (natural.h * view.h) : 4 / 3);

	/** Caja relativa a la región visible, en %. */
	const rel = $derived.by(() => {
		if (!box) return null;
		const [y0, x0, y1, x1] = box.map((n) => n / 1000);
		return {
			left: ((x0 - view.x) / view.w) * 100,
			top: ((y0 - view.y) / view.h) * 100,
			width: ((x1 - x0) / view.w) * 100,
			height: ((y1 - y0) / view.h) * 100,
		};
	});
</script>

<div class="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100 {className}" style:aspect-ratio={ratio}>
	{#if url}
		<img
			src={url}
			{alt}
			{onload}
			class="absolute max-w-none select-none"
			draggable="false"
			style:width={`${100 / view.w}%`}
			style:height={`${100 / view.h}%`}
			style:left={`${(-view.x / view.w) * 100}%`}
			style:top={`${(-view.y / view.h) * 100}%`}
		/>
		{#if rel}
			<div
				class="absolute rounded-sm {mask ? 'bg-amber-300' : 'border-2 border-amber-400 bg-amber-300/15'}"
				style:left={`${rel.left}%`}
				style:top={`${rel.top}%`}
				style:width={`${rel.width}%`}
				style:height={`${rel.height}%`}
				aria-hidden="true"
			></div>
		{/if}
	{/if}
</div>
