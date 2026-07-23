<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fly, fade } from 'svelte/transition';

	let {
		open = $bindable(false),
		title = '',
		onclose,
		children,
	}: {
		open?: boolean;
		title?: string;
		onclose?: () => void;
		children: Snippet;
	} = $props();

	function close() {
		open = false;
		onclose?.();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

<svelte:window onkeydown={open ? onkeydown : undefined} />

{#if open}
	<!-- Overlay -->
	<button type="button" class="fixed inset-0 z-40 cursor-default bg-slate-900/40" transition:fade={{ duration: 150 }} onclick={close} aria-label="Cerrar"
	></button>

	<!-- Panel anclado abajo -->
	<div
		class="pb-safe fixed inset-x-0 bottom-0 z-50 mx-auto max-w-lg rounded-t-2xl bg-white shadow-2xl"
		transition:fly={{ y: 300, duration: 200 }}
		role="dialog"
		aria-modal="true"
		aria-label={title || 'Diálogo'}
	>
		<div class="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300" aria-hidden="true"></div>
		<div class="px-4 pt-3 pb-4">
			{#if title}
				<h2 class="mb-3 text-lg font-semibold text-slate-900">{title}</h2>
			{/if}
			{@render children()}
		</div>
	</div>
{/if}
