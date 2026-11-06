<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { getSession, type DueItem, type QueueSummary } from '$lib/srs/queue';
	import { quotaMessage } from '$lib/srs/quota';
	import { applyRating, previewIntervals, RATINGS, type RatingKey, type SchedulerConfig } from '$lib/srs/fsrs';
	import { buildCloze } from '$lib/srs/facets';
	import { answerKind, buildOptions } from '$lib/srs/options';
	import { LEECH_LAPSES, PAUSE_DAYS } from '$lib/srs/constants';
	import { getAllSettings, setSetting, type AnswerStyle } from '$lib/db/settings';
	import { db, type AnswerVia, type Card, type Schedule } from '$lib/db/schema';
	import { pauseCard, setSuspended, updateCard } from '$lib/db/cards';
	import { japaneseMatches, meaningMatches, readingMatches } from '$lib/jp';
	import Furigana from '$lib/gui/Furigana.svelte';
	import RatingButtons from '$lib/gui/RatingButtons.svelte';
	import Button from '$lib/gui/Button.svelte';
	import IconButton from '$lib/gui/IconButton.svelte';
	import CardImage from '$lib/gui/CardImage.svelte';
	import AnswerInput from '$lib/gui/AnswerInput.svelte';
	import { speakJapanese, speakMixed, stopSpeaking } from '$lib/media/tts';
	import { explainGrammar } from '$lib/gemini/grammar';
	import { judgeAnswer } from '$lib/gemini/judge';
	import { synthesizeJapanese } from '$lib/gemini/tts';
	import type { GrammarBreakdown, Judgement } from '$lib/gemini/schemas';
	import { GeminiError } from '$lib/gemini/client';
	import { app } from '$lib/state/app.svelte';

	// --- Sesión ---
	let queue = $state<DueItem[]>([]);
	let index = $state(0);
	let loading = $state(true);
	let reviewed = $state(0);
	let summary = $state<QueueSummary | null>(null);
	let cfg = $state<SchedulerConfig>({ requestRetention: 0.9 });
	let style = $state<AnswerStyle>('reveal');
	let hasKey = $state(false);
	/** Todas las tarjetas (para distractores de opción múltiple). */
	let pool: Card[] = [];
	const deckId = $derived(page.url.searchParams.get('mazo') ? Number(page.url.searchParams.get('mazo')) : undefined);

	// --- Pregunta actual ---
	type Phase = 'question' | 'judging' | 'answered';
	let phase = $state<Phase>('question');
	let answer = $state('');
	let via = $state<AnswerVia>('reveal');
	/** null = sin corrección (revelar). */
	let correct = $state<boolean | null>(null);
	let suggested = $state<RatingKey | null>(null);
	let judgement = $state<Judgement | null>(null);
	let options = $state<Card[] | null>(null);
	let shownAt = Date.now();
	let showFurigana = $state(false);

	// --- Gramática ---
	let grammar = $state<GrammarBreakdown | null>(null);
	let grammarLoading = $state(false);
	let grammarSaved = $state(true);
	let audioLoading = $state(false);

	// --- Deshacer (última calificación) ---
	let undo = $state.raw<{ prev: Schedule; logId: number; index: number; requeued: boolean } | null>(null);

	const current = $derived(queue[index]);
	const card = $derived(current?.card);
	const facet = $derived(current?.schedule.facet ?? 'recognition');
	const kind = $derived(answerKind(facet));
	const cloze = $derived(card && facet === 'cloze' ? buildCloze(card) : null);
	const intervals = $derived(current ? previewIntervals(current.schedule, cfg) : null);
	const done = $derived(!loading && index >= queue.length);
	const isNew = $derived(current?.schedule.state === 0);
	/** Modo efectivo de esta pregunta. La cara de producción se escribe (o se elige). */
	const mode = $derived<AnswerStyle>(style === 'choice' && options ? 'choice' : style === 'reveal' && facet !== 'production' ? 'reveal' : 'typed');

	onMount(() => {
		void load();
		return () => stopSpeaking();
	});

	async function load() {
		loading = true;
		try {
			const st = await getAllSettings();
			cfg = { requestRetention: st.requestRetention, params: st.fsrsParams };
			style = st.answerStyle;
			hasKey = !!st.apiKey;
			const s = await getSession(Date.now(), deckId);
			queue = s.items;
			summary = s.summary;
			index = 0;
			pool = await db.cards.toArray();
			prepare();
		} catch {
			app.toast('No se pudieron cargar las tarjetas', 'error');
		} finally {
			loading = false;
		}
	}

	/** Reinicia el estado de la pregunta al pasar a otra tarjeta. */
	function prepare() {
		phase = 'question';
		answer = '';
		via = 'reveal';
		correct = null;
		suggested = null;
		judgement = null;
		grammar = null;
		grammarSaved = true;
		showFurigana = false;
		shownAt = Date.now();
		const it = queue[index];
		options = it && style === 'choice' ? buildOptions(it.card, it.schedule.facet, pool) : null;
	}

	async function changeStyle(s: AnswerStyle) {
		style = s;
		if (phase === 'question') {
			const it = queue[index];
			options = it && s === 'choice' ? buildOptions(it.card, it.schedule.facet, pool) : null;
		}
		try {
			await setSetting('answerStyle', s);
		} catch {
			app.toast('No se pudo guardar el modo de respuesta', 'error');
		}
	}

	// --- Responder ---

	function finishQuestion() {
		phase = 'answered';
		if (card) void speakJapanese(card.front, card.audioBlob);
		grammar = card?.grammar ?? null;
		grammarSaved = true;
	}

	function reveal() {
		if (phase !== 'question') return;
		via = 'reveal';
		finishQuestion();
	}

	/** ¿La respuesta escrita es correcta? (local, sin IA) */
	function checkLocal(a: string, c: Card): boolean {
		if (kind === 'meaning') return meaningMatches(a, [c.back]) || (!!c.reading && readingMatches(a, [c.reading])) || japaneseMatches(a, c.front, c.reading);
		return japaneseMatches(a, c.front, c.reading);
	}

	async function submitTyped() {
		if (phase !== 'question' || !card) return;
		const a = answer.trim();
		if (!a) return;
		via = 'typed';
		if (checkLocal(a, card)) {
			correct = true;
			suggested = 'good';
			finishQuestion();
			return;
		}
		// Producción/cloze en japonés: el juez IA evalúa alternativas y errores parciales.
		if (kind === 'word' && hasKey) {
			phase = 'judging';
			try {
				const j = await judgeAnswer(card, a);
				judgement = j;
				via = 'judge';
				correct = j.verdict !== 'wrong';
				suggested = (['again', 'hard', 'good', 'easy'] as RatingKey[])[j.suggestedRating - 1] ?? null;
			} catch (err) {
				app.toast(err instanceof GeminiError ? err.message : 'El juez no respondió', 'error', { detail: 'Se corrige sin IA.' });
				correct = false;
				suggested = 'again';
			}
			finishQuestion();
			return;
		}
		correct = false;
		suggested = 'again';
		finishQuestion();
	}

	function choose(i: number) {
		if (phase !== 'question' || !options || !card) return;
		via = 'choice';
		correct = options[i].id === card.id;
		suggested = correct ? 'good' : 'again';
		finishQuestion();
	}

	/** Respuesta escrita marcada incorrecta pero válida (sinónimo, etc.). */
	function countAsCorrect() {
		correct = true;
		suggested = 'good';
	}

	// --- Calificar ---

	async function rate(key: RatingKey) {
		if (!current || phase !== 'answered') return;
		// Elegir entre opciones es reconocer, no recordar: como mucho «Bien».
		if (via === 'choice' && key === 'easy') key = 'good';
		const now = Date.now();
		const prev = $state.snapshot(current.schedule) as Schedule;
		const { next, log } = applyRating(prev, RATINGS[key], cfg, { now, via, durationMs: now - shownAt });
		let logId: number;
		try {
			logId = await db.transaction('rw', db.schedules, db.reviewLogs, async () => {
				await db.schedules.put(next);
				return (await db.reviewLogs.add(log)) as number;
			});
		} catch {
			app.toast('No se pudo guardar el repaso. Revisa el almacenamiento del navegador.', 'error');
			return;
		}
		// Pasos de aprendizaje cortos: vuelve a salir en esta misma sesión.
		const requeued = next.due - now < 30 * 60_000;
		if (requeued) queue.push({ card: current.card, schedule: next, cardId: current.cardId });
		undo = { prev, logId, index, requeued };
		if (key === 'again' && next.lapses >= LEECH_LAPSES && prev.lapses < LEECH_LAPSES) leechWarning(current.card);
		reviewed++;
		index++;
		prepare();
	}

	async function undoLast() {
		if (!undo) return;
		const u = undo;
		undo = null;
		try {
			await db.transaction('rw', db.schedules, db.reviewLogs, async () => {
				await db.schedules.put(u.prev);
				await db.reviewLogs.delete(u.logId);
			});
		} catch {
			app.toast('No se pudo deshacer', 'error');
			return;
		}
		if (u.requeued) queue.pop();
		index = u.index;
		queue[index] = { ...queue[index], schedule: u.prev };
		reviewed = Math.max(0, reviewed - 1);
		prepare();
		app.toast('Calificación deshecha', 'info', { key: 'undo' });
	}

	function leechWarning(c: Card) {
		app.toast('Esta tarjeta se te resiste', 'warn', {
			detail: `Has fallado ${LEECH_LAPSES} veces o más. Prueba a editarla, pausarla o pedir una explicación.`,
			duration: 12000,
			actions: [
				{ label: `Pausar ${PAUSE_DAYS} d`, run: () => void pause(c) },
				{ label: 'Suspender', run: () => void suspend(c) },
			],
		});
	}

	/** Quita de la sesión las caras pendientes de una tarjeta (tras pausar/suspender). */
	function dropFromSession(cardId: number) {
		const before = queue.slice(0, index);
		const after = queue.slice(index).filter((x) => x.cardId !== cardId);
		queue = [...before, ...after];
		prepare();
	}

	async function pause(c: Card) {
		try {
			await pauseCard(c.id!, PAUSE_DAYS);
			dropFromSession(c.id!);
			app.toast(`Pausada ${PAUSE_DAYS} días`, 'success');
		} catch {
			app.toast('No se pudo pausar', 'error');
		}
	}

	async function suspend(c: Card) {
		try {
			await setSuspended(c.id!, true);
			dropFromSession(c.id!);
			app.toast('Tarjeta suspendida', 'success', { action: { label: 'Deshacer', run: () => void setSuspended(c.id!, false) } });
		} catch {
			app.toast('No se pudo suspender', 'error');
		}
	}

	// --- Gramática (caché por tarjeta) ---

	async function generateGrammar() {
		if (!card) return;
		grammarLoading = true;
		try {
			grammar = await explainGrammar(card.context || card.front, { word: card.front, reading: card.reading, meaning: card.back });
			grammarSaved = false;
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'Error', 'error', { action: { label: 'Reintentar', run: () => void generateGrammar() } });
		} finally {
			grammarLoading = false;
		}
	}

	async function saveGrammar() {
		if (!card || !grammar || card.id == null) return;
		const savedAt = Date.now();
		const g = $state.snapshot(grammar) as GrammarBreakdown;
		try {
			await updateCard(card.id, { grammar: g, grammarSavedAt: savedAt });
		} catch {
			app.toast('No se pudo guardar la explicación', 'error');
			return;
		}
		card.grammar = g;
		card.grammarSavedAt = savedAt;
		grammarSaved = true;
		app.toast('Explicación guardada', 'success');
	}

	function grammarText(g: GrammarBreakdown): string {
		return [g.summary, g.focusNote, ...g.tokens.map((t) => `${t.surface}: ${t.role}. ${t.note}`)].filter(Boolean).join('. ');
	}

	// --- Audio natural (Gemini TTS) ---

	async function generateAudio() {
		if (!card?.id) return;
		audioLoading = true;
		try {
			const blob = await synthesizeJapanese(card.front);
			await updateCard(card.id, { audioBlob: blob });
			card.audioBlob = blob;
			void speakJapanese(card.front, blob);
			app.toast('Audio guardado en la tarjeta', 'success');
		} catch (err) {
			app.toast(err instanceof GeminiError ? err.message : 'No se pudo generar el audio', 'error');
		} finally {
			audioLoading = false;
		}
	}

	// --- Atajos de teclado ---

	function onkeydown(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
			if (typing) return;
			e.preventDefault();
			void undoLast();
			return;
		}
		if (typing || e.altKey || e.ctrlKey || e.metaKey) return;
		if (e.key.toLowerCase() === 'u') return void undoLast();
		if (phase === 'question') {
			if (mode === 'reveal' && (e.key === ' ' || e.key === 'Enter')) {
				e.preventDefault();
				reveal();
			} else if (mode === 'choice' && /^[1-4]$/.test(e.key)) choose(Number(e.key) - 1);
		} else if (phase === 'answered') {
			const keys: RatingKey[] = ['again', 'hard', 'good', 'easy'];
			if (/^[1-4]$/.test(e.key)) {
				if (via === 'choice' && e.key === '4') return;
				void rate(keys[Number(e.key) - 1]);
			} else if ((e.key === ' ' || e.key === 'Enter') && suggested) {
				e.preventDefault();
				void rate(suggested);
			}
		}
	}

	const FACET_HINT = { recognition: '¿Qué significa?', visual: '¿Qué significa lo marcado?', cloze: 'Completa la frase', production: 'Escríbelo en japonés' } as const;
</script>

<svelte:window {onkeydown} />

<div class="mb-4 flex flex-wrap items-center justify-between gap-2">
	<h1 class="text-2xl font-bold">Estudio</h1>
	<div class="flex rounded-full border border-slate-300 p-0.5 text-sm" role="radiogroup" aria-label="Modo de respuesta">
		{#each [['reveal', 'Revelar'], ['typed', '⌨ Escribir'], ['choice', 'Opciones']] as [v, label] (v)}
			<button
				role="radio"
				aria-checked={style === v}
				class="min-h-9 rounded-full px-3 font-medium transition {style === v ? 'bg-brand text-brand-fg' : 'text-slate-600 hover:bg-slate-100'}"
				onclick={() => changeStyle(v as AnswerStyle)}>{label}</button
			>
		{/each}
	</div>
</div>

{#if loading}
	<p class="text-slate-400">Cargando…</p>
{:else if done}
	<div class="bg-surface rounded-xl border border-slate-200 p-8 text-center shadow-sm">
		<div class="text-4xl">✓</div>
		<p class="mt-2 font-semibold">{reviewed ? '¡Sesión completa!' : 'No hay nada por repasar ahora.'}</p>
		<p class="text-sm text-slate-500">{reviewed} repasos hechos.</p>
		{#if summary && quotaMessage(summary.quota, summary.reviews)}
			<p class="mt-2 text-sm text-amber-600">{quotaMessage(summary.quota, summary.reviews)}</p>
		{:else if summary && summary.newAvailable > summary.newToday && summary.quota.left === 0}
			<p class="mt-2 text-sm text-slate-500">Quedan {summary.newAvailable - summary.newToday} nuevas para los próximos días (cupo: {summary.quota.limit}/día).</p>
		{/if}
		<div class="mt-4 flex flex-wrap justify-center gap-2">
			{#if undo}<Button variant="secondary" onclick={undoLast}>↶ Deshacer última</Button>{/if}
			<a href={`${base}/estadisticas`} class="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium text-slate-700 hover:bg-slate-100">📊 Estadísticas</a>
		</div>
	</div>
{:else if current && card}
	<div class="pb-52">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
			<span class="text-slate-400">
				{index + 1} / {queue.length}
				{#if isNew}<span class="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-700">nueva</span>{/if}
				{#if current.schedule.lapses >= LEECH_LAPSES}<span class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">se resiste</span>{/if}
			</span>
			<div class="flex items-center gap-1">
				{#if undo}<Button variant="ghost" onclick={undoLast} title="Deshacer (Ctrl+Z)">↶ Deshacer</Button>{/if}
				<button
					class="min-h-9 rounded-full border px-3 font-medium transition select-none active:scale-95 {showFurigana
						? 'border-brand bg-brand text-brand-fg'
						: 'border-slate-300 text-slate-600 hover:bg-slate-100'}"
					onclick={() => (showFurigana = !showFurigana)}
				>
					{showFurigana ? 'あ Furigana visible' : 'あ Furigana oculto'}
				</button>
			</div>
		</div>

		<div class="bg-surface relative rounded-2xl border border-slate-200 shadow-sm">
			<div class="absolute top-2 right-2 z-10 flex">
				{#if facet !== 'production' || phase === 'answered'}
					<IconButton label="Escuchar" onclick={() => speakJapanese(card.front, card.audioBlob)}>♪</IconButton>
				{/if}
				<IconButton label="Pausar o suspender" onclick={() => leechWarning(card)}>⏸</IconButton>
			</div>

			<!-- Pregunta -->
			<div class="flex flex-col items-center p-5 pt-12 text-center sm:p-8 sm:pt-12">
				<p class="mb-3 text-xs font-medium tracking-wide text-slate-400 uppercase">{FACET_HINT[facet]}</p>
				{#if facet === 'recognition'}
					<span class="text-2xl leading-relaxed sm:text-3xl"><Furigana text={card.front} showReadings={showFurigana} /></span>
				{:else if facet === 'visual' && card.imageId != null}
					<CardImage imageId={card.imageId} box={card.box} crop={!!card.box} class="w-full max-w-md" />
				{:else if facet === 'cloze' && cloze}
					<span class="text-xl leading-relaxed sm:text-2xl">
						{#if phase === 'answered'}
							<Furigana text={cloze.full} showReadings={showFurigana} />
						{:else}
							{cloze.before}<span class="mx-1 inline-block min-w-[3em] border-b-2 border-sky-500 text-sky-500">？</span>{cloze.after}
						{/if}
					</span>
					<p class="mt-2 text-sm text-slate-500">Pista: {card.back}</p>
				{:else if facet === 'production'}
					<span class="text-2xl font-medium sm:text-3xl">{card.back}</span>
				{:else}
					<span class="text-2xl"><Furigana text={card.front} showReadings={showFurigana} /></span>
				{/if}
			</div>

			<!-- Respuesta -->
			{#if phase === 'answered'}
				<div class="border-t border-slate-200 p-5 text-center sm:p-8">
					{#if correct !== null}
						<p class="mb-3 font-semibold {correct ? 'text-emerald-600' : 'text-red-600'}">
							{correct ? (judgement?.verdict === 'partial' ? '◐ Casi' : '✓ Correcto') : '✗ Incorrecto'}
							{#if answer && via !== 'choice'}<span class="font-normal text-slate-500"> · respondiste «{answer}»</span>{/if}
						</p>
					{/if}
					{#if judgement}
						<div class="mb-3 rounded-lg bg-sky-50 p-3 text-left text-sm text-slate-700">
							<p>{judgement.feedback}</p>
							{#if judgement.corrected}<p class="mt-1 text-lg"><Furigana text={judgement.corrected} /></p>{/if}
						</div>
					{/if}
					{#if facet !== 'recognition'}
						<div class="text-2xl leading-relaxed"><Furigana text={card.front} showReadings={true} /></div>
					{/if}
					<div class="mt-1 text-xl font-medium">{card.back}</div>
					{#if card.reading}<div class="mt-1 text-slate-500">{card.reading}</div>{/if}
					{#if card.context && facet !== 'cloze'}
						<div class="mt-3 text-sm whitespace-pre-line text-slate-500"><Furigana text={card.context} showReadings={showFurigana} /></div>
					{/if}
					{#if card.imageId != null && facet !== 'visual'}
						<details class="mt-3 text-left">
							<summary class="cursor-pointer text-sm text-slate-500">🖼 Ver imagen de contexto</summary>
							<CardImage imageId={card.imageId} box={card.box} class="mt-2" />
						</details>
					{:else if card.imageId != null && card.box}
						<CardImage imageId={card.imageId} box={card.box} class="mt-3" />
					{/if}

					<div class="mt-4 flex flex-wrap items-center justify-center gap-2">
						{#if correct === false && via === 'typed'}
							<Button variant="secondary" onclick={countAsCorrect}>Contar como correcta</Button>
						{/if}
						{#if hasKey}
							{#if grammar}
								<Button variant="ghost" loading={grammarLoading} onclick={generateGrammar}>🔄 Regenerar</Button>
								{#if !grammarSaved}<Button variant="ghost" loading={grammarLoading} onclick={saveGrammar}>💾 Guardar versión</Button>{/if}
							{:else}
								<Button variant="ghost" loading={grammarLoading} onclick={generateGrammar}>📖 Explicar gramática</Button>
							{/if}
							{#if !card.audioBlob}
								<Button variant="ghost" loading={audioLoading} onclick={generateAudio}>🔊 Audio natural</Button>
							{/if}
						{/if}
					</div>

					{#if grammar}
						<div class="mt-3 rounded-lg bg-slate-50 p-3 text-left text-sm">
							<div class="mb-2 flex items-start justify-between gap-2">
								<p class="font-medium text-slate-700">{grammar.summary}</p>
								<IconButton label="Leer en voz alta" onclick={() => grammar && speakMixed(grammarText(grammar))}>🔊</IconButton>
							</div>
							{#if grammar.focusNote}<p class="mb-2 rounded bg-sky-50 p-2 text-slate-700">{grammar.focusNote}</p>{/if}
							<ul class="space-y-1">
								{#each grammar.tokens as tok, i (i)}
									<li><span class="font-semibold">{tok.surface}</span> <span class="text-slate-400">({tok.role})</span> — {tok.note}</li>
								{/each}
							</ul>
							{#if !grammarSaved}
								<p class="mt-2 text-xs text-amber-600">Versión nueva sin guardar.</p>
							{:else if card.grammarSavedAt}
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
		<div class="pointer-events-auto mx-auto max-w-3xl rounded-xl bg-slate-50/90 backdrop-blur sm:bg-transparent">
			{#if phase === 'question' && mode === 'reveal'}
				<Button size="lg" full onclick={reveal}>Mostrar respuesta <kbd class="ml-2 hidden text-xs opacity-60 sm:inline">Espacio</kbd></Button>
			{:else if phase === 'question' && mode === 'choice' && options}
				<div class="grid grid-cols-2 gap-2">
					{#each options as o, i (o.id)}
						<button class="bg-surface min-h-14 rounded-lg border border-slate-300 px-3 py-2 text-left transition hover:border-sky-500 active:scale-[.98]" onclick={() => choose(i)}>
							<kbd class="mr-1 hidden text-xs text-slate-400 sm:inline">{i + 1}</kbd>
							{#if kind === 'meaning'}{o.back}{:else}<Furigana text={o.front} showReadings={false} />{/if}
						</button>
					{/each}
				</div>
			{:else if phase === 'question' || phase === 'judging'}
				<div class="flex gap-2">
					<div class="flex-1">
						<AnswerInput
							bind:value={answer}
							kana={kind === 'word'}
							autofocus
							disabled={phase === 'judging'}
							placeholder={kind === 'word' ? 'Escribe en japonés (romaji → かな)' : 'Significado o lectura'}
							onsubmit={submitTyped}
						/>
					</div>
					<Button size="lg" loading={phase === 'judging'} onclick={submitTyped}>{phase === 'judging' ? 'Juzgando…' : 'Comprobar'}</Button>
				</div>
				<button class="mt-1 w-full text-center text-sm text-slate-500 underline" onclick={reveal} disabled={phase === 'judging'}>No sé · mostrar respuesta</button>
			{:else if intervals}
				<RatingButtons {intervals} onrate={rate} {suggested} hideEasy={via === 'choice'} />
				{#if via === 'choice'}<p class="mt-1 text-center text-xs text-slate-400">Elegir entre opciones es reconocer: como mucho «Bien».</p>{/if}
			{/if}
		</div>
	</div>
{/if}
