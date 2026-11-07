<script lang="ts">
	// Selector de modelo de Gemini: recomendados como tarjetas (etiqueta, nota, precio), «Ver todos»
	// con la lista real de la key y «Personalizado…» para escribir uno.
	import { modelOptions, type ModelKind, type ModelOption } from '$lib/gemini/models';
	import { priceFor, type Price } from '$lib/gemini/pricing';

	let {
		kind,
		value,
		listed = null,
		customPrices = {},
		busy = false,
		onpick,
		onloadall,
	}: {
		kind: ModelKind;
		value: string;
		/** Modelos de la API (null = no cargados). */
		listed?: ModelOption[] | null;
		customPrices?: Record<string, Price>;
		busy?: boolean;
		onpick: (id: string) => void;
		onloadall: () => void;
	} = $props();

	let showAll = $state(false);
	let custom = $state('');
	const opts = $derived(modelOptions(kind, value, listed));
	const curated = $derived(opts.filter((o) => o.group === 'curated'));
	const others = $derived(opts.filter((o) => o.group !== 'curated'));

	function price(id: string): string {
		const p = priceFor(id, customPrices);
		return p ? `$${p.input} / $${p.output}` : 'sin precio';
	}
</script>

<div class="space-y-2" role="radiogroup" aria-label={kind === 'text' ? 'Modelo de texto' : 'Modelo de voz'}>
	{#each curated as o (o.id)}
		{@const on = o.id === value}
		<button
			role="radio"
			aria-checked={on}
			disabled={busy}
			class="flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition disabled:opacity-60 {on
				? 'border-sky-500 bg-sky-50 ring-1 ring-sky-300'
				: 'bg-surface border-slate-200 hover:bg-slate-50'}"
			onclick={() => onpick(o.id)}
		>
			<span class="flex size-5 shrink-0 items-center justify-center rounded-full border-2 {on ? 'border-sky-600' : 'border-slate-300'}">
				{#if on}<span class="size-2.5 rounded-full bg-sky-600"></span>{/if}
			</span>
			<span class="min-w-0 flex-1">
				<span class="flex flex-wrap items-center gap-x-2">
					<span class="font-medium">{o.tag}</span>
					<span class="font-mono text-xs text-slate-500">{o.id}</span>
				</span>
				<span class="block text-xs text-slate-500">{o.note} · {price(o.id)} por millón de tokens</span>
			</span>
		</button>
	{/each}

	{#if others.some((o) => o.id === value)}
		{@const cur = others.find((o) => o.id === value)!}
		<div class="flex min-h-12 items-center gap-3 rounded-xl border border-sky-500 bg-sky-50 px-3 py-2 text-sm">
			<span class="size-2.5 rounded-full bg-sky-600"></span>
			<span class="min-w-0 flex-1 font-mono">{cur.id}</span>
			{#if cur.tag}<span class="text-xs {cur.tag === 'no disponible' ? 'text-red-600' : 'text-slate-500'}">{cur.tag}</span>{/if}
			<span class="text-xs text-slate-500">{price(cur.id)}</span>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-2 pt-1 text-sm">
		<button
			class="min-h-10 rounded-lg px-2 text-sky-700 hover:bg-sky-50"
			disabled={busy}
			onclick={() => {
				showAll = !showAll;
				if (showAll && !listed) onloadall();
			}}>{showAll ? 'Ocultar otros modelos' : 'Ver todos los modelos'}</button
		>
	</div>

	{#if showAll}
		<div class="rounded-xl border border-slate-200 p-3">
			{#if !listed}
				<p class="text-sm text-slate-500">Cargando la lista de tu key…</p>
			{:else}
				<label class="block text-sm text-slate-600">
					Disponibles para tu key
					<select
						class="bg-surface mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-2 font-mono text-base"
						value={opts.some((o) => o.id === value) ? value : ''}
						disabled={busy}
						onchange={(e) => (e.currentTarget as HTMLSelectElement).value && onpick((e.currentTarget as HTMLSelectElement).value)}
					>
						{#each opts as o (o.id)}
							<option value={o.id}>{o.id}{o.tag ? ` — ${o.tag}` : ''}</option>
						{/each}
					</select>
				</label>
			{/if}
			<form
				class="mt-3 flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					if (custom.trim()) onpick(custom.trim());
				}}
			>
				<input bind:value={custom} placeholder="Personalizado: gemini-…" class="bg-surface min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 font-mono text-base" />
				<button class="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium" disabled={busy || !custom.trim()}>Usar</button>
			</form>
		</div>
	{/if}
</div>
