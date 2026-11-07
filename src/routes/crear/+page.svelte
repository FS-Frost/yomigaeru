<script lang="ts">
	// Crear (entrada única): una palabra, un texto largo o fotos → propuestas de la IA en vivo →
	// revisión → guardar. Las propuestas sin guardar se conservan como borrador.
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { listDecks, createDeck } from '$lib/db/decks';
	import type { Deck } from '$lib/db/schema';
	import { clearDraft, loadDraft, saveDraft, type CreateDraft } from '$lib/db/drafts';
	import { generateCardFromText } from '$lib/gemini/generateCard';
	import { imageToCards, textToCards } from '$lib/gemini/imageToCards';
	import type { CardsResult } from '$lib/gemini/cardgen';
	import type { Stage } from '$lib/gemini/stream';
	import type { GeneratedCard } from '$lib/gemini/schemas';
	import { averageCost } from '$lib/gemini/usage';
	import { fmtUsd } from '$lib/gemini/pricing';
	import { takePending } from '$lib/inbox';
	import { compressImage, imageFromPaste } from '$lib/media/image';
	import { refreshDups, saveProposals, toProposals, type Proposal } from '$lib/proposals';
	import { addUnique, detectMode, groupId, keptCount, MAX_PHOTOS, setAllKept, type CreateGroup, type CreateMode } from '$lib/create';
	import { app } from '$lib/state/app.svelte';
	import { net } from '$lib/net.svelte';
	import Button from '$lib/gui/Button.svelte';
	import Select from '$lib/gui/Select.svelte';
	import Sheet from '$lib/gui/Sheet.svelte';
	import ActionBar from '$lib/gui/ActionBar.svelte';
	import CameraCapture from '$lib/gui/CameraCapture.svelte';
	import CardProposals from '$lib/gui/CardProposals.svelte';
	import GenerationProgress from '$lib/gui/GenerationProgress.svelte';
	import ImageCropper from '$lib/gui/ImageCropper.svelte';
	import Furigana from '$lib/gui/Furigana.svelte';

	// --- Entrada ---
	let text = $state('');
	/** Modo elegido a mano (null = el detectado). Se olvida al vaciar el texto. */
	let modeOverride = $state<CreateMode | null>(null);
	const mode = $derived(modeOverride ?? detectMode(text));
	$effect(() => {
		if (!text.trim()) modeOverride = null;
	});
	type QueuedPhoto = { id: string; blob: Blob; url: string };
	let queue = $state<QueuedPhoto[]>([]);
	let cropping = $state<QueuedPhoto | null>(null);
	let cameraOpen = $state(false);
	let canLiveCamera = $state(true);
	let textarea = $state<HTMLTextAreaElement | null>(null);

	// --- Resultados ---
	let groups = $state<CreateGroup[]>([]);
	let decks = $state<Deck[]>([]);
	let deckId = $state<number | null>(null);
	let hideDups = $state(false);
	let saving = $state(false);

	// --- Generación en curso ---
	type Run = { stage: Stage; startedAt: number; count: number; retrying: boolean; step: { i: number; n: number } | null; label: string; estimate: number | null };
	let running = $state<Run | null>(null);
	let controller: AbortController | null = null;
	let costs = $state<Record<'word' | 'text' | 'image', number | null>>({ word: null, text: null, image: null });

	// --- Borrador ---
	let draftOffer = $state<(CreateDraft & { updatedAt: number }) | null>(null);
	let draftReady = false;

	const hasKey = $derived(!!app.settings?.apiKey);
	const canGenerate = $derived(!running && net.online && hasKey && (!!text.trim() || queue.length > 0));
	const kept = $derived(keptCount(groups));
	const total = $derived(groups.reduce((a, g) => a + g.proposals.length, 0));

	// URLs de las fotos de los grupos (se revocan al salir).
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- caché interna de object URLs
	const groupUrls = new Map<string, string>();
	function urlOf(g: CreateGroup): string | null {
		if (!g.image) return null;
		let u = groupUrls.get(g.id);
		if (!u) groupUrls.set(g.id, (u = URL.createObjectURL(g.image)));
		return u;
	}
	onDestroy(() => {
		controller?.abort();
		for (const u of groupUrls.values()) URL.revokeObjectURL(u);
		for (const q of queue) URL.revokeObjectURL(q.url);
	});

	onMount(async () => {
		canLiveCamera = !!navigator.mediaDevices?.getUserMedia;
		try {
			decks = await listDecks();
			deckId = decks[0]?.id ?? null;
			[costs.word, costs.text, costs.image] = await Promise.all([averageCost('generateCard'), averageCost('textToCards'), averageCost('imageToCards')]);
		} catch (e) {
			app.error(e, 'No se pudieron cargar los mazos');
		}
		const draft = await loadDraft().catch(() => null);
		// Algo compartido desde otra app (o redirigido desde /foto): se procesa directamente.
		const shared = takePending('crear');
		if (shared) {
			if (draft) draftOffer = draft;
			draftReady = true;
			for (const f of shared.files.filter((f) => f.type.startsWith('image/')).slice(0, MAX_PHOTOS)) addPhoto(f);
			if (shared.text) {
				text = shared.text;
				if (shared.long) modeOverride = 'text';
			}
			if (queue.length || text.trim()) await generate();
			return;
		}
		if (draft) draftOffer = draft;
		draftReady = true;
		if (page.url.searchParams.has('camara')) openCamera();
		else if (!draft) textarea?.focus();
	});

	// Guardado del borrador (con retardo) cada vez que cambian las propuestas.
	let draftTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const snap = { text, mode: modeOverride, deckId, groups: $state.snapshot(groups) as CreateGroup[] };
		if (!draftReady || draftOffer) return;
		clearTimeout(draftTimer);
		draftTimer = setTimeout(() => saveDraft(snap).catch((e) => app.error(e, 'No se pudo guardar el borrador')), 600);
	});

	async function restoreDraft() {
		if (!draftOffer) return;
		const d = draftOffer;
		for (const g of d.groups) for (const p of g.proposals) await refreshDups(p);
		groups = [...d.groups, ...groups];
		if (!text) text = d.text;
		if (d.mode) modeOverride = d.mode;
		if (d.deckId != null && decks.some((x) => x.id === d.deckId)) deckId = d.deckId;
		draftOffer = null;
	}
	async function discardDraft() {
		draftOffer = null;
		await clearDraft().catch(() => {});
	}

	// --- Fotos ---
	function addPhoto(blob: Blob) {
		if (queue.length >= MAX_PHOTOS) {
			app.toast(`Máximo ${MAX_PHOTOS} fotos por tanda.`, 'warn', { key: 'max-photos' });
			return;
		}
		queue.push({ id: groupId(), blob, url: URL.createObjectURL(blob) });
	}
	function removePhoto(id: string) {
		const q = queue.find((x) => x.id === id);
		if (q) URL.revokeObjectURL(q.url);
		queue = queue.filter((x) => x.id !== id);
	}
	function onFiles(files: FileList | null | undefined) {
		for (const f of Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))) addPhoto(f);
	}
	function onPaste(e: ClipboardEvent) {
		const file = imageFromPaste(e);
		if (file) {
			e.preventDefault();
			addPhoto(file);
		}
	}
	async function pasteFromClipboard() {
		try {
			if (navigator.clipboard?.read) {
				for (const item of await navigator.clipboard.read()) {
					const type = item.types.find((t) => t.startsWith('image/'));
					if (type) return addPhoto(await item.getType(type));
				}
			}
			const t = await navigator.clipboard?.readText?.();
			if (t?.trim()) {
				text = text ? `${text}\n${t}` : t;
				return;
			}
			app.toast('El portapapeles está vacío.', 'info');
		} catch {
			app.toast('No se pudo leer el portapapeles. Mantén pulsado el campo y elige «Pegar».', 'warn');
		}
	}
	function openCamera() {
		if (canLiveCamera) cameraOpen = true;
		else document.getElementById('camera-input')?.click();
	}
	async function onCameraCapture(blob: Blob) {
		addPhoto(blob);
		await generate();
	}
	function applyCrop(blob: Blob) {
		if (!cropping) return;
		const q = queue.find((x) => x.id === cropping!.id);
		if (q) {
			URL.revokeObjectURL(q.url);
			q.blob = blob;
			q.url = URL.createObjectURL(blob);
		}
		cropping = null;
	}

	// --- Generar ---
	function startRun(label: string, estimate: number | null, step: Run['step'] = null) {
		running = { stage: 'sending', startedAt: Date.now(), count: 0, retrying: false, step, label, estimate };
	}
	const hooks = (g: CreateGroup) => {
		// Las tarjetas llegan en vivo; la comprobación de duplicados es async: se encadena para conservar el orden.
		let chain = Promise.resolve();
		return {
			signal: controller!.signal,
			onStage: (s: Stage) => running && (running.stage = s),
			onRetry: () => running && ((running.retrying = true), (running.stage = 'sending')),
			onCard: (c: GeneratedCard) => {
				chain = chain.then(async () => {
					const added = addUnique(groups, g, await toProposals([c]));
					if (running) running.count += added.length;
				});
			},
			done: () => chain,
		};
	};

	function report(r: CardsResult, g: CreateGroup) {
		if (r.dropped.length) app.toast(`Se descartaron ${r.dropped.length} propuesta(s) con formato inválido.`, 'info', { tech: r.dropped.slice(0, 8).join('\n') });
		if (r.warning && r.warning.code !== 'aborted')
			app.toast(`Resultado parcial: ${r.warning.message}`, 'warn', { tech: r.warning.detail, action: { label: 'Reintentar', run: () => void regenerate(g) } });
		if (!g.proposals.length && !r.warning) app.toast('No se encontraron palabras para estudiar.', 'info');
	}

	/** Procesa la entrada actual: fotos de la cola (en orden) y el texto. */
	async function generate() {
		if (running || (!text.trim() && !queue.length)) return;
		controller = new AbortController();
		const photos = [...queue];
		queue = [];
		const input = text.trim();
		const inputMode = mode;
		text = '';
		try {
			for (let i = 0; i < photos.length; i++) {
				if (controller.signal.aborted) break;
				const g: CreateGroup = { id: photos[i].id, kind: 'image', status: 'running', proposals: [], attachImage: true };
				try {
					g.image = (await compressImage(photos[i].blob)).blob;
				} catch (e) {
					app.error(e, 'No se pudo procesar la imagen. Prueba con otro formato.');
					continue;
				} finally {
					URL.revokeObjectURL(photos[i].url);
				}
				groups.unshift(g);
				await runGroup(groups[0], { i: i + 1, n: photos.length });
			}
			if (input && !controller.signal.aborted) {
				const g: CreateGroup = { id: groupId(), kind: inputMode, text: input, status: 'running', proposals: [] };
				groups.unshift(g);
				await runGroup(groups[0]);
			}
		} finally {
			running = null;
			controller = null;
		}
	}

	/** Ejecuta (o reejecuta) un grupo. `instruction` = refinado de lo que ya propuso. */
	async function runGroup(g: CreateGroup, step: Run['step'] = null, instruction?: string) {
		const own = !controller;
		if (own) controller = new AbortController();
		g.status = 'running';
		g.error = undefined;
		const previous = instruction !== undefined ? g.proposals.map(({ keep: _k, dups: _d, dupAction: _a, ...c }) => c) : undefined;
		if (instruction !== undefined) g.proposals = [];
		const h = hooks(g);
		try {
			if (g.kind === 'word') {
				startRun('Creando la tarjeta', costs.word);
				const c = await generateCardFromText(g.text!, { signal: h.signal, onStage: h.onStage });
				g.proposals = await toProposals([c]);
			} else if (g.kind === 'text') {
				startRun(instruction ? 'Ajustando las tarjetas' : 'Eligiendo palabras del texto', costs.text);
				const r = await textToCards(g.text!, { ...h, instruction, previous });
				await h.done();
				report(r, g);
			} else {
				startRun(instruction ? 'Ajustando las tarjetas' : 'Leyendo la foto', costs.image, step);
				const base64 = await blobToBase64(g.image!);
				const r = await imageToCards({ mimeType: g.image!.type || 'image/jpeg', base64 }, { ...h, instruction, previous });
				await h.done();
				report(r, g);
			}
			g.status = 'done';
		} catch (e) {
			await h.done();
			const aborted = (e as { code?: string }).code === 'aborted';
			g.status = aborted && g.proposals.length ? 'done' : 'error';
			g.error = aborted ? 'Cancelado' : e instanceof Error ? e.message : String(e);
			if (!aborted) app.error(e, 'No se pudieron generar las tarjetas', { retry: () => void regenerate(g) });
		} finally {
			if (own) {
				running = null;
				controller = null;
			}
		}
	}

	async function regenerate(g: CreateGroup, instruction?: string) {
		if (running) return;
		if (instruction === undefined) g.proposals = [];
		await runGroup(g, null, instruction);
	}

	function cancel() {
		controller?.abort();
	}

	function blobToBase64(b: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve((r.result as string).split(',')[1]);
			r.onerror = () => reject(r.error);
			r.readAsDataURL(b);
		});
	}

	// --- Refinar ---
	let refineFor = $state<CreateGroup | null>(null);
	let instruction = $state('');

	// --- Guardar ---
	async function ensureDeck(): Promise<number> {
		if (deckId !== null) return deckId;
		const id = await createDeck('Generadas por IA');
		decks = await listDecks();
		deckId = id;
		return id;
	}

	async function save() {
		if (!kept || saving) return;
		saving = true;
		let created = 0;
		let merged = 0;
		try {
			const target = await ensureDeck();
			for (const g of [...groups]) {
				if (!g.proposals.some((p) => p.keep)) continue;
				const r = await saveProposals($state.snapshot(g.proposals) as Proposal[], target, g.image && g.attachImage !== false ? g.image : undefined);
				created += r.created;
				merged += r.merged;
				groups = groups.filter((x) => x.id !== g.id);
			}
			if (!groups.some((g) => g.proposals.length)) {
				groups = [];
				await clearDraft();
			}
			const deck = decks.find((d) => d.id === target);
			app.toast(`${created} ${created === 1 ? 'tarjeta guardada' : 'tarjetas guardadas'}${merged ? ` · ${merged} fusionadas` : ''}${deck ? ` en «${deck.name}»` : ''}`, 'success', {
				action: { label: 'Estudiar', run: () => void goto(`${base}/estudio?mazo=${target}`) },
			});
		} catch (e) {
			app.error(e, 'No se pudieron guardar las tarjetas', { retry: () => void save() });
		} finally {
			saving = false;
		}
	}

	function discardAll() {
		groups = [];
		void clearDraft();
	}

	function autosize(el: HTMLTextAreaElement) {
		el.style.height = 'auto';
		el.style.height = `${Math.min(el.scrollHeight, window.innerHeight * 0.4)}px`;
	}
	$effect(() => {
		void text;
		if (textarea) autosize(textarea);
	});

	const estimate = $derived.by(() => {
		const parts = [queue.length ? (costs.image ?? 0) * queue.length : 0, text.trim() ? ((mode === 'word' ? costs.word : costs.text) ?? 0) : 0];
		const sum = parts.reduce((a, b) => a + b, 0);
		return sum > 0 ? sum : null;
	});
	const fmtDate = (t: number) => new Date(t).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
</script>

<svelte:window onpaste={onPaste} />

<h1 class="mb-3 text-2xl font-bold">Crear</h1>

{#if draftOffer}
	<div class="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm">
		<p class="min-w-0 flex-1">
			Tienes {draftOffer.groups.reduce((a, g) => a + g.proposals.length, 0)} propuestas sin guardar
			{#if draftOffer.groups.some((g) => g.image && !g.proposals.length)}y fotos pendientes{/if} ({fmtDate(draftOffer.updatedAt)}).
		</p>
		<Button variant="ghost" onclick={discardDraft}>Descartar</Button>
		<Button onclick={restoreDraft}>Continuar</Button>
	</div>
{/if}

{#if !hasKey && app.settings}
	<div class="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
		Para crear con IA necesitas una API key de Gemini (gratis para empezar).
		<a href="{base}/ajustes#ia" class="font-semibold underline">Configurarla en Ajustes</a>
	</div>
{/if}

<!-- Entrada única -->
<section class="bg-surface rounded-2xl border border-slate-200 p-3 shadow-sm">
	<label for="crear-texto" class="sr-only">Palabra, frase o texto</label>
	<textarea
		id="crear-texto"
		bind:this={textarea}
		bind:value={text}
		rows="2"
		placeholder="Escribe una palabra (猫, perro) o pega un texto en japonés…"
		class="block max-h-[40vh] min-h-14 w-full resize-none bg-transparent px-1 py-1 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none"
		onkeydown={(e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || mode === 'word') && !e.shiftKey) {
				e.preventDefault();
				void generate();
			}
		}}></textarea>

	{#if queue.length}
		<ul class="mt-2 flex gap-2 overflow-x-auto pb-1" aria-label="Fotos a procesar">
			{#each queue as q (q.id)}
				<li class="relative shrink-0">
					<img src={q.url} alt="Foto en cola" class="size-20 rounded-lg border border-slate-200 object-cover" />
					<button
						class="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full bg-slate-800 text-xs text-white shadow"
						aria-label="Quitar foto"
						onclick={() => removePhoto(q.id)}>✕</button
					>
					<button class="absolute right-1 bottom-1 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white" onclick={() => (cropping = q)}>✂ Recortar</button>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="mt-2 flex flex-wrap items-center gap-1">
		<button class="flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100" onclick={openCamera}>📷 <span>Cámara</span></button>
		<label class="flex min-h-11 cursor-pointer items-center gap-1 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100">
			🖼 <span>Galería</span>
			<input type="file" accept="image/*" multiple class="hidden" onchange={(e) => onFiles((e.currentTarget as HTMLInputElement).files)} />
		</label>
		<input id="camera-input" type="file" accept="image/*" capture="environment" class="hidden" onchange={(e) => onFiles((e.currentTarget as HTMLInputElement).files)} />
		<button class="flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium text-slate-700 hover:bg-slate-100" onclick={pasteFromClipboard}>📋 <span>Pegar</span></button>
	</div>

	{#if text.trim()}
		<div class="mt-2 flex items-center gap-2 text-sm">
			<span class="text-slate-500">Crear</span>
			<div class="flex rounded-full border border-slate-300 p-0.5" role="radiogroup" aria-label="Cuántas tarjetas">
				{#each [['word', '1 tarjeta'], ['text', 'Varias']] as [v, label] (v)}
					<button
						role="radio"
						aria-checked={mode === v}
						class="min-h-9 rounded-full px-3 font-medium transition {mode === v ? 'bg-brand text-brand-fg' : 'text-slate-600 hover:bg-slate-100'}"
						onclick={() => (modeOverride = v as CreateMode)}>{label}</button
					>
				{/each}
			</div>
			{#if !modeOverride}<span class="text-xs text-slate-400">detectado</span>{/if}
		</div>
	{/if}

	<div class="mt-3 flex items-center gap-3">
		<Button size="lg" class="flex-1" disabled={!canGenerate} loading={!!running} onclick={generate}>
			{#if running}Generando…
			{:else if !net.online}Sin conexión
			{:else if queue.length && text.trim()}Generar ({queue.length} {queue.length === 1 ? 'foto' : 'fotos'} + texto)
			{:else if queue.length}Generar desde {queue.length === 1 ? 'la foto' : `${queue.length} fotos`}
			{:else if !text.trim()}Escribe algo o añade una foto
			{:else if mode === 'word'}Crear tarjeta
			{:else}Extraer tarjetas{/if}
		</Button>
		{#if estimate != null}<span class="shrink-0 text-xs text-slate-400">≈ {fmtUsd(estimate)}</span>{/if}
	</div>
</section>

{#if running}
	<div class="mt-4">
		<GenerationProgress
			stage={running.stage}
			startedAt={running.startedAt}
			count={running.count}
			label={running.label}
			retrying={running.retrying}
			step={running.step}
			estimate={running.estimate}
			oncancel={cancel}
		/>
	</div>
{/if}

<!-- Propuestas -->
{#if total || groups.length}
	<div class="mt-5 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
		<h2 class="font-semibold">Propuestas <span class="font-normal text-slate-500">· {kept} de {total} marcadas</span></h2>
		<span class="flex-1"></span>
		<button class="min-h-9 text-sky-700 underline-offset-2 hover:underline" onclick={() => setAllKept(groups, true)}>Todas</button>
		<button class="min-h-9 text-sky-700 underline-offset-2 hover:underline" onclick={() => setAllKept(groups, false)}>Ninguna</button>
		{#if groups.some((g) => g.proposals.some((p) => p.dups.length))}
			<label class="flex min-h-9 items-center gap-1.5 text-slate-600"><input type="checkbox" bind:checked={hideDups} class="size-4 accent-sky-600" /> Ocultar duplicadas</label>
		{/if}
	</div>
{/if}

<div class="space-y-5">
	{#each groups as g (g.id)}
		<section aria-label="Propuestas">
			<header class="mb-2 flex items-center gap-2 text-sm text-slate-500">
				{#if g.kind === 'image'}
					{@const u = urlOf(g)}
					{#if u}<img src={u} alt="" class="size-8 rounded object-cover" />{/if}
					<span class="min-w-0 flex-1 truncate">Foto · {g.proposals.length} {g.proposals.length === 1 ? 'propuesta' : 'propuestas'}</span>
				{:else}
					<span class="min-w-0 flex-1 truncate">{g.kind === 'word' ? 'Palabra' : 'Texto'} · «{g.text}»</span>
				{/if}
				{#if g.status !== 'running'}
					<button
						class="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md px-2 text-base text-sky-700 hover:bg-sky-50 sm:text-sm"
						disabled={!!running || !net.online}
						onclick={() => regenerate(g)}
						aria-label="Generar de nuevo">↻<span class="hidden sm:inline">&nbsp;De nuevo</span></button
					>
					{#if g.kind !== 'word' && g.proposals.length}
						<button
							class="flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md px-2 text-base text-sky-700 hover:bg-sky-50 sm:text-sm"
							disabled={!!running || !net.online}
							onclick={() => ((refineFor = g), (instruction = ''))}
							aria-label="Pedir cambios a la IA">✎<span class="hidden sm:inline">&nbsp;Ajustar</span></button
						>
					{/if}
					<button
						class="flex size-10 shrink-0 items-center justify-center rounded-md hover:bg-slate-100"
						aria-label="Quitar este grupo"
						onclick={() => (groups = groups.filter((x) => x.id !== g.id))}>✕</button
					>
				{/if}
			</header>
			{#if g.status === 'error' && !g.proposals.length}
				<p class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{g.error}</p>
			{:else if g.status === 'running' && !g.proposals.length}
				<div class="h-14 animate-pulse rounded-xl bg-slate-100"></div>
			{:else if g.status === 'done' && !g.proposals.length}
				<p class="rounded-lg bg-slate-100 p-3 text-sm text-slate-500">Sin palabras nuevas (no encontró ninguna o ya estaban en otra propuesta).</p>
			{/if}
			{#if g.proposals.length}
				<CardProposals bind:cards={g.proposals} imageUrl={urlOf(g)} dupsLast {hideDups} autoExpand={g.kind === 'word'} />
			{/if}
			{#if g.kind === 'image' && g.proposals.length}
				<label class="mt-2 flex min-h-11 items-center gap-3 text-sm text-slate-600">
					<input type="checkbox" bind:checked={g.attachImage} class="size-5 accent-sky-600" /> Guardar la foto (cara «Imagen»: recordar la palabra en su contexto)
				</label>
			{/if}
		</section>
	{/each}
</div>

{#if !groups.length && !running && !draftOffer}
	<div class="mt-8 space-y-2 text-center text-sm text-slate-400">
		<p><Furigana text="猫[ねこ]" /> o «perro» → una tarjeta con ejemplos.</p>
		<p>Un párrafo, una letra o subtítulos → varias tarjetas.</p>
		<p>Fotos de un cartel, manga o captura → tarjetas con la palabra marcada.</p>
	</div>
{/if}

{#if total}
	<ActionBar>
		<Select bind:value={deckId} class="min-w-0 flex-1">
			<option value={null}>+ Nuevo mazo «Generadas por IA»</option>
			{#each decks as d (d.id)}
				<option value={d.id}>{d.name}</option>
			{/each}
		</Select>
		<Button variant="ghost" class="px-3" onclick={discardAll} aria-label="Descartar todas">✕</Button>
		<Button variant="success" disabled={!kept || !!running} loading={saving} onclick={save}>Guardar ({kept})</Button>
	</ActionBar>
{/if}

<CameraCapture bind:open={cameraOpen} oncapture={onCameraCapture} />

<Sheet open={!!cropping} title="Recortar la foto" onclose={() => (cropping = null)}>
	{#if cropping}<ImageCropper blob={cropping.blob} onapply={applyCrop} oncancel={() => (cropping = null)} />{/if}
</Sheet>

<Sheet open={!!refineFor} title="Pedir cambios a la IA" onclose={() => (refineFor = null)}>
	<p class="mb-2 text-sm text-slate-500">La IA ajusta sus propuestas en vez de empezar de cero.</p>
	<textarea
		bind:value={instruction}
		rows="3"
		placeholder="Ej.: solo verbos · corrige las lecturas · menos palabras básicas"
		class="bg-surface w-full rounded-lg border border-slate-300 p-2 text-base focus:border-sky-500 focus:outline-none"></textarea>
	<div class="mt-3 flex flex-wrap gap-2">
		{#each ['Solo verbos', 'Menos palabras básicas', 'Más expresiones', 'Corrige las lecturas'] as s (s)}
			<button class="min-h-9 rounded-full border border-slate-300 px-3 text-sm hover:bg-slate-50" onclick={() => (instruction = instruction ? `${instruction}; ${s.toLowerCase()}` : s)}
				>{s}</button
			>
		{/each}
	</div>
	<div class="mt-4 flex justify-end gap-2">
		<Button variant="ghost" onclick={() => (refineFor = null)}>Cancelar</Button>
		<Button
			disabled={!instruction.trim()}
			onclick={() => {
				const g = refineFor!;
				refineFor = null;
				void regenerate(g, instruction.trim());
			}}>Ajustar</Button
		>
	</div>
</Sheet>
