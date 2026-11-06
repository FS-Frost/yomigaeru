<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { listDecks, createDeck, updateDeck, deleteDeck, countCards } from '$lib/db/decks';
	import { listCards, createCard, updateCard, deleteCardWithSnapshot, restoreCard, setSuspended, pauseCard, moveCard, duplicateGroups } from '$lib/db/cards';
	import { db, type Box, type Deck, type Card, type Facet } from '$lib/db/schema';
	import { gcImages, imageUrl } from '$lib/db/images';
	import BoxEditor from '$lib/gui/BoxEditor.svelte';
	import { downloadBlob } from '$lib/db/backup';
	import { getSetting } from '$lib/db/settings';
	import { queueSummary } from '$lib/srs/queue';
	import { eligibleFacets, FACET_LABELS } from '$lib/srs/facets';
	import { LEECH_LAPSES, PAUSE_DAYS } from '$lib/srs/constants';
	import { cardsToTsv } from '$lib/anki';
	import { takePending } from '$lib/inbox';
	import { synthesizeJapanese } from '$lib/gemini/tts';
	import { GeminiError } from '$lib/gemini/client';
	import { averageCost } from '$lib/gemini/usage';
	import { fmtUsd } from '$lib/gemini/pricing';
	import { app } from '$lib/state/app.svelte';
	import Furigana from '$lib/gui/Furigana.svelte';
	import CardImage from '$lib/gui/CardImage.svelte';
	import { speakJapanese } from '$lib/media/tts';
	import Button from '$lib/gui/Button.svelte';
	import IconButton from '$lib/gui/IconButton.svelte';
	import Field from '$lib/gui/Field.svelte';
	import Select from '$lib/gui/Select.svelte';
	import Sheet from '$lib/gui/Sheet.svelte';
	import ConfirmDialog from '$lib/gui/ConfirmDialog.svelte';
	import ImportWizard from '$lib/gui/ImportWizard.svelte';

	let decks = $state<Deck[]>([]);
	let counts = $state<Record<number, number>>({});
	let due = $state<Record<number, number>>({});
	let openDeck = $state<number | null>(null);
	let cards = $state<Card[]>([]);
	/** Fallos máximos por tarjeta (sanguijuelas). */
	let lapses = $state<Record<number, number>>({});
	type Filter = 'all' | 'leech' | 'suspended' | 'image';
	let filter = $state<Filter>('all');
	let search = $state('');
	let globalNewPerDay = $state(20);

	let newDeckName = $state('');
	let newDeckDesc = $state('');
	let form = $state({ front: '', back: '', reading: '', context: '' });

	// Edición de metadatos de mazo.
	let editingDeckId = $state<number | null>(null);
	let deckForm = $state({ name: '', description: '', newPerDay: '' });

	// Edición de tarjeta.
	let editingCardId = $state<number | null>(null);
	let cardForm = $state({ front: '', back: '', reading: '', context: '', facets: [] as Facet[], dropImage: false });
	const editingCard = $derived(cards.find((c) => c.id === editingCardId));

	// Menús de acción (bottom sheet) y confirmación.
	let menuDeck = $state<Deck | null>(null);
	let menuCard = $state<Card | null>(null);
	let moveTarget = $state<number | null>(null);
	let deckToDelete = $state<Deck | null>(null);

	// Importación y duplicados.
	let importFile = $state<File | null>(null);
	let dupGroups = $state<Card[][] | null>(null);

	// Audio por lotes.
	let audioJob = $state<{ done: number; total: number; cancel: boolean } | null>(null);
	let audioEstimate = $state<number | null>(null);

	const shown = $derived(
		cards.filter((c) => {
			if (filter === 'leech' && (lapses[c.id!] ?? 0) < LEECH_LAPSES) return false;
			if (filter === 'suspended' && !c.suspended) return false;
			if (filter === 'image' && c.imageId == null) return false;
			const q = search.trim().toLowerCase();
			return !q || c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q) || (c.reading ?? '').includes(q);
		}),
	);

	async function reloadDecks() {
		decks = await listDecks();
		const c: Record<number, number> = {};
		const d: Record<number, number> = {};
		for (const deck of decks) {
			c[deck.id!] = await countCards(deck.id!);
			const s = await queueSummary(Date.now(), deck.id!);
			d[deck.id!] = s.reviews + s.newToday;
		}
		counts = c;
		due = d;
	}

	async function loadCards(id: number) {
		cards = await listCards(id);
		const ids = cards.map((c) => c.id!);
		const l: Record<number, number> = {};
		for (const s of await db.schedules.where('cardId').anyOf(ids).toArray()) l[s.cardId] = Math.max(l[s.cardId] ?? 0, s.lapses);
		lapses = l;
	}

	async function openCards(id: number) {
		openDeck = openDeck === id ? null : id;
		filter = 'all';
		search = '';
		if (openDeck === null) return;
		try {
			await loadCards(id);
		} catch {
			app.toast('No se pudieron cargar las tarjetas', 'error');
		}
	}

	async function addDeck() {
		const name = newDeckName.trim();
		if (!name) return;
		try {
			await createDeck(name, newDeckDesc.trim());
			newDeckName = '';
			newDeckDesc = '';
			await reloadDecks();
		} catch {
			app.toast('No se pudo crear el mazo', 'error');
			return;
		}
		app.toast('Mazo creado', 'success');
	}

	function startEditDeck(deck: Deck) {
		editingDeckId = deck.id!;
		deckForm = { name: deck.name, description: deck.description ?? '', newPerDay: deck.newPerDay != null ? String(deck.newPerDay) : '' };
	}

	async function saveDeck() {
		if (editingDeckId === null || !deckForm.name.trim()) return;
		const n = deckForm.newPerDay.trim() === '' ? undefined : Math.max(0, Math.round(Number(deckForm.newPerDay)));
		try {
			await updateDeck(editingDeckId, {
				name: deckForm.name.trim(),
				description: deckForm.description.trim() || undefined,
				newPerDay: Number.isFinite(n) ? n : undefined,
			});
			editingDeckId = null;
			await reloadDecks();
		} catch {
			app.toast('No se pudo actualizar el mazo', 'error');
			return;
		}
		app.toast('Mazo actualizado', 'success');
	}

	async function removeDeck(id: number) {
		try {
			await deleteDeck(id);
			if (openDeck === id) openDeck = null;
			if (editingDeckId === id) editingDeckId = null;
			await reloadDecks();
		} catch {
			app.toast('No se pudo borrar el mazo', 'error');
			return;
		}
		app.toast('Mazo borrado', 'success');
	}

	async function exportDeck(deck: Deck) {
		try {
			const list = await listCards(deck.id!);
			const tsv = cardsToTsv(list, deck.name);
			downloadBlob(new Blob([tsv], { type: 'text/tab-separated-values;charset=utf-8' }), `${deck.name.replace(/[\\/:*?"<>|]/g, '_')}.tsv`);
			app.toast(`${list.length} tarjetas exportadas para Anki`, 'success', { detail: 'En Anki: Archivo → Importar. La furigana 漢字[かな] funciona con el complemento Japanese Support.' });
		} catch {
			app.toast('No se pudo exportar el mazo', 'error');
		}
	}

	async function addCard() {
		if (openDeck === null || !form.front.trim() || !form.back.trim()) return;
		try {
			await createCard({
				deckId: openDeck,
				front: form.front.trim(),
				back: form.back.trim(),
				reading: form.reading.trim() || undefined,
				context: form.context.trim() || undefined,
			});
			form = { front: '', back: '', reading: '', context: '' };
			await loadCards(openDeck);
			await reloadDecks();
		} catch {
			app.toast('No se pudo añadir la tarjeta', 'error');
			return;
		}
		app.toast('Tarjeta añadida', 'success');
	}

	function startEditCard(card: Card) {
		editingCardId = card.id!;
		cardForm = {
			front: card.front,
			back: card.back,
			reading: card.reading ?? '',
			context: card.context ?? '',
			facets: [...(card.facets ?? ['recognition'])],
			dropImage: false,
		};
		// Caja editable sobre la imagen (B1): se carga la URL de la foto.
		boxItems = [{ front: card.front, box: card.box ? ([...card.box] as Box) : undefined }];
		boxSelected = 0;
		editImageUrl = null;
		if (card.imageId != null) void imageUrl(card.imageId).then((u) => (editImageUrl = u));
	}

	let boxItems = $state<{ front: string; box?: Box }[]>([]);
	let boxSelected = $state<number | null>(0);
	let editImageUrl = $state<string | null>(null);

	/** Caras posibles con el contenido del formulario (se recalcula al editar el contexto). */
	const formEligible = $derived(editingCard ? eligibleFacets({ front: cardForm.front, context: cardForm.context, imageId: cardForm.dropImage ? undefined : editingCard.imageId }) : []);

	function toggleFacet(f: Facet) {
		if (f === 'recognition') return;
		cardForm.facets = cardForm.facets.includes(f) ? cardForm.facets.filter((x) => x !== f) : [...cardForm.facets, f];
	}

	async function saveCard() {
		if (editingCardId === null || !cardForm.front.trim() || !cardForm.back.trim()) return;
		try {
			await updateCard(editingCardId, {
				front: cardForm.front.trim(),
				back: cardForm.back.trim(),
				reading: cardForm.reading.trim() || undefined,
				context: cardForm.context.trim() || undefined,
				facets: [...cardForm.facets],
				...(cardForm.dropImage ? { imageId: undefined, box: undefined } : { box: boxItems[0]?.box ? ([...boxItems[0].box] as Box) : undefined }),
			});
			if (cardForm.dropImage) await gcImages();
			editingCardId = null;
			if (openDeck !== null) await loadCards(openDeck);
		} catch {
			app.toast('No se pudo actualizar la tarjeta', 'error');
			return;
		}
		app.toast('Tarjeta actualizada', 'success');
	}

	// Borra con opción de deshacer (restaura tarjeta + progreso).
	async function removeCard(id: number) {
		let snap;
		try {
			snap = await deleteCardWithSnapshot(id);
			if (editingCardId === id) editingCardId = null;
			if (openDeck !== null) await loadCards(openDeck);
			await reloadDecks();
		} catch {
			app.toast('No se pudo borrar la tarjeta', 'error');
			return;
		}
		if (!snap) return;
		app.toast('Tarjeta borrada', 'info', {
			action: {
				label: 'Deshacer',
				run: async () => {
					try {
						await restoreCard(snap);
						if (openDeck !== null) await loadCards(openDeck);
						await reloadDecks();
					} catch {
						app.toast('No se pudo restaurar la tarjeta', 'error');
					}
				},
			},
		});
	}

	async function toggleSuspend(card: Card) {
		try {
			await setSuspended(card.id!, !card.suspended);
			if (openDeck !== null) await loadCards(openDeck);
			await reloadDecks();
			app.toast(card.suspended ? 'Tarjeta reanudada' : 'Tarjeta suspendida', 'success');
		} catch {
			app.toast('No se pudo cambiar el estado', 'error');
		}
	}

	async function pause(card: Card) {
		try {
			await pauseCard(card.id!, PAUSE_DAYS);
			await reloadDecks();
			app.toast(`Pausada ${PAUSE_DAYS} días`, 'success');
		} catch {
			app.toast('No se pudo pausar', 'error');
		}
	}

	async function move(card: Card, target: number) {
		try {
			await moveCard(card.id!, target);
			if (openDeck !== null) await loadCards(openDeck);
			await reloadDecks();
			app.toast('Tarjeta movida', 'success');
		} catch {
			app.toast('No se pudo mover', 'error');
		}
	}

	async function findDups() {
		try {
			dupGroups = await duplicateGroups();
			if (!dupGroups.length) {
				dupGroups = null;
				app.toast('No hay duplicados', 'success');
			}
		} catch {
			app.toast('No se pudieron buscar duplicados', 'error');
		}
	}

	async function removeDup(card: Card) {
		await removeCard(card.id!);
		dupGroups = (dupGroups ?? []).map((g) => g.filter((c) => c.id !== card.id)).filter((g) => g.length > 1);
		if (!dupGroups.length) dupGroups = null;
	}

	/** Genera audio natural para las tarjetas del mazo que no lo tengan (cancelable). */
	async function deckAudio(deck: Deck) {
		const list = (await listCards(deck.id!)).filter((c) => !c.audioBlob);
		if (!list.length) {
			app.toast('Todas las tarjetas ya tienen audio', 'info');
			return;
		}
		audioJob = { done: 0, total: list.length, cancel: false };
		try {
			for (const c of list) {
				if (audioJob.cancel) break;
				const blob = await synthesizeJapanese(c.front);
				await updateCard(c.id!, { audioBlob: blob });
				audioJob.done++;
			}
			app.toast(`Audio generado para ${audioJob.done} tarjetas`, 'success');
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'Error al generar audio', 'error', { detail: `Se guardaron ${audioJob?.done ?? 0}. Puedes retomar: solo se generan las que faltan.` });
		} finally {
			audioJob = null;
			if (openDeck !== null) await loadCards(openDeck);
		}
	}

	function onImportPicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		importFile = input.files?.[0] ?? null;
		input.value = '';
	}

	onMount(async () => {
		try {
			await reloadDecks();
			globalNewPerDay = await getSetting('newPerDay');
			audioEstimate = await averageCost('tts');
		} catch {
			app.toast('No se pudieron cargar los mazos', 'error');
		}
		const shared = takePending('mazos');
		if (shared?.files[0]) importFile = shared.files[0];
	});
</script>

<h1 class="mb-4 text-2xl font-bold">Mazos</h1>

<form class="mb-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onsubmit={(e) => (e.preventDefault(), addDeck())}>
	<Field bind:value={newDeckName} placeholder="Nombre del mazo" />
	<Field bind:value={newDeckDesc} placeholder="Descripción (opcional)" />
	<Button type="submit">Crear</Button>
</form>

<div class="mb-6 flex flex-wrap gap-2">
	<label class="bg-surface inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 px-4 text-sm font-medium transition select-none hover:bg-slate-50 active:scale-[.98]">
		⇪ Importar (Anki .apkg, TSV, CSV)
		<input type="file" accept=".apkg,.tsv,.csv,.txt,text/csv,text/tab-separated-values" class="hidden" onchange={onImportPicked} />
	</label>
	<Button variant="secondary" onclick={findDups}>🔍 Buscar duplicados</Button>
</div>

{#if audioJob}
	<div class="mb-4 flex items-center gap-3 rounded-lg bg-sky-50 p-3 text-sm">
		<span class="flex-1">Generando audio… {audioJob.done}/{audioJob.total}</span>
		<Button variant="secondary" onclick={() => audioJob && (audioJob.cancel = true)}>Detener</Button>
	</div>
{/if}

<div class="space-y-3">
	{#each decks as deck (deck.id)}
		<div class="bg-surface rounded-xl border border-slate-200 shadow-sm">
			{#if editingDeckId === deck.id}
				<form class="grid gap-2 p-4 sm:grid-cols-2" onsubmit={(e) => (e.preventDefault(), saveDeck())}>
					<Field bind:value={deckForm.name} placeholder="Nombre del mazo" class="sm:col-span-2" />
					<Field bind:value={deckForm.description} placeholder="Descripción (opcional)" class="sm:col-span-2" />
					<Field label={`Nuevas por día (vacío = global: ${globalNewPerDay})`} bind:value={deckForm.newPerDay} inputmode="numeric" class="sm:col-span-2" />
					<div class="flex gap-2 sm:col-span-2">
						<Button type="submit">Guardar</Button>
						<Button variant="secondary" onclick={() => (editingDeckId = null)}>Cancelar</Button>
					</div>
				</form>
			{:else}
				<div class="flex items-center gap-1 p-2 pl-4">
					<button class="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 text-left" onclick={() => openCards(deck.id!)}>
						<span class="shrink-0 text-slate-400 transition-transform {openDeck === deck.id ? 'rotate-90' : ''}" aria-hidden="true">›</span>
						<span class="min-w-0">
							<span class="block truncate font-semibold">{deck.name}</span>
							{#if deck.description}<span class="block truncate text-sm text-slate-600">{deck.description}</span>{/if}
							<span class="block text-sm text-slate-500">{counts[deck.id!] ?? 0} tarjetas · {due[deck.id!] ?? 0} para hoy</span>
						</span>
					</button>
					{#if due[deck.id!]}
						<a href={`${base}/estudio?mazo=${deck.id}`} class="bg-brand text-brand-fg inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium">Estudiar</a>
					{/if}
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
						<Field bind:value={form.context} placeholder="Contexto / frase (habilita «Completar frase»)" class="sm:col-span-2" />
						<div class="flex items-center gap-3 sm:col-span-2">
							<Button variant="success" onclick={addCard}>Añadir tarjeta</Button>
							{#if form.front}<span class="text-lg"><Furigana text={form.front} /></span>{/if}
						</div>
					</div>

					<!-- Filtros -->
					<div class="mb-2 flex flex-wrap items-center gap-2">
						<Field bind:value={search} placeholder="Buscar…" class="min-w-40 flex-1" />
						<Select bind:value={filter}>
							<option value="all">Todas</option>
							<option value="leech">Se resisten (≥ {LEECH_LAPSES} fallos)</option>
							<option value="suspended">Suspendidas</option>
							<option value="image">Con imagen</option>
						</Select>
					</div>

					<!-- Listado -->
					<ul class="divide-y divide-slate-100">
						{#each shown as card (card.id)}
							{#if editingCardId === card.id}
								<li class="py-2">
									<form class="grid gap-2 sm:grid-cols-2" onsubmit={(e) => (e.preventDefault(), saveCard())}>
										<Field bind:value={cardForm.front} placeholder="Frente (japonés, ej. 私[わたし])" class="sm:col-span-2" />
										<Field bind:value={cardForm.back} placeholder="Reverso (significado)" />
										<Field bind:value={cardForm.reading} placeholder="Lectura (kana)" />
										<Field type="textarea" rows={2} bind:value={cardForm.context} placeholder="Contexto / frase" class="sm:col-span-2" />
										{#if card.imageId != null && !cardForm.dropImage}
											<div class="sm:col-span-2">
												{#if editImageUrl}
													<BoxEditor src={editImageUrl} items={boxItems} bind:selected={boxSelected} />
												{/if}
												<p class="mt-1 text-xs text-slate-500">Arrastra la caja o sus esquinas para ajustarla, o arrastra sobre la imagen para marcar la palabra de nuevo.</p>
												<div class="mt-1 flex gap-2">
													{#if boxItems[0]?.box}<Button variant="ghost" onclick={() => boxItems[0] && (boxItems[0].box = undefined)}>Quitar caja</Button>{/if}
													<Button variant="ghost" onclick={() => (cardForm.dropImage = true)}>Quitar imagen</Button>
												</div>
											</div>
										{/if}
										<fieldset class="sm:col-span-2">
											<legend class="mb-1 text-sm font-medium text-slate-700">Caras que se estudian</legend>
											<div class="flex flex-wrap gap-2">
												{#each formEligible as f (f)}
													<label class="flex min-h-9 items-center gap-2 rounded-full border border-slate-300 px-3 text-sm">
														<input
															type="checkbox"
															checked={f === 'recognition' || cardForm.facets.includes(f)}
															disabled={f === 'recognition'}
															onchange={() => toggleFacet(f)}
															class="accent-sky-600"
														/>
														{FACET_LABELS[f]}
													</label>
												{/each}
											</div>
											<p class="mt-1 text-xs text-slate-400">«Completar frase» requiere que el contexto contenga la palabra; «Imagen», una foto.</p>
										</fieldset>
										<div class="flex items-center gap-2 sm:col-span-2">
											<Button type="submit">Guardar</Button>
											<Button variant="secondary" onclick={() => (editingCardId = null)}>Cancelar</Button>
											{#if cardForm.front}<span class="text-lg"><Furigana text={cardForm.front} /></span>{/if}
										</div>
									</form>
								</li>
							{:else}
								<li class="flex items-center justify-between gap-2 py-2 {card.suspended ? 'opacity-50' : ''}">
									{#if card.imageId != null}
										<CardImage imageId={card.imageId} box={card.box} crop={!!card.box} class="w-14 shrink-0" />
									{/if}
									<div class="min-w-0 flex-1">
										<div class="truncate text-lg"><Furigana text={card.front} /></div>
										<div class="truncate text-sm text-slate-500">
											{card.back}
											{#if card.suspended}<span class="ml-1 text-xs">· suspendida</span>{/if}
											{#if (lapses[card.id!] ?? 0) >= LEECH_LAPSES}<span class="ml-1 text-xs text-amber-600">· se resiste</span>{/if}
											{#if card.audioBlob}<span class="ml-1 text-xs">· 🔊</span>{/if}
										</div>
									</div>
									<IconButton label="Opciones de la tarjeta" onclick={() => ((menuCard = card), (moveTarget = null))}>⋯</IconButton>
								</li>
							{/if}
						{:else}
							<li class="py-2 text-sm text-slate-400">{cards.length ? 'Ninguna coincide con el filtro.' : 'Sin tarjetas todavía.'}</li>
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
		<Button variant="secondary" size="lg" full onclick={() => (menuDeck && startEditDeck(menuDeck), (menuDeck = null))}>✏️ Editar mazo y cupo</Button>
		<Button variant="secondary" size="lg" full onclick={() => (menuDeck && exportDeck(menuDeck), (menuDeck = null))}>⇩ Exportar para Anki (TSV)</Button>
		{#if app.settings?.apiKey}
			<Button variant="secondary" size="lg" full disabled={!!audioJob} onclick={() => (menuDeck && deckAudio(menuDeck), (menuDeck = null))}
				>🔊 Generar audio natural{audioEstimate != null ? ` (≈ ${fmtUsd(audioEstimate)} c/u)` : ''}</Button
			>
		{/if}
		<Button variant="danger" size="lg" full onclick={() => ((deckToDelete = menuDeck), (menuDeck = null))}>🗑️ Borrar mazo</Button>
	</div>
</Sheet>

<!-- Menú de acciones de tarjeta -->
<Sheet open={menuCard !== null} onclose={() => (menuCard = null)}>
	{#if menuCard}
		{@const c = menuCard}
		<div class="flex flex-col gap-2">
			<Button variant="secondary" size="lg" full onclick={() => speakJapanese(c.front, c.audioBlob)}>♪ Escuchar</Button>
			<Button variant="secondary" size="lg" full onclick={() => (startEditCard(c), (menuCard = null))}>✏️ Editar tarjeta y caras</Button>
			<Button variant="secondary" size="lg" full onclick={() => (toggleSuspend(c), (menuCard = null))}>{c.suspended ? '▶ Reanudar' : '⏸ Suspender'}</Button>
			<Button variant="secondary" size="lg" full onclick={() => (pause(c), (menuCard = null))}>⏳ Pausar {PAUSE_DAYS} días</Button>
			{#if decks.length > 1}
				<div class="flex gap-2">
					<Select bind:value={moveTarget} class="flex-1">
						<option value={null}>Mover a…</option>
						{#each decks.filter((d) => d.id !== c.deckId) as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
					</Select>
					<Button variant="secondary" disabled={moveTarget === null} onclick={() => (moveTarget !== null && move(c, moveTarget), (menuCard = null))}>Mover</Button>
				</div>
			{/if}
			<Button variant="danger" size="lg" full onclick={() => (c.id != null && removeCard(c.id), (menuCard = null))}>🗑️ Borrar tarjeta</Button>
		</div>
	{/if}
</Sheet>

<!-- Duplicados -->
<Sheet open={dupGroups !== null} title="Tarjetas duplicadas" onclose={() => (dupGroups = null)}>
	<div class="max-h-[60vh] space-y-3 overflow-y-auto">
		{#each dupGroups ?? [] as group, gi (gi)}
			<div class="rounded-lg border border-slate-200 p-2">
				{#each group as c (c.id)}
					<div class="flex items-center gap-2 py-1">
						<div class="min-w-0 flex-1">
							<Furigana text={c.front} /> — <span class="text-sm text-slate-500">{c.back} · {decks.find((d) => d.id === c.deckId)?.name}</span>
						</div>
						<IconButton label="Borrar esta" variant="danger" onclick={() => removeDup(c)}>🗑</IconButton>
					</div>
				{/each}
			</div>
		{/each}
	</div>
</Sheet>

<ImportWizard bind:file={importFile} ondone={() => reloadDecks()} />

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
