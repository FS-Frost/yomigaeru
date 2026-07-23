<script lang="ts">
	import { onMount } from 'svelte';
	import { listDecks, createDeck } from '$lib/db/decks';
	import { createCards, type NewCard } from '$lib/db/cards';
	import type { Deck } from '$lib/db/schema';
	import { compressImage, imageFromPaste, type CompressedImage } from '$lib/media/image';
	import { imageToCards } from '$lib/gemini/imageToCards';
	import type { GeneratedCard } from '$lib/gemini/schemas';
	import { GeminiError } from '$lib/gemini/client';
	import Furigana from '$lib/gui/Furigana.svelte';
	import { app } from '$lib/state/app.svelte';
	import Button from '$lib/gui/Button.svelte';
	import Field from '$lib/gui/Field.svelte';
	import Select from '$lib/gui/Select.svelte';
	import CameraCapture from '$lib/gui/CameraCapture.svelte';

	let img = $state<CompressedImage | null>(null);
	let loading = $state(false);
	let cards = $state<(GeneratedCard & { keep: boolean })[]>([]);
	let decks = $state<Deck[]>([]);
	let deckId = $state<number | null>(null);
	let attachImage = $state(true);
	let refineInstruction = $state('');
	let cameraOpen = $state(false);
	let canLiveCamera = $state(true);

	onMount(async () => {
		canLiveCamera = !!navigator.mediaDevices?.getUserMedia;
		decks = await listDecks();
		deckId = decks[0]?.id ?? null;
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

	async function extract() {
		if (!img) return;
		loading = true;
		try {
			const result = await imageToCards({ mimeType: img.mimeType, base64: img.base64 });
			cards = result.map((c) => ({ ...c, keep: true }));
			if (!cards.length) app.toast('No se detectaron tarjetas.', 'info');
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'Error al extraer', 'error');
		} finally {
			loading = false;
		}
	}

	async function refine() {
		if (!img || !cards.length) return;
		loading = true;
		try {
			// Enviamos las tarjetas actuales (sin `keep`) para que la IA las ajuste.
			const previous = cards.map(({ keep, ...c }) => c);
			const result = await imageToCards(
				{ mimeType: img.mimeType, base64: img.base64 },
				{ instruction: refineInstruction, previous },
			);
			cards = result.map((c) => ({ ...c, keep: true }));
			refineInstruction = '';
			if (!cards.length) app.toast('No se detectaron tarjetas.', 'info');
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'Error al refinar', 'error');
		} finally {
			loading = false;
		}
	}

	async function ensureDeck(): Promise<number> {
		if (deckId !== null) return deckId;
		const id = await createDeck('Desde imágenes');
		decks = await listDecks();
		deckId = id;
		return id;
	}

	async function save() {
		const chosen = cards.filter((c) => c.keep);
		if (!chosen.length) return;
		const target = await ensureDeck();
		const payload: NewCard[] = chosen.map((c) => ({
			deckId: target,
			front: c.front,
			back: c.back,
			reading: c.reading || undefined,
			context: [c.context, ...c.examples.map((e) => `${e.jp} — ${e.es}`)].filter(Boolean).join('\n') || undefined,
			imageBlob: attachImage && img ? img.blob : undefined,
		}));
		await createCards(payload);
		app.toast(`${payload.length} tarjetas guardadas`, 'success');
		cards = [];
		img = null;
	}
</script>

<svelte:window onpaste={onPaste} />

<h1 class="mb-2 text-2xl font-bold">Foto a tarjeta</h1>
<p class="mb-4 text-sm text-slate-500">Sube una imagen, usa la cámara o pega con Ctrl+V.</p>

<div class="flex flex-wrap gap-2">
	<label class="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium transition select-none hover:bg-slate-50 active:scale-[.98]">
		Elegir archivo
		<input type="file" accept="image/*" class="hidden" onchange={(e) => handleFile((e.currentTarget as HTMLInputElement).files?.[0])} />
	</label>
	{#if canLiveCamera}
		<Button variant="secondary" onclick={() => (cameraOpen = true)}>📷 Cámara</Button>
	{:else}
		<label class="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium transition select-none hover:bg-slate-50 active:scale-[.98]">
			📷 Cámara
			<input type="file" accept="image/*" capture="environment" class="hidden" onchange={(e) => handleFile((e.currentTarget as HTMLInputElement).files?.[0])} />
		</label>
	{/if}
	<Button variant="secondary" onclick={pasteFromClipboard}>Pegar del portapapeles</Button>
</div>

<CameraCapture bind:open={cameraOpen} oncapture={onCameraCapture} />

{#if img}
	<div class="mt-4">
		<img src={img.dataUrl} alt="Vista previa" class="max-h-64 rounded-lg border border-slate-200" />
		<div class="mt-3">
			<Button {loading} onclick={extract}>Extraer tarjetas</Button>
		</div>
	</div>
{/if}

{#if cards.length}
	<div class="mt-6 space-y-3">
		{#each cards as card, i (i)}
			<label class="block rounded-lg border bg-white p-3 transition {card.keep ? 'border-sky-400 ring-1 ring-sky-200' : 'border-slate-200'}">
				<div class="flex items-start gap-3">
					<input type="checkbox" bind:checked={card.keep} class="mt-1 size-5 shrink-0 accent-sky-600" />
					<div class="grid flex-1 gap-2 sm:grid-cols-2">
						<div class="text-lg sm:col-span-2"><Furigana text={card.front} /></div>
						<Field bind:value={card.front} placeholder="Frente (japonés, ej. 私[わたし])" class="sm:col-span-2" />
						<Field bind:value={card.back} placeholder="Significado" />
						<Field bind:value={card.reading} placeholder="Lectura (kana)" />
						<Field bind:value={card.context} placeholder="Contexto" class="sm:col-span-2" />
					</div>
				</div>
			</label>
		{/each}

		<!-- Refinar con IA -->
		<div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
			<Field
				type="textarea"
				rows={2}
				bind:value={refineInstruction}
				placeholder="Instrucciones para la IA (ej. 'solo verbos', 'corrige las lecturas', 'añade más ejemplos')"
			/>
			<div class="mt-2 flex gap-2">
				<Button variant="secondary" {loading} onclick={refine}>Refinar con IA</Button>
				<Button variant="secondary" disabled={loading} onclick={extract}>Extraer de nuevo</Button>
			</div>
		</div>

		<label class="flex min-h-11 items-center gap-3 text-sm text-slate-600">
			<input type="checkbox" bind:checked={attachImage} class="size-5 accent-sky-600" /> Adjuntar la imagen como contexto visual
		</label>

		<div class="h-24 sm:hidden" aria-hidden="true"></div>
	</div>

	<!-- Barra de guardado al alcance del pulgar -->
	<div class="bottom-nav pointer-events-none fixed inset-x-0 z-30 px-4 sm:static sm:mt-4 sm:px-0">
		<div class="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
			<Select bind:value={deckId} class="flex-1">
				<option value={null}>+ Nuevo mazo "Desde imágenes"</option>
				{#each decks as d (d.id)}
					<option value={d.id}>{d.name}</option>
				{/each}
			</Select>
			<Button variant="primary" class="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800" onclick={save}>Guardar</Button>
		</div>
	</div>
{/if}
