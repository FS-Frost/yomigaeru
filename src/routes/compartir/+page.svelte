<script lang="ts">
	// Llega algo compartido hacia Yomigaeru (Share Target) o abierto con Yomigaeru (File Handling):
	// elegir qué hacer. Si solo hay un destino posible, se va directo.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { onOpenedFiles, setPending, sharedText, takeShared, type Incoming, type PendingTarget } from '$lib/inbox';
	import { fileKind } from '$lib/inbox-core';
	import { hasJapanese } from '$lib/jp';
	import Button from '$lib/gui/Button.svelte';

	let incoming = $state<Incoming | null>(null);
	let loading = $state(true);

	const text = $derived(incoming ? sharedText(incoming) : '');
	const images = $derived(incoming?.files.filter((f) => fileKind(f.name, f.type) === 'image') ?? []);
	const texts = $derived(incoming?.files.filter((f) => fileKind(f.name, f.type) === 'text') ?? []);
	const backups = $derived(incoming?.files.filter((f) => fileKind(f.name, f.type) === 'backup') ?? []);
	const anki = $derived(incoming?.files.filter((f) => fileKind(f.name, f.type) === 'anki') ?? []);

	type Action = { label: string; hint: string; run: () => void };
	let actions = $state<Action[]>([]);

	async function buildActions(): Promise<Action[]> {
		const a: Action[] = [];
		if (!incoming) return a;
		const fileText = texts[0] ? await texts[0].text() : '';
		const allText = [text, fileText].filter(Boolean).join('\n');
		if (images.length)
			a.push({
				label: '📷 Crear tarjetas desde la imagen',
				hint: images.length > 1 ? `Se usa la primera de ${images.length}.` : 'La IA detecta el japonés y propone tarjetas.',
				run: () => go('foto', { files: [images[0]] }),
			});
		if (allText && allText.length <= 40) a.push({ label: '＋ Crear una tarjeta', hint: `«${allText}»`, run: () => go('crear', { text: allText, files: [] }) });
		if (allText && (allText.length > 40 || hasJapanese(allText)))
			a.push({ label: '📝 Extraer varias tarjetas del texto', hint: 'Elige las palabras útiles del texto.', run: () => go('crear', { text: allText, files: [], long: true }) });
		if (anki.length) a.push({ label: '⊞ Importar a un mazo', hint: `${anki[0].name} (Anki / TSV / CSV)`, run: () => go('mazos', { files: [anki[0]] }) });
		if (backups.length) a.push({ label: '⚙ Restaurar backup', hint: `${backups[0].name}: se pedirá confirmación y se guarda una copia antes.`, run: () => go('ajustes', { files: [backups[0]] }) });
		return a;
	}

	function go(to: PendingTarget, p: { text?: string; files: File[]; long?: boolean }) {
		setPending({ to, title: incoming?.title, ...p });
		void goto(`${base}/${to}`);
	}

	async function receive(x: Incoming | null) {
		loading = false;
		if (!x) return;
		incoming = x;
		actions = await buildActions();
		// Un único destino posible: directo.
		if (actions.length === 1) actions[0].run();
	}

	onMount(async () => {
		onOpenedFiles((files) => void receive({ files }));
		await receive(await takeShared());
	});
</script>

<h1 class="mb-4 text-2xl font-bold">Recibido</h1>

{#if loading}
	<p class="text-slate-400">Leyendo lo compartido…</p>
{:else if page.url.searchParams.has('error')}
	<p class="text-red-600">No se pudo recibir lo compartido. Prueba otra vez.</p>
{:else if !incoming}
	<p class="text-slate-500">No hay nada compartido. Desde otra app, usa «Compartir» → Yomigaeru (con la app instalada).</p>
{:else if !actions.length}
	<p class="text-slate-500">No sé qué hacer con esto. Comparte una imagen, un texto en japonés, un mazo (.apkg/.tsv/.csv) o un backup (.json).</p>
{:else}
	<p class="mb-3 text-sm text-slate-500">¿Qué quieres hacer?</p>
	<div class="flex flex-col gap-2">
		{#each actions as a (a.label)}
			<Button variant="secondary" size="lg" full class="h-auto flex-col items-start py-3 text-left" onclick={a.run}>
				<span>{a.label}</span>
				<span class="text-xs font-normal text-slate-500">{a.hint}</span>
			</Button>
		{/each}
	</div>
{/if}
