<script lang="ts">
	// Importar tarjetas desde Anki (.apkg), TSV o CSV: mapear columnas, previsualizar y detectar duplicados.
	import Sheet from './Sheet.svelte';
	import Button from './Button.svelte';
	import Select from './Select.svelte';
	import Field from './Field.svelte';
	import Furigana from './Furigana.svelte';
	import { apkgToTable, guessColumns, mapRows, parseTable, readApkg, type ColumnMap, type ParsedTable } from '$lib/anki';
	import { createCards, findDuplicates, type NewCard } from '$lib/db/cards';
	import { addImage } from '$lib/db/images';
	import { createDeck, listDecks } from '$lib/db/decks';
	import type { Deck } from '$lib/db/schema';
	import { compressImage } from '$lib/media/image';
	import { app } from '$lib/state/app.svelte';

	let { file = $bindable(null), ondone }: { file: File | null; ondone: () => void } = $props();

	let table = $state<ParsedTable | null>(null);
	let images = $state<Blob[][]>([]);
	let map = $state<ColumnMap>({ front: 0, back: 1, reading: null, context: null });
	let decks = $state<Deck[]>([]);
	let deckId = $state<number | null>(null);
	let newDeckName = $state('');
	let skipDups = $state(true);
	let dupCount = $state(0);
	let busy = $state(false);
	let error = $state('');

	const open = $derived(file !== null);
	const rows = $derived(table ? mapRows(table, map) : []);
	const columns = $derived(table ? Math.max(0, ...table.rows.slice(0, 50).map((r) => r.length)) : 0);
	const colName = (i: number) => table?.header?.[i] || `Columna ${i + 1}`;

	$effect(() => {
		const f = file;
		if (f) void load(f);
	});

	$effect(() => {
		const rs = rows;
		void countDups(rs.map((r) => r.front));
	});

	async function countDups(fronts: string[]) {
		let n = 0;
		for (const f of fronts.slice(0, 2000)) if ((await findDuplicates(f)).length) n++;
		dupCount = n;
	}

	async function load(f: File) {
		error = '';
		table = null;
		busy = true;
		try {
			decks = await listDecks();
			if (f.name.toLowerCase().endsWith('.apkg')) {
				const notes = await readApkg(f);
				table = apkgToTable(notes);
				images = notes.map((n) => n.images);
			} else {
				table = parseTable(await f.text(), f.name);
				images = [];
			}
			map = guessColumns(table);
			newDeckName = table.deck ?? f.name.replace(/\.(apkg|tsv|csv|txt)$/i, '');
			deckId = decks.find((d) => d.name === newDeckName)?.id ?? null;
		} catch (e) {
			error = e instanceof Error ? e.message : 'No se pudo leer el archivo.';
		} finally {
			busy = false;
		}
	}

	async function run() {
		if (!table || !rows.length) return;
		busy = true;
		try {
			const target = deckId ?? (await createDeck(newDeckName.trim() || 'Importado'));
			const payload: NewCard[] = [];
			let skipped = 0;
			// Filas válidas con su índice original (para asociar imágenes del .apkg).
			const valid = table.rows.map((r, i) => ({ r, i })).filter(({ r }) => r[map.front]?.trim() && r[map.back]?.trim());
			for (const { r, i } of valid) {
				const front = r[map.front].trim();
				if (skipDups && (await findDuplicates(front)).length) {
					skipped++;
					continue;
				}
				let imageId: number | undefined;
				const img = images[i]?.[0];
				if (img) {
					try {
						imageId = await addImage((await compressImage(img)).blob);
					} catch {
						imageId = undefined;
					}
				}
				payload.push({
					deckId: target,
					front,
					back: r[map.back].trim(),
					reading: map.reading != null ? r[map.reading]?.trim() || undefined : undefined,
					context: map.context != null ? r[map.context]?.trim() || undefined : undefined,
					imageId,
				});
			}
			await createCards(payload);
			app.toast(`${payload.length} tarjetas importadas${skipped ? ` · ${skipped} duplicadas omitidas` : ''}`, 'success');
			file = null;
			ondone();
		} catch (e) {
			app.error(e, 'No se pudo importar');
		} finally {
			busy = false;
		}
	}
</script>

<Sheet {open} title="Importar tarjetas" onclose={() => (file = null)}>
	<div class="max-h-[70vh] overflow-y-auto">
		{#if busy && !table}
			<p class="text-slate-500">Leyendo {file?.name}…</p>
		{:else if error}
			<p class="text-red-600">{error}</p>
		{:else if table}
			<p class="mb-3 text-sm text-slate-500">{file?.name}: {table.rows.length} filas.</p>
			<div class="grid grid-cols-2 gap-2">
				{#each [['front', 'Frente (japonés)'], ['back', 'Significado'], ['reading', 'Lectura'], ['context', 'Contexto']] as [k, label] (k)}
					<Select
						{label}
						value={map[k as keyof ColumnMap] ?? -1}
						onchange={(e) => {
							const v = Number((e.currentTarget as HTMLSelectElement).value);
							if (k === 'front' || k === 'back') map[k] = Math.max(0, v);
							else if (k === 'reading' || k === 'context') map[k] = v < 0 ? null : v;
						}}
					>
						{#if k === 'reading' || k === 'context'}<option value={-1}>(ninguna)</option>{/if}
						{#each Array(columns) as _, i (i)}
							<option value={i}>{colName(i)}</option>
						{/each}
					</Select>
				{/each}
			</div>

			<div class="mt-3">
				<Select label="Mazo" bind:value={deckId}>
					<option value={null}>+ Nuevo mazo</option>
					{#each decks as d (d.id)}<option value={d.id}>{d.name}</option>{/each}
				</Select>
				{#if deckId === null}<Field bind:value={newDeckName} placeholder="Nombre del mazo nuevo" class="mt-2" />{/if}
			</div>

			<label class="mt-3 flex items-center gap-2 text-sm text-slate-600">
				<input type="checkbox" bind:checked={skipDups} class="size-5 accent-sky-600" /> Omitir duplicadas ({dupCount} ya existen)
			</label>

			<h3 class="mt-3 mb-1 text-sm font-semibold">Vista previa</h3>
			<ul class="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
				{#each rows.slice(0, 5) as r, i (i)}
					<li class="p-2">
						<Furigana text={r.front} /> — {r.back}{#if r.reading}<span class="text-slate-400"> · {r.reading}</span>{/if}
					</li>
				{/each}
			</ul>
			<div class="mt-4 flex flex-col gap-2">
				<Button variant="success" size="lg" full loading={busy} disabled={!rows.length} onclick={run}>Importar {rows.length} tarjetas</Button>
				<Button variant="secondary" size="lg" full onclick={() => (file = null)}>Cancelar</Button>
			</div>
		{/if}
	</div>
</Sheet>
