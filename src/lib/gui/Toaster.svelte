<script lang="ts">
	import { app, type Toast } from '$lib/state/app.svelte';
	import { fly } from 'svelte/transition';

	const colors: Record<Toast['kind'], string> = {
		error: 'bg-red-600',
		success: 'bg-emerald-600',
		warn: 'bg-amber-600',
		info: 'bg-neutral-800',
	};

	// Deslizar para cerrar (táctil y ratón), salvo los persistentes con acción.
	let drag = $state<{ id: number; x0: number; dx: number } | null>(null);

	function down(e: PointerEvent, t: Toast) {
		if ((e.target as HTMLElement).closest('button')) return;
		drag = { id: t.id, x0: e.clientX, dx: 0 };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		app.pause(t.id);
	}
	function move(e: PointerEvent) {
		if (drag) drag.dx = e.clientX - drag.x0;
	}
	function up(t: Toast) {
		if (!drag) return;
		const far = Math.abs(drag.dx) > 80;
		drag = null;
		if (far) app.dismiss(t.id);
		else app.resume(t.id);
	}
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-20 z-60 flex flex-col items-center gap-2 px-4 sm:top-16 sm:bottom-auto" aria-live="polite">
	{#each app.toasts as t (t.id)}
		<div
			class="pointer-events-auto flex w-full max-w-md touch-pan-y items-start gap-3 rounded-lg py-2 pr-2 pl-4 text-sm text-white shadow-lg {colors[t.kind]}"
			style:transform={drag?.id === t.id ? `translateX(${drag.dx}px)` : undefined}
			style:opacity={drag?.id === t.id ? 1 - Math.min(0.7, Math.abs(drag.dx) / 200) : undefined}
			role={t.kind === 'error' ? 'alert' : 'status'}
			transition:fly={{ y: 20, duration: 150 }}
			onmouseenter={() => app.pause(t.id)}
			onmouseleave={() => app.resume(t.id)}
			onfocusin={() => app.pause(t.id)}
			onfocusout={() => app.resume(t.id)}
			onpointerdown={(e) => down(e, t)}
			onpointermove={move}
			onpointerup={() => up(t)}
			onpointercancel={() => up(t)}
		>
			<div class="min-w-0 flex-1 py-1.5">
				<p>{t.message}</p>
				{#if t.detail}<p class="mt-0.5 text-xs text-white/80">{t.detail}</p>{/if}
			</div>
			{#each t.actions as a, i (i)}
				<button class="min-h-9 shrink-0 rounded-md px-3 font-semibold text-white/95 uppercase transition hover:bg-white/15 active:bg-white/25" onclick={() => app.runAction(t.id, i)}>
					{a.label}
				</button>
			{/each}
			<button class="min-h-9 shrink-0 rounded-md px-2 text-white/80 transition hover:bg-white/15" aria-label="Cerrar" onclick={() => app.dismiss(t.id)}>✕</button>
		</div>
	{/each}
</div>
