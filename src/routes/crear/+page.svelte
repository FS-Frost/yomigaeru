<script lang="ts">
	import { onMount } from 'svelte';
	import { listDecks, createDeck } from '$lib/db/decks';
	import { createCard } from '$lib/db/cards';
	import type { Deck } from '$lib/db/schema';
	import { generateCardFromText } from '$lib/gemini/generateCard';
	import type { GeneratedCard } from '$lib/gemini/schemas';
	import { GeminiError } from '$lib/gemini/client';
	import Furigana from '$lib/gui/Furigana.svelte';
	import { speakJapanese } from '$lib/media/tts';
	import { app } from '$lib/state/app.svelte';
	import Button from '$lib/gui/Button.svelte';
	import IconButton from '$lib/gui/IconButton.svelte';
	import Field from '$lib/gui/Field.svelte';
	import Select from '$lib/gui/Select.svelte';

	let input = $state('');
	let loading = $state(false);
	let draft = $state<GeneratedCard | null>(null);
	let decks = $state<Deck[]>([]);
	let deckId = $state<number | null>(null);

	onMount(async () => {
		decks = await listDecks();
		deckId = decks[0]?.id ?? null;
	});

	async function generate() {
		if (!input.trim()) return;
		loading = true;
		draft = null;
		try {
			draft = await generateCardFromText(input.trim());
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'Error al generar', 'error');
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

	async function save() {
		if (!draft) return;
		const targetDeck = await ensureDeck();
		const contextParts = [draft.context, ...draft.examples.map((e) => `${e.jp} — ${e.es}`)].filter(Boolean);
		await createCard({
			deckId: targetDeck,
			front: draft.front,
			back: draft.back,
			reading: draft.reading || undefined,
			context: contextParts.join('\n') || undefined,
		});
		app.toast('Tarjeta guardada', 'success');
		draft = null;
		input = '';
	}
</script>

<h1 class="mb-4 text-2xl font-bold">Crear con IA</h1>

<div class="flex gap-2">
	<Field bind:value={input} placeholder="Palabra o frase (japonés o español)" class="flex-1" onkeydown={(e) => e.key === 'Enter' && generate()} />
	<Button {loading} onclick={generate}>Generar</Button>
</div>

{#if draft}
	<div class="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
		<div class="mb-3 flex items-center gap-2 text-2xl">
			<Furigana text={draft.front} />
			<IconButton label="Escuchar" onclick={() => draft && speakJapanese(draft.front)}>♪</IconButton>
		</div>
		<div class="grid gap-3">
			<Field label="Frente" bind:value={draft.front} />
			<Field label="Significado" bind:value={draft.back} />
			<Field label="Lectura" bind:value={draft.reading} />
			<Field label="Contexto" type="textarea" bind:value={draft.context} />
		</div>

		{#if draft.examples.length}
			<ul class="mt-3 space-y-1 text-sm text-slate-600">
				{#each draft.examples as ex}
					<li><Furigana text={ex.jp} /> — {ex.es}</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="h-24 sm:hidden" aria-hidden="true"></div>

	<!-- Barra de guardado al alcance del pulgar -->
	<div class="bottom-nav pointer-events-none fixed inset-x-0 z-30 px-4 sm:static sm:mt-4 sm:px-0">
		<div class="pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-lg backdrop-blur sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
			<Select bind:value={deckId} class="flex-1">
				<option value={null}>+ Nuevo mazo "Generadas por IA"</option>
				{#each decks as d}
					<option value={d.id}>{d.name}</option>
				{/each}
			</Select>
			<Button variant="primary" class="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800" onclick={save}>Guardar</Button>
		</div>
	</div>
{/if}
