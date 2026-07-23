<script lang="ts">
	import { onMount } from 'svelte';
	import { listDecks, createDeck, updateDeck, deleteDeck, countCards } from '$lib/db/decks';
	import { listCards, createCard, updateCard, deleteCardWithSnapshot, restoreCard } from '$lib/db/cards';
	import type { Deck, Card } from '$lib/db/schema';
	import { app } from '$lib/state/app.svelte';
	import Furigana from '$lib/gui/Furigana.svelte';
	import { speakJapanese } from '$lib/media/tts';
	import Button from '$lib/gui/Button.svelte';
	import IconButton from '$lib/gui/IconButton.svelte';
	import Field from '$lib/gui/Field.svelte';
	import Sheet from '$lib/gui/Sheet.svelte';
	import ConfirmDialog from '$lib/gui/ConfirmDialog.svelte';

	let decks = $state<Deck[]>([]);
	let counts = $state<Record<number, number>>({});
	let openDeck = $state<number | null>(null);
	let cards = $state<Card[]>([]);

	let newDeckName = $state('');
	let newDeckDesc = $state('');
	let form = $state({ front: '', back: '', reading: '', context: '' });

	// Edición de metadatos de mazo.
	let editingDeckId = $state<number | null>(null);
	let deckForm = $state({ name: '', description: '' });

	// Edición de tarjeta.
	let editingCardId = $state<number | null>(null);
	let cardForm = $state({ front: '', back: '', reading: '', context: '' });

	// Menús de acción (bottom sheet) y confirmación.
	let menuDeck = $state<Deck | null>(null);
	let menuCard = $state<Card | null>(null);
	let deckToDelete = $state<Deck | null>(null);

	async function reloadDecks() {
		decks = await listDecks();
		const c: Record<number, number> = {};
		for (const d of decks) c[d.id!] = await countCards(d.id!);
		counts = c;
	}

	async function openCards(id: number) {
		openDeck = openDeck === id ? null : id;
		if (openDeck !== null) cards = await listCards(id);
	}

	async function addDeck() {
		const name = newDeckName.trim();
		if (!name) return;
		await createDeck(name, newDeckDesc.trim());
		newDeckName = '';
		newDeckDesc = '';
		await reloadDecks();
		app.toast('Mazo creado', 'success');
	}

	function startEditDeck(deck: Deck) {
		editingDeckId = deck.id!;
		deckForm = { name: deck.name, description: deck.description ?? '' };
	}

	async function saveDeck() {
		if (editingDeckId === null || !deckForm.name.trim()) return;
		await updateDeck(editingDeckId, {
			name: deckForm.name.trim(),
			description: deckForm.description.trim() || undefined,
		});
		editingDeckId = null;
		await reloadDecks();
		app.toast('Mazo actualizado', 'success');
	}

	async function removeDeck(id: number) {
		await deleteDeck(id);
		if (openDeck === id) openDeck = null;
		if (editingDeckId === id) editingDeckId = null;
		await reloadDecks();
		app.toast('Mazo borrado', 'success');
	}

	async function addCard() {
		if (openDeck === null || !form.front.trim() || !form.back.trim()) return;
		await createCard({
			deckId: openDeck,
			front: form.front.trim(),
			back: form.back.trim(),
			reading: form.reading.trim() || undefined,
			context: form.context.trim() || undefined,
		});
		form = { front: '', back: '', reading: '', context: '' };
		cards = await listCards(openDeck);
		await reloadDecks();
		app.toast('Tarjeta añadida', 'success');
	}

	function startEditCard(card: Card) {
		editingCardId = card.id!;
		cardForm = {
			front: card.front,
			back: card.back,
			reading: card.reading ?? '',
			context: card.context ?? '',
		};
	}

	async function saveCard() {
		if (editingCardId === null || !cardForm.front.trim() || !cardForm.back.trim()) return;
		await updateCard(editingCardId, {
			front: cardForm.front.trim(),
			back: cardForm.back.trim(),
			reading: cardForm.reading.trim() || undefined,
			context: cardForm.context.trim() || undefined,
		});
		editingCardId = null;
		if (openDeck !== null) cards = await listCards(openDeck);
		app.toast('Tarjeta actualizada', 'success');
	}

	// Borra con opción de deshacer (restaura tarjeta + progreso FSRS).
	async function removeCard(id: number) {
		const snap = await deleteCardWithSnapshot(id);
		if (editingCardId === id) editingCardId = null;
		if (openDeck !== null) cards = await listCards(openDeck);
		await reloadDecks();
		if (!snap) return;
		app.toast('Tarjeta borrada', 'info', {
			action: {
				label: 'Deshacer',
				run: async () => {
					await restoreCard(snap);
					if (openDeck !== null) cards = await listCards(openDeck);
					await reloadDecks();
				},
			},
		});
	}

	onMount(reloadDecks);
</script>

<h1 class="mb-4 text-2xl font-bold">Mazos</h1>

<form class="mb-6 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onsubmit={(e) => (e.preventDefault(), addDeck())}>
	<Field bind:value={newDeckName} placeholder="Nombre del mazo" />
	<Field bind:value={newDeckDesc} placeholder="Descripción (opcional)" />
	<Button type="submit">Crear</Button>
</form>

<div class="space-y-3">
	{#each decks as deck (deck.id)}
		<div class="rounded-xl border border-slate-200 bg-white shadow-sm">
			{#if editingDeckId === deck.id}
				<form class="grid gap-2 p-4 sm:grid-cols-2" onsubmit={(e) => (e.preventDefault(), saveDeck())}>
					<Field bind:value={deckForm.name} placeholder="Nombre del mazo" class="sm:col-span-2" />
					<Field bind:value={deckForm.description} placeholder="Descripción (opcional)" class="sm:col-span-2" />
					<div class="flex gap-2 sm:col-span-2">
						<Button type="submit">Guardar</Button>
						<Button variant="secondary" onclick={() => (editingDeckId = null)}>Cancelar</Button>
					</div>
				</form>
			{:else}
				<div class="flex items-center gap-1 p-2 pl-4">
					<button class="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 text-left" onclick={() => openCards(deck.id!)}>
						<span
							class="shrink-0 text-slate-400 transition-transform {openDeck === deck.id ? 'rotate-90' : ''}"
							aria-hidden="true">›</span
						>
						<span class="min-w-0">
							<span class="block truncate font-semibold">{deck.name}</span>
							{#if deck.description}
								<span class="block truncate text-sm text-slate-600">{deck.description}</span>
							{/if}
							<span class="block text-sm text-slate-500">{counts[deck.id!] ?? 0} tarjetas</span>
						</span>
					</button>
					<IconButton label="Opciones del mazo" onclick={() => (menuDeck = deck)}>⋯</IconButton>
				</div>
			{/if}

			{#if openDeck === deck.id}
				<div class="border-t border-slate-100 p-4">
					<!-- Alta de tarjeta -->
					<div class="mb-4 grid gap-2 sm:grid-cols-2">
						<Field bind:value={form.front} placeholder="Frente (japonés, ej. 私[わたし])" class="sm:col-span-2" />
						<Field bind:value={form.back} placeholder="Reverso (significado)" />
						<Field bind:value={form.reading} placeholder="Lectura (kana)" />
						<Field bind:value={form.context} placeholder="Contexto / ejemplo" class="sm:col-span-2" />
						<div class="flex items-center gap-3 sm:col-span-2">
							<Button variant="primary" class="bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800" onclick={addCard}>Añadir tarjeta</Button>
							{#if form.front}
								<span class="text-lg"><Furigana text={form.front} /></span>
							{/if}
						</div>
					</div>

					<!-- Listado -->
					<ul class="divide-y divide-slate-100">
						{#each cards as card (card.id)}
							{#if editingCardId === card.id}
								<li class="py-2">
									<form class="grid gap-2 sm:grid-cols-2" onsubmit={(e) => (e.preventDefault(), saveCard())}>
										<Field bind:value={cardForm.front} placeholder="Frente (japonés, ej. 私[わたし])" class="sm:col-span-2" />
										<Field bind:value={cardForm.back} placeholder="Reverso (significado)" />
										<Field bind:value={cardForm.reading} placeholder="Lectura (kana)" />
										<Field bind:value={cardForm.context} placeholder="Contexto / ejemplo" class="sm:col-span-2" />
										<div class="flex items-center gap-2 sm:col-span-2">
											<Button type="submit">Guardar</Button>
											<Button variant="secondary" onclick={() => (editingCardId = null)}>Cancelar</Button>
											{#if cardForm.front}
												<span class="text-lg"><Furigana text={cardForm.front} /></span>
											{/if}
										</div>
									</form>
								</li>
							{:else}
								<li class="flex items-center justify-between gap-2 py-2">
									<div class="min-w-0 flex-1">
										<div class="truncate text-lg"><Furigana text={card.front} /></div>
										<div class="truncate text-sm text-slate-500">{card.back}</div>
									</div>
									<IconButton label="Opciones de la tarjeta" onclick={() => (menuCard = card)}>⋯</IconButton>
								</li>
							{/if}
						{:else}
							<li class="py-2 text-sm text-slate-400">Sin tarjetas todavía.</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	{:else}
		<p class="text-slate-400">No hay mazos. Crea uno arriba.</p>
	{/each}
</div>

<!-- Menú de acciones de mazo -->
<Sheet open={menuDeck !== null} title={menuDeck?.name} onclose={() => (menuDeck = null)}>
	<div class="flex flex-col gap-2">
		<Button
			variant="secondary"
			size="lg"
			full
			onclick={() => {
				if (menuDeck) startEditDeck(menuDeck);
				menuDeck = null;
			}}>✏️ Editar mazo</Button
		>
		<Button
			variant="danger"
			size="lg"
			full
			onclick={() => {
				deckToDelete = menuDeck;
				menuDeck = null;
			}}>🗑️ Borrar mazo</Button
		>
	</div>
</Sheet>

<!-- Menú de acciones de tarjeta -->
<Sheet open={menuCard !== null} onclose={() => (menuCard = null)}>
	<div class="flex flex-col gap-2">
		<Button
			variant="secondary"
			size="lg"
			full
			onclick={() => {
				if (menuCard) speakJapanese(menuCard.front);
			}}>♪ Escuchar</Button
		>
		<Button
			variant="secondary"
			size="lg"
			full
			onclick={() => {
				if (menuCard) startEditCard(menuCard);
				menuCard = null;
			}}>✏️ Editar tarjeta</Button
		>
		<Button
			variant="danger"
			size="lg"
			full
			onclick={() => {
				if (menuCard?.id != null) removeCard(menuCard.id);
				menuCard = null;
			}}>🗑️ Borrar tarjeta</Button
		>
	</div>
</Sheet>

<!-- Confirmación de borrado de mazo -->
<ConfirmDialog
	open={deckToDelete !== null}
	title="¿Borrar el mazo?"
	message="Se borrarán el mazo y todas sus tarjetas. Esta acción no se puede deshacer."
	confirmLabel="Borrar mazo"
	oncancel={() => (deckToDelete = null)}
	onconfirm={() => {
		if (deckToDelete?.id != null) removeDeck(deckToDelete.id);
		deckToDelete = null;
	}}
/>
