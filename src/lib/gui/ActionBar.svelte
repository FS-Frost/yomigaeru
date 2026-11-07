<script lang="ts">
	// Barra de acciones fija al alcance del pulgar (móvil), encima de la barra de navegación.
	// En escritorio se integra en el flujo. Reserva su alto para que el contenido y los avisos
	// no queden tapados (variable CSS --action-bar, que usa el Toaster).
	import { onMount, type Snippet } from 'svelte';

	let { children, class: className = '' }: { children: Snippet; class?: string } = $props();
	let el = $state<HTMLDivElement | null>(null);
	let height = $state(0);

	onMount(() => {
		const root = document.documentElement;
		const ro = new ResizeObserver(() => {
			height = el?.offsetHeight ?? 0;
			const mobile = window.matchMedia('(max-width: 639px)').matches;
			root.style.setProperty('--action-bar', mobile ? `${height + 12}px` : '0px');
		});
		if (el) ro.observe(el);
		return () => {
			ro.disconnect();
			root.style.removeProperty('--action-bar');
		};
	});
</script>

<div class="sm:hidden" style:height="{height + 16}px" aria-hidden="true"></div>
<div class="bottom-nav pointer-events-none fixed inset-x-0 z-30 px-3 sm:static sm:mt-4 sm:px-0">
	<div
		bind:this={el}
		class="bg-surface/95 pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border border-slate-200 p-2 shadow-lg backdrop-blur sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none {className}"
	>
		{@render children()}
	</div>
</div>
