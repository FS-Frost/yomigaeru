<script lang="ts">
	// Revisión de propuestas de la IA (texto, palabra o foto). Vista compacta: una fila por tarjeta
	// (marcar, ver frente y significado); al tocarla se despliega para editar, resolver duplicados y,
	// si hay foto, ajustar su caja. El guardado lo hace la página.
	import Furigana from './Furigana.svelte';
	import Field from './Field.svelte';
	import Button from './Button.svelte';
	import Select from './Select.svelte';
	import BoxEditor from './BoxEditor.svelte';
	import { refreshDups, type Proposal } from '$lib/proposals';
	import { orderedProposals } from '$lib/create';
	import { speakJapanese } from '$lib/media/tts';

	let {
		cards = $bindable(),
		imageUrl = null,
		dupsLast = false,
		hideDups = false,
		autoExpand = false,
	}: {
		cards: Proposal[];
		/** Foto de origen, para ver y ajustar las cajas. */
		imageUrl?: string | null;
		dupsLast?: boolean;
		hideDups?: boolean;
		/** Abrir la primera tarjeta (p. ej. una sola palabra). */
		autoExpand?: boolean;
	} = $props();

	let open = $state<number | null>(null);
	let showImage = $state(true);
	$effect(() => {
		if (autoExpand && cards.length === 1 && open === null) open = 0;
	});

	const list = $derived(orderedProposals(cards, dupsLast).filter((x) => !(hideDups && x.p.dups.length)));
</script>

{#if imageUrl && showImage}
	<div class="mb-2">
		<BoxEditor src={imageUrl} items={cards} bind:selected={open} class="w-full" />
		<p class="mt-1 text-xs text-slate-500">Toca una caja para elegir su tarjeta y arrástrala o arrastra sus esquinas; con una tarjeta abierta, arrastra sobre la foto para marcarla de nuevo.</p>
	</div>
{/if}
{#if imageUrl}
	<button class="mb-2 min-h-9 text-xs text-slate-500 underline" onclick={() => (showImage = !showImage)}>{showImage ? 'Ocultar la foto' : 'Ver la foto con las cajas'}</button>
{/if}

<ul class="space-y-2">
	{#each list as { p: card, i } (i)}
		<li
			class="bg-surface overflow-hidden rounded-xl border transition {open === i ? 'border-amber-300 ring-2 ring-amber-200' : card.keep ? 'border-sky-300' : 'border-slate-200'} {card.keep
				? ''
				: 'opacity-70'}"
		>
			<div class="flex items-center gap-1">
				<label class="flex size-12 shrink-0 cursor-pointer items-center justify-center">
					<input type="checkbox" bind:checked={card.keep} class="size-5 accent-sky-600" aria-label={`Guardar ${card.front}`} />
				</label>
				<button class="flex min-h-12 min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left" aria-expanded={open === i} onclick={() => (open = open === i ? null : i)}>
					<span class="min-w-0 flex-1">
						<span class="block truncate text-lg leading-tight"><Furigana text={card.front} /></span>
						<span class="block truncate text-sm text-slate-500">{card.back}</span>
					</span>
					{#if card.dups.length}<span class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">ya existe</span>{/if}
					{#if imageUrl && !card.box}<span class="shrink-0 text-xs text-slate-400" title="Sin caja en la foto">▢?</span>{/if}
					<span class="shrink-0 text-slate-400 transition {open === i ? 'rotate-180' : ''}" aria-hidden="true">⌄</span>
				</button>
			</div>

			{#if open === i}
				<div class="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2">
					{#if card.dups.length}
						<div class="rounded-lg bg-amber-50 p-2 text-sm text-amber-700 sm:col-span-2">
							Ya tienes: <Furigana text={card.dups[0].front} /> — {card.dups[0].back}
							<Select bind:value={card.dupAction} class="mt-2" onchange={() => (card.keep = card.dupAction !== 'skip')}>
								<option value="skip">Descartar esta</option>
								<option value="merge">Añadir su contexto a la existente</option>
								<option value="create">Guardar igualmente (duplicada)</option>
							</Select>
						</div>
					{/if}
					<Field label="Frente" bind:value={card.front} class="sm:col-span-2" onchange={() => refreshDups(card)} />
					<Field label="Significado" bind:value={card.back} />
					<Field label="Lectura" bind:value={card.reading} />
					<Field label="Contexto" type="textarea" rows={2} bind:value={card.context} class="sm:col-span-2" />
					{#if card.examples.length}
						<ul class="space-y-1 text-sm text-slate-600 sm:col-span-2">
							{#each card.examples as ex, j (j)}
								<li><Furigana text={ex.jp} /> — {ex.es}</li>
							{/each}
						</ul>
					{/if}
					<div class="flex flex-wrap items-center gap-2 sm:col-span-2">
						<Button variant="ghost" onclick={() => speakJapanese(card.front)}>♪ Escuchar</Button>
						{#if imageUrl}
							{#if card.box}
								<Button variant="ghost" onclick={() => (card.box = undefined)}>Quitar caja</Button>
							{:else}
								<span class="text-xs text-amber-600">Sin caja: arrastra sobre la foto para marcar la palabra.</span>
							{/if}
						{/if}
					</div>
				</div>
			{/if}
		</li>
	{/each}
</ul>
