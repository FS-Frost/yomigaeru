<script lang="ts">
	// Revisión de tarjetas propuestas por la IA (foto o texto): editar, marcar, duplicados,
	// cajas sobre la imagen y refinado con instrucciones. El guardado lo hace la página.
	import Furigana from './Furigana.svelte';
	import Field from './Field.svelte';
	import Button from './Button.svelte';
	import Select from './Select.svelte';
	import BoxEditor from './BoxEditor.svelte';
	import { refreshDups, type Proposal } from '$lib/proposals';

	let {
		cards = $bindable(),
		imageUrl = null,
		loading = false,
		onrefine,
		onretry,
	}: {
		cards: Proposal[];
		/** Vista previa de la imagen, para dibujar las cajas. */
		imageUrl?: string | null;
		loading?: boolean;
		onrefine: (instruction: string) => void;
		onretry: () => void;
	} = $props();

	let instruction = $state('');
	let focused = $state<number | null>(null);
</script>

{#if imageUrl}
	<div class="mt-4">
		<BoxEditor src={imageUrl} items={cards} bind:selected={focused} />
		<p class="mt-1 text-xs text-slate-500">
			Elige una tarjeta (abajo o tocando su caja) y arrastra la caja para moverla, sus esquinas para ajustarla, o arrastra sobre la imagen para marcarla de nuevo. Flechas: mover fino.
		</p>
	</div>
{/if}

<div class="mt-4 space-y-3">
	{#each cards as card, i (i)}
		<div
			class="bg-surface block rounded-lg border p-3 transition {card.keep ? 'border-sky-400 ring-1 ring-sky-200' : 'border-slate-200'} {focused === i ? 'ring-2 ring-amber-300' : ''}"
			role="group"
			onfocusin={() => (focused = i)}
		>
			<div class="flex items-start gap-3">
				<input type="checkbox" bind:checked={card.keep} class="mt-1 size-5 shrink-0 accent-sky-600" aria-label={`Guardar ${card.front}`} />
				<div class="grid flex-1 gap-2 sm:grid-cols-2">
					<div class="text-lg sm:col-span-2"><Furigana text={card.front} /></div>
					{#if card.dups.length}
						<div class="rounded-md bg-amber-50 p-2 text-sm text-amber-700 sm:col-span-2">
							Ya existe: <Furigana text={card.dups[0].front} /> — {card.dups[0].back}
							<Select bind:value={card.dupAction} class="mt-2">
								<option value="skip">Descartar esta</option>
								<option value="merge">Fusionar el contexto en la existente</option>
								<option value="create">Guardar igualmente (duplicada)</option>
							</Select>
						</div>
					{/if}
					<Field bind:value={card.front} placeholder="Frente (japonés, ej. 私[わたし])" class="sm:col-span-2" onchange={() => refreshDups(card)} />
					<Field bind:value={card.back} placeholder="Significado" />
					<Field bind:value={card.reading} placeholder="Lectura (kana)" />
					<Field bind:value={card.context} placeholder="Contexto (frase original)" class="sm:col-span-2" />
					{#if imageUrl}
						<div class="flex flex-wrap items-center gap-2 text-sm sm:col-span-2">
							<Button variant={focused === i ? 'primary' : 'secondary'} onclick={() => (focused = i)}>
								{card.box ? '▢ Ajustar caja' : '▢ Marcar en la imagen'}
							</Button>
							{#if card.box}
								<Button variant="ghost" onclick={() => (card.box = undefined)}>Quitar caja</Button>
							{/if}
							{#if focused === i}<span class="text-xs text-amber-600">{card.box ? 'Arrastra la caja o sus esquinas.' : 'Arrastra sobre la imagen para marcar la palabra.'}</span>{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	{/each}

	<div class="rounded-lg border border-slate-200 bg-slate-50 p-3">
		<Field type="textarea" rows={2} bind:value={instruction} placeholder="Instrucciones para la IA (ej. 'solo verbos', 'corrige las lecturas', 'añade más ejemplos')" />
		<div class="mt-2 flex flex-wrap gap-2">
			<Button
				variant="secondary"
				{loading}
				onclick={() => {
					onrefine(instruction);
					instruction = '';
				}}>Refinar con IA</Button
			>
			<Button variant="secondary" disabled={loading} onclick={onretry}>Extraer de nuevo</Button>
		</div>
	</div>
</div>
