<script lang="ts">
	import { onMount } from 'svelte';
	import { listDecks, createDeck } from '$lib/db/decks';
	import type { Deck } from '$lib/db/schema';
	import { compressImage, imageFromPaste, type CompressedImage } from '$lib/media/image';
	import { imageToCards } from '$lib/gemini/imageToCards';
	import { GeminiError } from '$lib/gemini/client';
	import { averageCost } from '$lib/gemini/usage';
	import { fmtUsd } from '$lib/gemini/pricing';
	import { app } from '$lib/state/app.svelte';
	import { takePending } from '$lib/inbox';
	import { toProposals, saveProposals, type Proposal } from '$lib/proposals';
	import Button from '$lib/gui/Button.svelte';
	import Select from '$lib/gui/Select.svelte';
	import CameraCapture from '$lib/gui/CameraCapture.svelte';
	import CardProposals from '$lib/gui/CardProposals.svelte';

	let img = $state<CompressedImage | null>(null);
	let loading = $state(false);
	let cards = $state<Proposal[]>([]);
	let decks = $state<Deck[]>([]);
	let deckId = $state<number | null>(null);
	let attachImage = $state(true);
	let cameraOpen = $state(false);
	let canLiveCamera = $state(true);
	let estimate = $state<number | null>(null);

	onMount(async () => {
		canLiveCamera = !!navigator.mediaDevices?.getUserMedia;
		try {
			decks = await listDecks();
			deckId = decks[0]?.id ?? null;
			estimate = await averageCost('imageToCards');
		} catch {
			app.toast('No se pudieron cargar los mazos', 'error');
		}
		// Imagen compartida desde otra app (Share Target): se extrae directamente.
		const shared = takePending('foto');
		if (shared?.files[0]) {
			await handleFile(shared.files[0]);
			if (img) await extract();
		}
	});

	async function handleFile(file: Blob | null | undefined) {
		if (!file) return;
		try {
			img = await compressImage(file);
			cards = [];
		} catch {
			app.toast('No se pudo procesar la imagen. Prueba con otro formato.', 'error');
		}
	}

	// La cámara devuelve un blob: comprimimos y disparamos la extracción con IA automáticamente.
	async function onCameraCapture(blob: Blob) {
		await handleFile(blob);
		if (img) await extract();
	}

	function onPaste(e: ClipboardEvent) {
		const file = imageFromPaste(e);
		if (file) handleFile(file);
	}

	async function pasteFromClipboard() {
		if (!navigator.clipboard?.read) {
			app.toast('Tu navegador no permite leer el portapapeles. Usa Ctrl+V.', 'error');
			return;
		}
		try {
			const items = await navigator.clipboard.read();
			for (const item of items) {
				const type = item.types.find((t) => t.startsWith('image/'));
				if (type) {
					await handleFile(await item.getType(type));
					return;
				}
			}
			app.toast('No hay ninguna imagen en el portapapeles.', 'info');
		} catch {
			app.toast('No se pudo leer el portapapeles (permiso denegado).', 'error');
		}
	}

	async function run(instruction?: string) {
		if (!img) return;
		loading = true;
		try {
			// En el refinado se envían las tarjetas actuales (sin campos de la UI) para que la IA las ajuste.
			const previous = instruction !== undefined ? cards.map(({ keep: _k, dups: _d, dupAction: _a, ...c }) => c) : undefined;
			const result = await imageToCards({ mimeType: img.mimeType, base64: img.base64 }, { instruction, previous });
			cards = await toProposals(result);
			if (!cards.length) app.toast('No se detectaron tarjetas.', 'info');
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'Error al extraer', 'error', { action: { label: 'Reintentar', run: () => void run(instruction) } });
		} finally {
			loading = false;
		}
	}

	const extract = () => run();

	async function ensureDeck(): Promise<number> {
		if (deckId !== null) return deckId;
		const id = await createDeck('Desde imágenes');
		decks = await listDecks();
		deckId = id;
		return id;
	}

	async function save() {
		if (!cards.some((c) => c.keep)) return;
		let res;
		try {
			res = await saveProposals($state.snapshot(cards) as Proposal[], await ensureDeck(), attachImage && img ? img.blob : undefined);
		} catch {
			app.toast('No se pudieron guardar las tarjetas', 'error');
			return;
		}
		app.toast(`${res.created} tarjetas guardadas${res.merged ? ` · ${res.merged} fusionadas` : ''}`, 'success');
		cards = [];
		img = null;
	}
</script>

<svelte:window onpaste={onPaste} />

<h1 class="mb-2 text-2xl font-bold">Foto a tarjeta</h1>
<p class="mb-4 text-sm text-slate-500">Sube una imagen, usa la cámara, pega con Ctrl+V o compártela desde otra app.</p>

<div class="flex flex-wrap gap-2">
	<label class="bg-surface inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 px-4 text-sm font-medium transition select-none hover:bg-slate-50 active:scale-[.98]">
		Elegir archivo
		<input type="file" accept="image/*" class="hidden" onchange={(e) => handleFile((e.currentTarget as HTMLInputElement).files?.[0])} />
	</label>
	{#if canLiveCamera}
		<Button variant="secondary" onclick={() => (cameraOpen = true)}>📷 Cámara</Button>
	{:else}
		<label
			class="bg-surface inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 px-4 text-sm font-medium transition select-none hover:bg-slate-50 active:scale-[.98]"
		>
			📷 Cámara
			<input type="file" accept="image/*" capture="environment" class="hidden" onchange={(e) => handleFile((e.currentTarget as HTMLInputElement).files?.[0])} />
		</label>
	{/if}
	<Button variant="secondary" onclick={pasteFromClipboard}>Pegar del portapapeles</Button>
</div>

<CameraCapture bind:open={cameraOpen} oncapture={onCameraCapture} />

{#if img && !cards.length}
	<div class="mt-4">
		<img src={img.dataUrl} alt="Vista previa" class="max-h-64 rounded-lg border border-slate-200" />
		<div class="mt-3 flex items-center gap-3">
			<Button {loading} onclick={extract}>Extraer tarjetas</Button>
			{#if estimate != null}<span class="text-xs text-slate-400">≈ {fmtUsd(estimate)}</span>{/if}
		</div>
	</div>
{/if}

{#if cards.length}
	<CardProposals bind:cards imageUrl={img?.dataUrl} {loading} onrefine={(i) => run(i)} onretry={extract} />

	<label class="mt-3 flex min-h-11 items-center gap-3 text-sm text-slate-600">
		<input type="checkbox" bind:checked={attachImage} class="size-5 accent-sky-600" /> Adjuntar la imagen (permite la cara «Imagen»: recordar la palabra en su viñeta)
	</label>

	<div class="h-24 sm:hidden" aria-hidden="true"></div>

	<!-- Barra de guardado al alcance del pulgar -->
	<div class="bottom-nav pointer-events-none fixed inset-x-0 z-30 px-4 sm:static sm:mt-4 sm:px-0">
		<div
			class="bg-surface/95 pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-slate-200 p-2 shadow-lg backdrop-blur sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none"
		>
			<Select bind:value={deckId} class="flex-1">
				<option value={null}>+ Nuevo mazo "Desde imágenes"</option>
				{#each decks as d (d.id)}
					<option value={d.id}>{d.name}</option>
				{/each}
			</Select>
			<Button variant="success" onclick={save}>Guardar ({cards.filter((c) => c.keep).length})</Button>
		</div>
	</div>
{/if}
