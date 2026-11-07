<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import Button from '$lib/gui/Button.svelte';

	const notFound = $derived(page.status === 404);
</script>

<div class="flex flex-col items-center gap-4 py-16 text-center">
	<p class="text-6xl" aria-hidden="true">{notFound ? '迷' : '壊'}</p>
	<h1 class="text-xl font-bold">{notFound ? 'Esta página no existe' : 'Algo se rompió en esta pantalla'}</h1>
	<p class="max-w-sm text-sm text-slate-500">
		{notFound ? 'Puede que el enlace sea de una versión anterior.' : 'Tus datos están a salvo. Vuelve al inicio o recarga la página.'}
	</p>
	{#if !notFound && page.error?.message}
		<pre class="max-w-full overflow-auto rounded-lg bg-slate-100 p-3 text-left text-xs text-slate-600">{page.error.message}</pre>
	{/if}
	<div class="flex gap-2">
		<a href="{base}/" class="bg-brand text-brand-fg inline-flex min-h-11 items-center rounded-lg px-5 font-medium">Ir al inicio</a>
		{#if !notFound}<Button variant="secondary" onclick={() => location.reload()}>Recargar</Button>{/if}
	</div>
</div>
