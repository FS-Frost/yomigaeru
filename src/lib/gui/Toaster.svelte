<script lang="ts">
	import { app, type Toast } from '$lib/state/app.svelte';
	import { fly } from 'svelte/transition';

	const colors: Record<Toast['kind'], string> = {
		error: 'bg-red-600',
		success: 'bg-emerald-600',
		warn: 'bg-amber-600',
		info: 'bg-neutral-800',
	};

	// Deslizar para cerrar (táctil y ratón).
	let drag = $state<{ id: number; x0: number; dx: number } | null>(null);
	/** Toasts con el detalle técnico desplegado. */
	let open = $state<Record<number, boolean>>({});
	let copied = $state<number | null>(null);

	function down(e: PointerEvent, t: Toast) {
		if ((e.target as HTMLElement).closest('button, pre')) return;
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

	async function copy(t: Toast) {
		try {
			await navigator.clipboard.writeText(`${t.message}\n${t.tech ?? ''}`);
			copied = t.id;
			setTimeout(() => (copied = null), 1500);
		} catch {
			// Sin permiso de portapapeles: el texto sigue visible para copiarlo a mano.
		}
	}
</script>

<!-- En móvil, encima de la barra inferior (y de las barras de acción); en escritorio, arriba. -->
<div class="toaster pointer-events-none fixed inset-x-0 z-60 flex flex-col items-center gap-2 px-4 sm:top-16 sm:bottom-auto" aria-live="polite">
	{#each app.toasts as t (t.id)}
		<div
			class="pointer-events-auto w-full max-w-md touch-pan-y rounded-xl py-2 pr-2 pl-4 text-sm text-white shadow-lg {colors[t.kind]}"
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
			<div class="flex items-start gap-2">
				<div class="min-w-0 flex-1 py-1.5">
					<p class="leading-snug">{t.message}</p>
					{#if t.detail}<p class="mt-0.5 text-xs text-white/85">{t.detail}</p>{/if}
					{#if t.tech}
						<button class="mt-1 text-xs text-white/80 underline underline-offset-2" aria-expanded={!!open[t.id]} onclick={() => (open[t.id] = !open[t.id])}>
							{open[t.id] ? 'Ocultar detalle' : 'Detalle técnico'}
						</button>
					{/if}
				</div>
				<button class="flex size-9 shrink-0 items-center justify-center rounded-md text-white/80 transition hover:bg-white/15" aria-label="Cerrar" onclick={() => app.dismiss(t.id)}>✕</button>
			</div>
			{#if t.tech && open[t.id]}
				<pre class="mt-1 mr-2 max-h-40 overflow-auto rounded-md bg-black/25 p-2 font-mono text-[0.7rem] break-all whitespace-pre-wrap select-text">{t.tech}</pre>
				<button class="mt-1 text-xs text-white/85 underline underline-offset-2" onclick={() => copy(t)}>{copied === t.id ? 'Copiado ✓' : 'Copiar detalle'}</button>
			{/if}
			{#if t.actions.length}
				<div class="mt-1 flex flex-wrap justify-end gap-1">
					{#each t.actions as a, i (i)}
						<button class="min-h-10 rounded-md bg-white/15 px-3 font-semibold text-white transition hover:bg-white/25 active:bg-white/30" onclick={() => app.runAction(t.id, i)}>
							{a.label}
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</div>

<style>
	.toaster {
		bottom: calc(4.5rem + env(safe-area-inset-bottom, 0px) + var(--action-bar, 0px));
	}
	@media (min-width: 640px) {
		.toaster {
			bottom: auto;
		}
	}
</style>
