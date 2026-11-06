<script lang="ts">
	import { onMount } from 'svelte';
	import { listDecks, createDeck } from '$lib/db/decks';
	import { createCard, findDuplicates, mergeContext } from '$lib/db/cards';
	import type { Card, Deck } from '$lib/db/schema';
	import { generateCardFromText } from '$lib/gemini/generateCard';
	import { textToCards } from '$lib/gemini/imageToCards';
	import type { GeneratedCard } from '$lib/gemini/schemas';
	import { GeminiError } from '$lib/gemini/client';
	import { takePending } from '$lib/inbox';
	import { contextOf, saveProposals, toProposals, type Proposal } from '$lib/proposals';
	import Furigana from '$lib/gui/Furigana.svelte';
	import { speakJapanese } from '$lib/media/tts';
	import { app } from '$lib/state/app.svelte';
	import Button from '$lib/gui/Button.svelte';
	import IconButton from '$lib/gui/IconButton.svelte';
	import Field from '$lib/gui/Field.svelte';
	import Select from '$lib/gui/Select.svelte';
	import CardProposals from '$lib/gui/CardProposals.svelte';

	type Mode = 'word' | 'text';
	let mode = $state<Mode>('word');

	// Modo palabra: una tarjeta.
	let input = $state('');
	let loading = $state(false);
	let draft = $state<GeneratedCard | null>(null);
	let dups = $state<Card[]>([]);

	// Modo texto largo: varias tarjetas desde un texto pegado (B5).
	let longText = $state('');
	let proposals = $state<Proposal[]>([]);

	let decks = $state<Deck[]>([]);
	let deckId = $state<number | null>(null);

	onMount(async () => {
		try {
			decks = await listDecks();
			deckId = decks[0]?.id ?? null;
		} catch {
			app.toast('No se pudieron cargar los mazos', 'error');
		}
		// Texto compartido desde otra app.
		const shared = takePending('crear');
		if (shared?.text) {
			if (shared.long) {
				mode = 'text';
				longText = shared.text;
				await extractText();
			} else {
				input = shared.text;
				await generate();
			}
		}
	});

	async function generate() {
		if (!input.trim()) return;
		loading = true;
		draft = null;
		dups = [];
		try {
			draft = await generateCardFromText(input.trim());
			dups = await findDuplicates(draft.front);
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'Error al generar', 'error', { action: { label: 'Reintentar', run: () => void generate() } });
		} finally {
			loading = false;
		}
	}

	async function extractText(instruction?: string) {
		if (!longText.trim()) return;
		loading = true;
		try {
			const previous = instruction !== undefined ? proposals.map(({ keep: _k, dups: _d, dupAction: _a, ...c }) => c) : undefined;
			proposals = await toProposals(await textToCards(longText.trim(), { instruction, previous }));
			if (!proposals.length) app.toast('No se encontraron palabras para estudiar.', 'info');
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'Error al extraer', 'error', { action: { label: 'Reintentar', run: () => void extractText(instruction) } });
		} finally {
			loading = false;
		}
	}

	async function ensureDeck(): Promise<number> {
		if (deckId !== null) return deckId;
		const id = await createDeck('Generadas por IA');
		decks = await listDecks();
		deckId = id;
		return id;
	}

	async function save(merge = false) {
		if (!draft) return;
		try {
			if (merge && dups[0]?.id != null) {
				await mergeContext(dups[0].id, contextOf(draft));
				app.toast('Contexto añadido a la tarjeta existente', 'success');
			} else {
				await createCard({ deckId: await ensureDeck(), front: draft.front, back: draft.back, reading: draft.reading || undefined, context: contextOf(draft) });
				app.toast('Tarjeta guardada', 'success');
			}
		} catch {
			app.toast('No se pudo guardar la tarjeta', 'error');
			return;
		}
		draft = null;
		dups = [];
		input = '';
	}

	async function saveMany() {
		if (!proposals.some((p) => p.keep)) return;
		try {
			const res = await saveProposals($state.snapshot(proposals) as Proposal[], await ensureDeck());
			app.toast(`${res.created} tarjetas guardadas${res.merged ? ` · ${res.merged} fusionadas` : ''}`, 'success');
			proposals = [];
			longText = '';
		} catch {
			app.toast('No se pudieron guardar las tarjetas', 'error');
		}
	}

	const showBar = $derived((mode === 'word' && draft) || (mode === 'text' && proposals.length));
</script>

<h1 class="mb-4 text-2xl font-bold">Crear con IA</h1>

<div class="mb-4 flex rounded-full border border-slate-300 p-0.5 text-sm" role="radiogroup" aria-label="Qué crear">
	{#each [['word', 'Palabra o frase'], ['text', 'Texto largo → varias']] as [v, label] (v)}
		<button
			role="radio"
			aria-checked={mode === v}
			class="min-h-9 flex-1 rounded-full px-3 font-medium transition {mode === v ? 'bg-brand text-brand-fg' : 'text-slate-600 hover:bg-slate-100'}"
			onclick={() => (mode = v as Mode)}>{label}</button
		>
	{/each}
</div>

{#if mode === 'word'}
	<div class="flex gap-2">
		<Field bind:value={input} placeholder="Palabra o frase (japonés o español)" class="flex-1" onkeydown={(e) => e.key === 'Enter' && generate()} />
		<Button {loading} onclick={generate}>Generar</Button>
	</div>

	{#if draft}
		<div class="bg-surface mt-6 rounded-xl border border-slate-200 p-4 shadow-sm">
			<div class="mb-3 flex items-center gap-2 text-2xl">
				<Furigana text={draft.front} />
				<IconButton label="Escuchar" onclick={() => draft && speakJapanese(draft.front)}>♪</IconButton>
			</div>
			{#if dups.length}
				<div class="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-700">
					Ya tienes esta palabra: <Furigana text={dups[0].front} /> — {dups[0].back}.
					<button class="ml-1 font-medium underline" onclick={() => save(true)}>Fusionar el contexto en ella</button>
				</div>
			{/if}
			<div class="grid gap-3">
				<Field label="Frente" bind:value={draft.front} onchange={async () => draft && (dups = await findDuplicates(draft.front))} />
				<Field label="Significado" bind:value={draft.back} />
				<Field label="Lectura" bind:value={draft.reading} />
				<Field label="Contexto" type="textarea" bind:value={draft.context} />
			</div>
			{#if draft.examples.length}
				<ul class="mt-3 space-y-1 text-sm text-slate-600">
					{#each draft.examples as ex, i (i)}
						<li><Furigana text={ex.jp} /> — {ex.es}</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
{:else}
	<Field type="textarea" rows={6} bind:value={longText} placeholder="Pega un texto en japonés: letra de canción, subtítulos, un artículo…" />
	<div class="mt-2"><Button {loading} onclick={() => extractText()}>Extraer tarjetas</Button></div>
	{#if proposals.length}
		<CardProposals bind:cards={proposals} {loading} onrefine={(i) => extractText(i)} onretry={() => extractText()} />
	{/if}
{/if}

{#if showBar}
	<div class="h-24 sm:hidden" aria-hidden="true"></div>
	<!-- Barra de guardado al alcance del pulgar -->
	<div class="bottom-nav pointer-events-none fixed inset-x-0 z-30 px-4 sm:static sm:mt-4 sm:px-0">
		<div
			class="bg-surface/95 pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-slate-200 p-2 shadow-lg backdrop-blur sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none"
		>
			<Select bind:value={deckId} class="flex-1">
				<option value={null}>+ Nuevo mazo "Generadas por IA"</option>
				{#each decks as d (d.id)}
					<option value={d.id}>{d.name}</option>
				{/each}
			</Select>
			{#if mode === 'word'}
				<Button variant="success" onclick={() => save(false)}>{dups.length ? 'Guardar igual' : 'Guardar'}</Button>
			{:else}
				<Button variant="success" onclick={saveMany}>Guardar ({proposals.filter((p) => p.keep).length})</Button>
			{/if}
		</div>
	</div>
{/if}
