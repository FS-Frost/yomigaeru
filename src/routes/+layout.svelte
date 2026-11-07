<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import NavBar from '$lib/gui/nav/NavBar.svelte';
	import Toaster from '$lib/gui/Toaster.svelte';
	import { app } from '$lib/state/app.svelte';
	import { theme } from '$lib/theme.svelte';
	import { net } from '$lib/net.svelte';
	import { requestPersistentStorage, registerServiceWorker } from '$lib/pwa';
	import { ensureDailyBackup } from '$lib/db/backup';
	import { db } from '$lib/db/schema';
	import { classifyDbError, type UserError } from '$lib/errors';

	let { children } = $props();

	/** Error al abrir IndexedDB: sin base no hay app, se muestra una pantalla explicativa. */
	let fatal = $state<UserError | null>(null);

	onMount(() => {
		theme.init();
		net.init();

		// Captura global: nada falla en silencio.
		const onError = (ev: ErrorEvent) => {
			// Errores de recursos/extensiones sin objeto Error: se ignoran.
			if (!ev.error) return;
			app.error(ev.error, 'Algo falló en la app');
		};
		const onRejection = (ev: PromiseRejectionEvent) => {
			ev.preventDefault();
			app.error(ev.reason, 'Algo falló en la app');
		};
		window.addEventListener('error', onError);
		window.addEventListener('unhandledrejection', onRejection);

		// Otra pestaña con versión vieja bloquea la actualización de la base, o viceversa.
		db.on('blocked', () => {
			app.toast('Otra pestaña de Yomigaeru con una versión anterior impide actualizar los datos. Ciérrala.', 'warn', { key: 'db-blocked', persistent: true });
		});
		db.on('versionchange', () => {
			db.close();
			app.toast('Yomigaeru se actualizó en otra pestaña. Recarga para seguir.', 'warn', { key: 'db-version', persistent: true, action: { label: 'Recargar', run: () => location.reload() } });
			return false;
		});

		db.open()
			.then(() => {
				app.loadSettings().catch((e) => app.error(e, 'No se pudieron cargar los ajustes'));
				// Copia automática diaria (en segundo plano, sin bloquear el arranque).
				setTimeout(() => {
					ensureDailyBackup().catch((e) => app.error(e, 'No se pudo crear la copia automática diaria'));
				}, 3000);
			})
			.catch((e) => (fatal = classifyDbError(e) ?? { message: 'No se pudo abrir la base de datos.', action: 'reload', key: 'db', tech: String(e) }));

		requestPersistentStorage().catch(() => {});
		registerServiceWorker();

		return () => {
			window.removeEventListener('error', onError);
			window.removeEventListener('unhandledrejection', onRejection);
		};
	});
</script>

<NavBar />

{#if !net.online}
	<div class="sticky top-0 z-20 bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-800 sm:top-12" role="status">Sin conexión · el estudio funciona, la IA no</div>
{/if}

<main class="pb-nav mx-auto max-w-3xl px-4 pt-4 sm:pt-6 sm:pb-6">
	{#if fatal}
		<div class="flex flex-col items-center gap-3 py-16 text-center">
			<p class="text-5xl" aria-hidden="true">庫</p>
			<h1 class="text-xl font-bold">No se pueden usar los datos</h1>
			<p class="max-w-sm text-sm text-slate-600">{fatal.message}</p>
			{#if fatal.tech}<pre class="max-w-full overflow-auto rounded-lg bg-slate-100 p-3 text-left text-xs text-slate-500">{fatal.tech}</pre>{/if}
			{#if fatal.action === 'reload'}<button class="bg-brand text-brand-fg min-h-11 rounded-lg px-5 font-medium" onclick={() => location.reload()}>Recargar</button>{/if}
		</div>
	{:else}
		{@render children()}
	{/if}
</main>

<Toaster />
