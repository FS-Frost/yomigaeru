<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import NavBar from '$lib/gui/nav/NavBar.svelte';
	import Toaster from '$lib/gui/Toaster.svelte';
	import { app } from '$lib/state/app.svelte';
	import { theme } from '$lib/theme.svelte';
	import { requestPersistentStorage, registerServiceWorker } from '$lib/pwa';
	import { ensureDailyBackup } from '$lib/db/backup';

	let { children } = $props();

	onMount(() => {
		theme.init();
		app.loadSettings().catch(() => app.toast('No se pudieron cargar los ajustes', 'error'));
		requestPersistentStorage().catch(() => {});
		registerServiceWorker();
		// Copia automática diaria (en segundo plano, sin bloquear el arranque).
		setTimeout(() => {
			ensureDailyBackup().catch(() => app.toast('No se pudo crear la copia automática diaria', 'warn'));
		}, 3000);
	});
</script>

<NavBar />

<main class="pb-nav mx-auto max-w-3xl px-4 py-6 sm:pb-6">
	{@render children()}
</main>

<Toaster />
