<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import NavBar from '$lib/gui/nav/NavBar.svelte';
	import { app } from '$lib/state/app.svelte';
	import { requestPersistentStorage, registerServiceWorker } from '$lib/pwa';

	let { children } = $props();

	onMount(() => {
		app.loadSettings();
		requestPersistentStorage();
		registerServiceWorker();
	});
</script>

<NavBar />

<main class="pb-nav mx-auto max-w-3xl px-4 py-6 sm:pb-6">
	{@render children()}
</main>

<!-- Toasts (por encima de la bottom bar en móvil) -->
<div class="fixed inset-x-0 bottom-20 z-60 flex flex-col items-center gap-2 px-4 sm:bottom-4">
	{#each app.toasts as t (t.id)}
		<div
			class="flex w-full max-w-md items-center gap-3 rounded-lg py-2 pr-2 pl-4 text-sm text-white shadow-lg {t.kind === 'error'
				? 'bg-red-600'
				: t.kind === 'success'
					? 'bg-emerald-600'
					: 'bg-slate-800'}"
			role="status"
		>
			<span class="flex-1">{t.message}</span>
			{#if t.action}
				<button
					class="min-h-9 shrink-0 rounded-md px-3 font-semibold text-white/95 uppercase transition hover:bg-white/15 active:bg-white/25"
					onclick={() => app.runAction(t.id)}
				>
					{t.action.label}
				</button>
			{/if}
		</div>
	{/each}
</div>
