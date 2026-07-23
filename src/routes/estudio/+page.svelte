<script lang="ts">
	import { onMount } from 'svelte';
	import { getDueCards, type DueCard } from '$lib/srs/queue';
	import { applyRating, previewIntervals, RATINGS, type RatingKey } from '$lib/srs/fsrs';
	import { getSetting } from '$lib/db/settings';
	import { db } from '$lib/db/schema';
	import { updateCard } from '$lib/db/cards';
	import { stripFurigana } from '$lib/furigana';
	import Furigana from '$lib/gui/Furigana.svelte';
	import RatingButtons from '$lib/gui/RatingButtons.svelte';
	import Button from '$lib/gui/Button.svelte';
	import IconButton from '$lib/gui/IconButton.svelte';
	import { speakJapanese } from '$lib/media/tts';
	import { explainGrammar } from '$lib/gemini/grammar';
	import type { GrammarBreakdown } from '$lib/gemini/schemas';
	import { GeminiError } from '$lib/gemini/client';
	import { app } from '$lib/state/app.svelte';

	let queue = $state<DueCard[]>([]);
	let index = $state(0);
	let revealed = $state(false);
	let loading = $state(true);
	let retention = $state(0.9);
	let reviewed = $state(0);
	// Furigana oculto por defecto; se alterna por tarjeta y se reinicia al pasar de tarjeta.
	let showFurigana = $state(false);

	let grammar = $state<GrammarBreakdown | null>(null);
	let grammarLoading = $state(false);
	// true = la versión en pantalla coincide con la guardada en la tarjeta (caché).
	let grammarSaved = $state(true);

	const current = $derived(queue[index]);
	const intervals = $derived(current ? previewIntervals(current.fsrs, Date.now(), retention) : null);
	const done = $derived(!loading && index >= queue.length);

	// Muestra la explicación cacheada (si existe) sin llamar a la IA.
	function loadCachedGrammar() {
		grammar = current?.card.grammar ?? null;
		grammarSaved = true;
	}

	// Genera/regenera con la IA; NO sobrescribe la caché de la tarjeta.
	async function generateGrammar() {
		if (!current) return;
		grammarLoading = true;
		try {
			const focus = {
				word: stripFurigana(current.card.front),
				reading: current.card.reading,
				meaning: current.card.back,
			};
			grammar = await explainGrammar(current.card.context || current.card.front, focus);
			grammarSaved = false;
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'Error', 'error');
		} finally {
			grammarLoading = false;
		}
	}

	// Al pulsar "Explicar gramática": usa la caché si existe, si no genera.
	function showGrammar() {
		if (current?.card.grammar) loadCachedGrammar();
		else generateGrammar();
	}

	// Persiste la versión en pantalla en la tarjeta.
	async function saveGrammar() {
		if (!current || !grammar || current.card.id == null) return;
		const savedAt = Date.now();
		try {
			await updateCard(current.card.id, { grammar, grammarSavedAt: savedAt });
		} catch {
			app.toast('No se pudo guardar la explicación', 'error');
			return;
		}
		current.card.grammar = grammar;
		current.card.grammarSavedAt = savedAt;
		grammarSaved = true;
		app.toast('Explicación guardada', 'success');
	}

	onMount(async () => {
		try {
			retention = await getSetting('requestRetention');
			queue = await getDueCards();
			if (queue.length) autoSpeak();
		} catch {
			app.toast('No se pudieron cargar las tarjetas', 'error');
		} finally {
			loading = false;
		}
	});

	function autoSpeak() {
		// El frente es japonés: se puede oír antes de revelar.
	}

	function reveal() {
		revealed = true;
		if (current) speakJapanese(current.card.front);
		// Muestra la explicación cacheada automáticamente si la tarjeta la tiene.
		loadCachedGrammar();
	}

	async function rate(key: RatingKey) {
		if (!current) return;
		const now = Date.now();
		const { next, log } = applyRating(current.fsrs, RATINGS[key], now, retention);
		try {
			await db.transaction('rw', db.fsrsData, db.reviewLogs, async () => {
				await db.fsrsData.put(next);
				await db.reviewLogs.add(log);
			});
		} catch {
			app.toast('No se pudo guardar el repaso. Revisa el almacenamiento del navegador.', 'error');
			return;
		}
		reviewed++;
		revealed = false;
		grammar = null;
		grammarSaved = true;
		showFurigana = false;
		index++;
	}
</script>

<h1 class="mb-4 text-2xl font-bold">Estudio</h1>

{#if loading}
	<p class="text-slate-400">Cargando…</p>
{:else if done}
	<div class="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
		<div class="text-4xl">✓</div>
		<p class="mt-2 font-semibold">¡Sesión completa!</p>
		<p class="text-sm text-slate-500">{reviewed} tarjetas repasadas.</p>
	</div>
{:else if current}
	<!-- Contenido scrolleable; deja hueco abajo para la barra de acción fija -->
	<div class="pb-44">
		<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
			<span class="text-sm text-slate-400">{index + 1} / {queue.length}</span>
			<button
				class="min-h-9 rounded-full border px-4 text-sm font-medium transition select-none active:scale-95 {showFurigana
					? 'border-slate-900 bg-slate-900 text-white'
					: 'border-slate-300 text-slate-600 hover:bg-slate-100'}"
				onclick={() => (showFurigana = !showFurigana)}
			>
				{showFurigana ? 'あ Furigana visible' : 'あ Furigana oculto'}
			</button>
		</div>

		<!-- Tarjeta: si no está revelada, tocarla muestra la respuesta -->
		<div class="relative rounded-2xl border border-slate-200 bg-white shadow-sm">
			<div class="absolute top-2 right-2 z-10">
				<IconButton label="Escuchar" onclick={() => speakJapanese(current.card.front)}>♪</IconButton>
			</div>

			{#if !revealed}
				<button type="button" class="flex w-full flex-col items-center rounded-2xl p-5 text-center transition select-none active:bg-slate-50 sm:p-8" onclick={reveal}>
					<span class="text-2xl leading-relaxed sm:text-3xl"><Furigana text={current.card.front} showReadings={showFurigana} /></span>
					<span class="mt-4 text-sm text-slate-400">Toca para ver la respuesta</span>
				</button>
			{:else}
				<div class="p-5 text-center sm:p-8">
					<div class="text-2xl leading-relaxed sm:text-3xl"><Furigana text={current.card.front} showReadings={showFurigana} /></div>
					<hr class="my-5 border-slate-200" />
					<div class="text-xl font-medium">{current.card.back}</div>
					{#if current.card.reading}
						<div class="mt-1 text-slate-500">{current.card.reading}</div>
					{/if}
					{#if current.card.context}
						<div class="mt-3 text-sm text-slate-500"><Furigana text={current.card.context} showReadings={showFurigana} /></div>
					{/if}

					<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
						{#if grammar}
							<Button variant="ghost" loading={grammarLoading} onclick={generateGrammar}>🔄 Regenerar</Button>
							{#if !grammarSaved}
								<Button variant="ghost" loading={grammarLoading} onclick={saveGrammar}>💾 Guardar versión</Button>
							{/if}
						{:else}
							<Button variant="ghost" loading={grammarLoading} onclick={showGrammar}>📖 Explicar gramática</Button>
						{/if}
					</div>

					{#if grammar}
						<div class="mt-3 rounded-lg bg-slate-50 p-3 text-left text-sm">
							<p class="mb-2 font-medium text-slate-700">{grammar.summary}</p>
							{#if grammar.focusNote}
								<p class="mb-2 rounded bg-sky-50 p-2 text-slate-700">{grammar.focusNote}</p>
							{/if}
							<ul class="space-y-1">
								{#each grammar.tokens as tok, i (i)}
									<li>
										<span class="font-semibold">{tok.surface}</span>
										<span class="text-slate-400">({tok.role})</span> — {tok.note}
									</li>
								{/each}
							</ul>
							{#if !grammarSaved}
								<p class="mt-2 text-xs text-amber-600">Versión nueva sin guardar.</p>
							{:else if current.card.grammarSavedAt}
								<p class="mt-2 text-xs text-slate-400">Versión guardada.</p>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Zona de acción fija al alcance del pulgar -->
	<div class="bottom-nav pointer-events-none fixed inset-x-0 z-30 px-4 sm:static sm:mt-5 sm:px-0">
		<div class="pointer-events-auto mx-auto max-w-3xl">
			{#if !revealed}
				<Button size="lg" full onclick={reveal}>Mostrar respuesta</Button>
			{:else if intervals}
				<RatingButtons {intervals} onrate={rate} />
			{/if}
		</div>
	</div>
{:else}
	<div class="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">No hay tarjetas por repasar. ¡Vuelve más tarde!</div>
{/if}
