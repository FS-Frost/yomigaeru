<script lang="ts">
	// Editor de cajas sobre una imagen: seleccionar, mover (arrastrar la caja), redimensionar
	// (arrastrar una esquina) y dibujar una nueva (arrastrar sobre la imagen con una tarjeta elegida).
	// Las cajas son [ymin, xmin, ymax, xmax] normalizadas 0–1000; muta `items[i].box`.
	import { boxFromPoints, moveBox, resizeBox, type Corner } from '$lib/box';
	import type { Box } from '$lib/db/schema';

	let {
		src,
		items,
		selected = $bindable(null),
		class: className = '',
	}: {
		src: string;
		items: { box?: Box; front: string; keep?: boolean }[];
		selected?: number | null;
		class?: string;
	} = $props();

	let wrap = $state<HTMLDivElement | null>(null);
	type Drag = { kind: 'move' | Corner | 'draw'; i: number; start: { x: number; y: number }; orig?: Box };
	let drag: Drag | null = null;
	let draft = $state<Box | null>(null);

	/** Punto del puntero en unidades 0–1000 de la imagen. */
	function point(e: PointerEvent) {
		const r = wrap!.getBoundingClientRect();
		return { x: ((e.clientX - r.left) / r.width) * 1000, y: ((e.clientY - r.top) / r.height) * 1000 };
	}

	function start(e: PointerEvent, kind: Drag['kind'], i: number) {
		if (!wrap) return;
		e.preventDefault();
		e.stopPropagation();
		selected = i;
		drag = { kind, i, start: point(e), orig: items[i]?.box ? ([...items[i].box!] as Box) : undefined };
		wrap.setPointerCapture(e.pointerId);
	}

	function onImageDown(e: PointerEvent) {
		// Dibujar solo si hay una tarjeta elegida.
		if (selected == null || !items[selected]) return;
		start(e, 'draw', selected);
	}

	function move(e: PointerEvent) {
		if (!drag) return;
		const p = point(e);
		const dx = p.x - drag.start.x;
		const dy = p.y - drag.start.y;
		const it = items[drag.i];
		if (drag.kind === 'draw') draft = boxFromPoints(drag.start, p);
		else if (drag.kind === 'move' && drag.orig) it.box = moveBox(drag.orig, dx, dy);
		else if (drag.orig && drag.kind !== 'move') it.box = resizeBox(drag.orig, drag.kind, dx, dy);
	}

	function end() {
		if (drag?.kind === 'draw' && draft) items[drag.i].box = draft;
		drag = null;
		draft = null;
	}

	/** Teclado: flechas mueven la caja elegida (Mayús = más rápido). */
	function onkeydown(e: KeyboardEvent) {
		if (selected == null) return;
		const b = items[selected]?.box;
		if (!b) return;
		const step = e.shiftKey ? 20 : 5;
		const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
		if (!d) return;
		e.preventDefault();
		items[selected].box = moveBox(b, d[0], d[1]);
	}

	const pct = (b: Box) => {
		const [y0, x0, y1, x1] = b.map((n) => n / 10);
		return `left:${x0}%;top:${y0}%;width:${x1 - x0}%;height:${y1 - y0}%`;
	};
	const CORNERS: { c: Corner; cls: string }[] = [
		{ c: 'nw', cls: '-top-2 -left-2 cursor-nwse-resize' },
		{ c: 'ne', cls: '-top-2 -right-2 cursor-nesw-resize' },
		{ c: 'sw', cls: '-bottom-2 -left-2 cursor-nesw-resize' },
		{ c: 'se', cls: '-right-2 -bottom-2 cursor-nwse-resize' },
	];
</script>

<!-- Lienzo interactivo (puntero + flechas): `application` deja al lector de pantalla pasar las teclas. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
	bind:this={wrap}
	class="relative inline-block max-w-full touch-none select-none {selected != null ? 'cursor-crosshair' : ''} {className}"
	role="application"
	aria-label="Editor de cajas: elige una tarjeta y arrastra sobre la imagen para marcar la palabra"
	tabindex="0"
	onpointerdown={onImageDown}
	onpointermove={move}
	onpointerup={end}
	onpointercancel={end}
	{onkeydown}
>
	<img {src} alt="Imagen con las palabras marcadas" class="pointer-events-none max-h-80 rounded-lg border border-slate-200" draggable="false" />
	{#each items as it, i (i)}
		{#if it.box}
			<div
				class="absolute rounded-sm border-2 {selected === i ? 'z-10 cursor-move border-amber-400 bg-amber-300/25' : it.keep === false ? 'border-slate-400/50' : 'border-sky-500/80'}"
				style={pct(it.box)}
				title={it.front}
				role="button"
				tabindex="-1"
				aria-label={`Caja de ${it.front}`}
				onpointerdown={(e) => (selected === i ? start(e, 'move', i) : (e.stopPropagation(), (selected = i)))}
			>
				{#if selected === i}
					{#each CORNERS as k (k.c)}
						<span class="absolute size-4 rounded-full border-2 border-white bg-amber-500 shadow {k.cls}" role="presentation" onpointerdown={(e) => start(e, k.c, i)}></span>
					{/each}
				{/if}
			</div>
		{/if}
	{/each}
	{#if draft}
		<div class="absolute rounded-sm border-2 border-dashed border-amber-500 bg-amber-300/20" style={pct(draft)}></div>
	{/if}
</div>
