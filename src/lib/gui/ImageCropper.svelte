<script lang="ts">
	// Recortar y girar una foto antes de enviarla a la IA: menos tokens y cajas más precisas.
	// Arrastra el recuadro para moverlo, sus esquinas para ajustarlo o fuera de él para dibujar otro.
	import { onDestroy, untrack } from 'svelte';
	import { boxFromPoints, moveBox, resizeBox, type Corner } from '$lib/box';
	import { cropImage, rotateImage } from '$lib/media/image';
	import type { Box } from '$lib/db/schema';
	import Button from './Button.svelte';

	let { blob, onapply, oncancel }: { blob: Blob; onapply: (b: Blob) => void; oncancel: () => void } = $props();

	let current = $state<Blob | null>(null);
	let url = $state('');
	let box = $state<Box>([0, 0, 1000, 1000]);
	let busy = $state(false);
	let wrap = $state<HTMLDivElement | null>(null);
	type Drag = { kind: 'move' | 'draw' | Corner; start: { x: number; y: number }; orig: Box };
	let drag: Drag | null = null;

	function show(b: Blob) {
		if (url) URL.revokeObjectURL(url);
		current = b;
		url = URL.createObjectURL(b);
		box = [0, 0, 1000, 1000];
	}
	// Solo depende de `blob`: `show` lee y escribe `url`, que no debe ser dependencia (bucle).
	$effect(() => {
		const b = blob;
		untrack(() => show(b));
	});
	onDestroy(() => url && URL.revokeObjectURL(url));

	function point(e: PointerEvent) {
		const r = wrap!.getBoundingClientRect();
		return { x: Math.max(0, Math.min(1000, ((e.clientX - r.left) / r.width) * 1000)), y: Math.max(0, Math.min(1000, ((e.clientY - r.top) / r.height) * 1000)) };
	}
	function start(e: PointerEvent, kind: Drag['kind']) {
		e.preventDefault();
		e.stopPropagation();
		drag = { kind, start: point(e), orig: [...box] as Box };
		wrap?.setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!drag) return;
		const p = point(e);
		const dx = p.x - drag.start.x;
		const dy = p.y - drag.start.y;
		if (drag.kind === 'move') box = moveBox(drag.orig, dx, dy);
		else if (drag.kind === 'draw') box = boxFromPoints(drag.start, p) ?? drag.orig;
		else box = resizeBox(drag.orig, drag.kind, dx, dy);
	}
	const end = () => (drag = null);

	async function rotate() {
		if (!current) return;
		busy = true;
		try {
			show(await rotateImage(current));
		} finally {
			busy = false;
		}
	}

	async function apply() {
		if (!current) return;
		const full = box[0] <= 2 && box[1] <= 2 && box[2] >= 998 && box[3] >= 998;
		busy = true;
		try {
			onapply(full ? current : await cropImage(current, box));
		} finally {
			busy = false;
		}
	}

	const CORNERS: { c: Corner; cls: string }[] = [
		{ c: 'nw', cls: '-top-3 -left-3' },
		{ c: 'ne', cls: '-top-3 -right-3' },
		{ c: 'sw', cls: '-bottom-3 -left-3' },
		{ c: 'se', cls: '-right-3 -bottom-3' },
	];
	const pct = ([y0, x0, y1, x1]: Box) => `left:${x0 / 10}%;top:${y0 / 10}%;width:${(x1 - x0) / 10}%;height:${(y1 - y0) / 10}%`;
</script>

<div class="flex flex-col items-center gap-3">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div bind:this={wrap} class="relative inline-block max-w-full touch-none select-none" onpointerdown={(e) => start(e, 'draw')} onpointermove={move} onpointerup={end} onpointercancel={end}>
		{#if url}<img src={url} alt="Foto a recortar" class="pointer-events-none max-h-[55vh] max-w-full rounded-lg" draggable="false" />{/if}
		<!-- Oscurece lo que queda fuera del recorte -->
		<div class="pointer-events-none absolute rounded-sm shadow-[0_0_0_9999px_rgb(0_0_0/0.5)]" style={pct(box)}></div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="absolute cursor-move border-2 border-white" style={pct(box)} onpointerdown={(e) => start(e, 'move')}>
			{#each CORNERS as k (k.c)}
				<span class="absolute size-6 rounded-full border-2 border-white bg-sky-500 shadow {k.cls}" onpointerdown={(e) => start(e, k.c)} role="presentation"></span>
			{/each}
		</div>
	</div>
	<p class="text-center text-xs text-slate-500">Arrastra el recuadro o sus esquinas; arrastra fuera de él para dibujar otro.</p>
	<div class="flex w-full flex-wrap justify-center gap-2">
		<Button variant="secondary" onclick={rotate} disabled={busy}>⟳ Girar</Button>
		<Button variant="ghost" onclick={() => (box = [0, 0, 1000, 1000])} disabled={busy}>Toda la foto</Button>
		<Button variant="ghost" onclick={oncancel} disabled={busy}>Cancelar</Button>
		<Button onclick={apply} loading={busy}>Usar recorte</Button>
	</div>
</div>
