<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { version } from '$app/environment';
	import { getAllSettings, setSetting, type SettingsMap, type AnswerStyle, type VoiceSource } from '$lib/db/settings';
	import type { BackupRow, Facet } from '$lib/db/schema';
	import { listJapaneseVoices, listSpanishVoices, playBlob, speakJapanese, speakMixed, ttsSupported } from '$lib/media/tts';
	import { createBackup, deleteBackup, downloadBackup, downloadBlob, fmtBytes, importBackup, KIND_LABELS, listBackups, restoreBackup } from '$lib/db/backup';
	import { FACET_LABELS } from '$lib/srs/facets';
	import { BRAKE_HALF, BRAKE_STOP, MIN_REVIEWS_OPTIMIZE } from '$lib/srs/constants';
	import { applyCalibration, calibrate, reviewCount, type Calibration } from '$lib/srs/optimizer';
	import { usageReport, type UsageReport } from '$lib/gemini/usage';
	import { fmtUsd, priceFor } from '$lib/gemini/pricing';
	import type { ModelOption } from '$lib/gemini/models';
	import { GEMINI_VOICES, VOICE_SAMPLE, voiceLabel } from '$lib/gemini/voices';
	import { listModels, probeModel } from '$lib/gemini/probe';
	import { synthesizeJapanese } from '$lib/gemini/tts';
	import { isGen3Plus } from '$lib/gemini/request';
	import { GeminiError } from '$lib/gemini/errors';
	import { theme, type ThemePref } from '$lib/theme.svelte';
	import { forceReload } from '$lib/pwa';
	import { takePending } from '$lib/inbox';
	import { app } from '$lib/state/app.svelte';
	import { net } from '$lib/net.svelte';
	import Button from '$lib/gui/Button.svelte';
	import Field from '$lib/gui/Field.svelte';
	import Select from '$lib/gui/Select.svelte';
	import ConfirmDialog from '$lib/gui/ConfirmDialog.svelte';
	import ModelPicker from '$lib/gui/ModelPicker.svelte';
	import SettingsSection from '$lib/gui/SettingsSection.svelte';

	let settings = $state<SettingsMap | null>(null);
	let voices = $state<SpeechSynthesisVoice[]>([]);
	let esVoices = $state<SpeechSynthesisVoice[]>([]);
	let backups = $state<BackupRow[]>([]);
	let usage = $state<UsageReport | null>(null);
	let reviews = $state(0);
	let calibration = $state<Calibration | null>(null);
	let calibrating = $state(false);
	let persisted = $state<boolean | null>(null);
	let storage = $state<{ usage: number; quota: number } | null>(null);

	// IA: clave, modelos y pruebas.
	let keyDraft = $state('');
	let showKey = $state(false);
	let keyStatus = $state<'idle' | 'testing' | 'ok' | 'fail'>('idle');
	let keyError = $state('');
	let listed = $state<{ text: ModelOption[]; tts: ModelOption[] } | null>(null);
	let modelBusy = $state(false);

	// Voz de Gemini: «Probar» cachea el audio por voz+modelo (no se paga dos veces).
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- caché interna, no se muestra
	const sampleCache = new Map<string, Blob>();
	let sampling = $state<string | null>(null);

	// Confirmaciones destructivas.
	let pendingImport = $state<File | null>(null);
	let pendingRestore = $state<BackupRow | null>(null);

	// Precio propio de un modelo.
	let priceForm = $state({ model: '', input: '', output: '' });

	onMount(async () => {
		try {
			settings = await getAllSettings();
			keyDraft = settings.apiKey;
			if (ttsSupported()) [voices, esVoices] = await Promise.all([listJapaneseVoices(), listSpanishVoices()]);
			await refresh();
			reviews = await reviewCount();
			persisted = (await navigator.storage?.persisted?.()) ?? null;
			const est = await navigator.storage?.estimate?.();
			if (est?.usage != null && est.quota) storage = { usage: est.usage, quota: est.quota };
		} catch (e) {
			app.error(e, 'No se pudieron cargar los ajustes');
		}
		const shared = takePending('ajustes');
		if (shared?.files[0]) pendingImport = shared.files[0];
	});
	onDestroy(() => sampleCache.clear());

	async function refresh() {
		backups = await listBackups();
		usage = await usageReport();
	}

	async function save<K extends keyof SettingsMap>(key: K, value: SettingsMap[K], quiet = false) {
		try {
			await setSetting(key, value);
			if (settings) settings[key] = value;
			await app.loadSettings();
		} catch (e) {
			app.error(e, 'No se pudo guardar el ajuste');
			return false;
		}
		if (!quiet) app.toast('Guardado', 'success', { key: 'saved' });
		return true;
	}

	// --- IA ---

	async function saveKey() {
		const key = keyDraft.trim();
		if (!settings || key === settings.apiKey) return;
		await save('apiKey', key, true);
		listed = null;
		keyStatus = 'idle';
		if (key) await testKey();
		else app.toast('API key borrada', 'info');
	}

	async function testKey() {
		if (!settings?.apiKey) return;
		keyStatus = 'testing';
		keyError = '';
		try {
			await probeModel(settings.geminiModel);
			keyStatus = 'ok';
			usage = await usageReport();
		} catch (e) {
			keyStatus = 'fail';
			keyError = e instanceof GeminiError ? e.message : String(e);
		}
	}

	async function loadAll() {
		try {
			listed = await listModels();
		} catch (e) {
			app.error(e, 'No se pudo cargar la lista de modelos', { retry: () => void loadAll() });
		}
	}

	/** Cambia de modelo comprobando antes que exista para tu key (si hay key y conexión). */
	async function pickModel(key: 'geminiModel' | 'ttsModel', id: string) {
		if (!settings || id === settings[key]) return;
		if (settings.apiKey && net.online && key === 'geminiModel') {
			modelBusy = true;
			try {
				await probeModel(id);
			} catch (e) {
				if (e instanceof GeminiError && (e.code === 'model-not-found' || e.code === 'bad-request')) {
					app.error(e, 'Modelo no disponible');
					return;
				}
				// Otros fallos (cuota, red): se guarda igual, avisando.
				app.toast(`Guardado sin poder comprobarlo: ${e instanceof Error ? e.message : e}`, 'warn');
			} finally {
				modelBusy = false;
			}
		}
		if (await save(key, id, true)) app.toast(`Modelo: ${id}`, 'success', { key: 'saved' });
	}

	// --- Voz ---

	async function trySystemVoice() {
		await speakJapanese('こんにちは。今日も一緒に日本語を勉強しましょう。');
	}

	async function tryGeminiVoice(voice: string) {
		if (!settings) return;
		const k = `${settings.ttsModel}|${voice}`;
		const cached = sampleCache.get(k);
		if (cached) return void playBlob(cached);
		sampling = voice;
		try {
			const blob = await synthesizeJapanese(VOICE_SAMPLE, { voice });
			sampleCache.set(k, blob);
			void playBlob(blob);
			usage = await usageReport();
		} catch (e) {
			app.error(e, 'No se pudo probar la voz', { retry: () => void tryGeminiVoice(voice) });
		} finally {
			sampling = null;
		}
	}

	async function pickVoice(voice: string) {
		await save('ttsGeminiVoice', voice, true);
		await tryGeminiVoice(voice);
	}

	function toggleDefaultFacet(f: Facet) {
		if (!settings || f === 'recognition') return;
		const cur = settings.defaultFacets;
		void save('defaultFacets', cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]);
	}

	// --- Copias ---

	function onImportPicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // permite re-elegir el mismo archivo
		if (file) pendingImport = file;
	}

	async function runExport() {
		try {
			await downloadBackup();
		} catch (e) {
			app.error(e, 'No se pudo exportar el backup', { retry: () => void runExport() });
		}
	}

	async function runImport() {
		if (!pendingImport) return;
		const file = pendingImport;
		pendingImport = null;
		try {
			await importBackup(file);
			app.toast('Backup importado', 'success', { detail: 'Se guardó una copia de tus datos anteriores en «Copias en este navegador».' });
			settings = await getAllSettings();
			await app.loadSettings();
			await refresh();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			if (msg.includes('Yomigaeru')) app.toast(msg, 'error', { detail: 'Tus datos no se tocaron.' });
			else app.error(e, 'No se pudo importar el backup', { detail: 'Tus datos no se tocaron (hay una copia previa en la lista).' });
		}
	}

	async function manualBackup() {
		try {
			await createBackup('manual');
			await refresh();
			app.toast('Copia creada', 'success');
		} catch (e) {
			app.error(e, 'No se pudo crear la copia');
		}
	}

	async function runRestore() {
		if (!pendingRestore?.id) return;
		const id = pendingRestore.id;
		pendingRestore = null;
		try {
			await restoreBackup(id);
			settings = await getAllSettings();
			await app.loadSettings();
			await refresh();
			app.toast('Copia restaurada', 'success');
		} catch (e) {
			app.error(e, 'No se pudo restaurar la copia');
		}
	}

	async function removeBackup(b: BackupRow) {
		try {
			await deleteBackup(b.id!);
			await refresh();
		} catch (e) {
			app.error(e, 'No se pudo borrar la copia');
		}
	}

	async function askPersist() {
		persisted = (await navigator.storage?.persist?.()) ?? false;
		app.toast(persisted ? 'El navegador no borrará tus datos por falta de espacio.' : 'El navegador no concedió la protección (instala la app o úsala más).', persisted ? 'success' : 'warn');
	}

	// --- Costos ---

	async function addPrice() {
		if (!settings) return;
		const model = priceForm.model.trim();
		const input = Number(priceForm.input);
		const output = Number(priceForm.output);
		if (!model || !(input >= 0) || !(output >= 0)) {
			app.toast('Completa modelo y precios (USD por millón de tokens)', 'warn');
			return;
		}
		await save('modelPrices', { ...settings.modelPrices, [model]: { input, output } });
		priceForm = { model: '', input: '', output: '' };
		usage = await usageReport();
	}

	async function removePrice(model: string) {
		if (!settings) return;
		const { [model]: _drop, ...rest } = settings.modelPrices;
		await save('modelPrices', rest);
	}

	// --- Calibración FSRS ---

	async function runCalibration() {
		calibrating = true;
		try {
			calibration = await calibrate();
		} catch (e) {
			app.error(e, 'La calibración falló');
		} finally {
			calibrating = false;
		}
	}

	async function applyParams(params: number[] | null) {
		calibrating = true;
		try {
			const n = await applyCalibration(params);
			if (settings) settings.fsrsParams = params;
			calibration = null;
			app.toast(params ? `Parámetros propios aplicados (${n} caras reprogramadas)` : `Parámetros por defecto restaurados (${n} caras reprogramadas)`, 'success');
		} catch (e) {
			app.error(e, 'No se pudieron aplicar los parámetros');
		} finally {
			calibrating = false;
		}
	}

	const iaSummary = $derived(settings ? `${settings.apiKey ? '' : 'Sin API key · '}${settings.geminiModel}${usage ? ` · ${fmtUsd(usage.monthUsd)} este mes` : ''}` : '');
	const voiceSummary = $derived(settings ? (settings.voiceSource === 'gemini' ? `Voz natural IA · ${voiceLabel(settings.ttsGeminiVoice)}` : 'Voz del sistema') : '');
	const studySummary = $derived(settings ? `${settings.newPerDay} nuevas/día · retención ${Math.round(settings.requestRetention * 100)}%` : '');
	const dataSummary = $derived(`${backups.length} copias${storage ? ` · ${fmtBytes(storage.usage)} usados` : ''}`);
	const THEMES: [ThemePref, string][] = [
		['light', '☀ Claro'],
		['dark', '☾ Oscuro'],
		['system', 'Sistema'],
	];
	const fileLabel =
		'inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium transition select-none hover:bg-slate-50 active:scale-[.98]';
	const sub = 'mt-5 mb-2 text-sm font-semibold text-slate-800';
</script>

<h1 class="mb-4 text-2xl font-bold">Ajustes</h1>

{#if settings}
	<div class="space-y-3">
		<!-- IA -->
		<SettingsSection id="ia" title="Inteligencia artificial (Gemini)" summary={iaSummary} open={!settings.apiKey}>
			<h3 class="mb-1 text-sm font-semibold text-slate-800">API key</h3>
			<p class="mb-2 text-xs text-slate-500">
				Consíguela gratis en <a class="underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com</a>. Se guarda solo en este dispositivo y nunca
				va en los backups. Va directo de tu navegador a Google: restríngela por dominio en Google Cloud.
			</p>
			<form
				class="flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					void saveKey();
				}}
			>
				<input
					type={showKey ? 'text' : 'password'}
					bind:value={keyDraft}
					placeholder="AIza…"
					autocomplete="off"
					spellcheck="false"
					class="bg-surface min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 font-mono text-base"
					onblur={saveKey}
				/>
				<button type="button" class="min-h-11 rounded-lg border border-slate-300 px-3 text-sm" aria-label={showKey ? 'Ocultar' : 'Mostrar'} onclick={() => (showKey = !showKey)}
					>{showKey ? '🙈' : '👁'}</button
				>
			</form>
			<div class="mt-2 flex flex-wrap items-center gap-2 text-sm">
				<Button variant="secondary" disabled={!settings.apiKey || !net.online} loading={keyStatus === 'testing'} onclick={testKey}>Probar conexión</Button>
				{#if keyStatus === 'ok'}<span class="text-emerald-700">✓ Funciona con {settings.geminiModel}</span>{/if}
				{#if keyStatus === 'fail'}<span class="text-red-600">✗ {keyError}</span>{/if}
			</div>

			<h3 class={sub}>Modelo para crear tarjetas y explicar</h3>
			<ModelPicker
				kind="text"
				value={settings.geminiModel}
				listed={listed?.text ?? null}
				customPrices={settings.modelPrices}
				busy={modelBusy}
				onpick={(id) => pickModel('geminiModel', id)}
				onloadall={loadAll}
			/>

			<h3 class={sub}>Búsqueda web</h3>
			<label class="flex min-h-11 items-start gap-3 text-sm text-slate-700">
				<input
					type="checkbox"
					class="mt-0.5 size-5 shrink-0 accent-sky-600"
					checked={settings.webSearch}
					disabled={!isGen3Plus(settings.geminiModel)}
					onchange={(e) => save('webSearch', (e.currentTarget as HTMLInputElement).checked)}
				/>
				<span>
					Verificar lecturas raras con Google
					<span class="block text-xs text-slate-500">
						Más lento (~5 s más) y con costo aparte (5 000 búsquedas gratis al mes, luego ~$14 por 1 000). Útil para nombres propios y jerga.
						{#if !isGen3Plus(settings.geminiModel)}<b>Requiere un modelo Gemini 3 o posterior.</b>{/if}
					</span>
				</span>
			</label>

			<h3 class={sub}>Costos (estimados)</h3>
			{#if usage}
				<p class="text-sm text-slate-600">
					Este mes: <b>{fmtUsd(usage.monthUsd)}</b> en {usage.calls} llamadas{usage.failed ? ` (${usage.failed} fallidas)` : ''} · proyección {fmtUsd(usage.projectedUsd)}.
					{#if usage.unpriced}<span class="text-amber-600">{usage.unpriced} sin precio (añádelo abajo).</span>{/if}
				</p>
				{#if usage.budget > 0}
					<div class="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
						<div
							class="h-full {usage.budgetUsed >= 1 ? 'bg-red-600' : usage.budgetUsed >= 0.8 ? 'bg-amber-500' : 'bg-emerald-600'}"
							style:width={`${Math.min(100, usage.budgetUsed * 100)}%`}
						></div>
					</div>
					<p class="mt-1 text-xs text-slate-500">{Math.round(usage.budgetUsed * 100)}% del presupuesto ({fmtUsd(usage.budget)}).</p>
				{/if}
				{#if usage.byFeature.length}
					<ul class="mt-2 text-sm text-slate-600">
						{#each usage.byFeature as f (f.feature)}<li>{f.label}: {fmtUsd(f.usd)} · {f.calls} llamadas</li>{/each}
					</ul>
				{/if}
				{#if usage.recent.length}
					<details class="mt-2 text-sm">
						<summary class="min-h-9 cursor-pointer text-slate-500">Últimas llamadas</summary>
						<ul class="mt-1 space-y-0.5 overflow-x-auto font-mono text-xs text-slate-500">
							{#each usage.recent as r (r.id)}
								<li class="whitespace-nowrap">
									{new Date(r.at).toLocaleString()} · {r.feature} · {r.model} · {r.promptTokens}+{r.outputTokens} tok · {r.ok ? fmtUsd(r.costUsd) : 'falló'}
								</li>
							{/each}
						</ul>
					</details>
				{/if}
			{/if}
			<div class="mt-3 grid gap-3 sm:grid-cols-2">
				<Field
					label="Presupuesto mensual (USD, 0 = sin límite)"
					inputmode="decimal"
					value={String(settings.monthlyBudgetUsd)}
					onchange={(e) => save('monthlyBudgetUsd', Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0))}
				/>
				<label class="flex min-h-11 items-center gap-3 self-end text-sm text-slate-700">
					<input type="checkbox" checked={settings.budgetHardStop} onchange={(e) => save('budgetHardStop', (e.currentTarget as HTMLInputElement).checked)} class="size-5 accent-sky-600" />
					Bloquear la IA al superarlo
				</label>
			</div>
			<details class="mt-3 text-sm">
				<summary class="min-h-9 cursor-pointer text-slate-600">Precios por modelo (USD por millón de tokens)</summary>
				<p class="mt-1 text-xs text-slate-500">
					{settings.geminiModel}: {priceFor(settings.geminiModel, settings.modelPrices)
						? `entrada $${priceFor(settings.geminiModel, settings.modelPrices)?.input}, salida $${priceFor(settings.geminiModel, settings.modelPrices)?.output}`
						: 'sin precio'}. Los precios por defecto son los de Google a nov. 2026 (algunos suben en diciembre). La factura real está en Google AI Studio.
				</p>
				{#each Object.entries(settings.modelPrices) as [m, p] (m)}
					<div class="mt-1 flex items-center gap-2 font-mono text-xs">
						<span class="flex-1">{m}: ${p.input} / ${p.output}</span>
						<Button variant="ghost" onclick={() => removePrice(m)}>Quitar</Button>
					</div>
				{/each}
				<div class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
					<Field bind:value={priceForm.model} placeholder="modelo" mono class="col-span-2 sm:col-span-1" />
					<Field bind:value={priceForm.input} placeholder="entrada" inputmode="decimal" />
					<Field bind:value={priceForm.output} placeholder="salida" inputmode="decimal" />
					<Button variant="secondary" class="col-span-2 sm:col-span-1" onclick={addPrice}>Añadir</Button>
				</div>
			</details>
		</SettingsSection>

		<!-- Voz -->
		<SettingsSection id="voz" title="Voz" summary={voiceSummary}>
			<p class="mb-2 text-sm text-slate-500">Cómo suenan las palabras al estudiar y al pulsar ♪.</p>
			<div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Fuente de voz">
				{#each [['system', 'Voz del sistema', 'Gratis y sin conexión. La calidad depende del dispositivo.'], ['gemini', 'Voz natural IA', 'Gemini genera el audio la primera vez y se guarda en la tarjeta: luego suena sin conexión. Cuesta ~$0,002 por palabra.']] as [v, title, desc] (v)}
					{@const on = settings.voiceSource === v}
					<button
						role="radio"
						aria-checked={on}
						class="rounded-xl border p-3 text-left transition {on ? 'border-sky-500 bg-sky-50 ring-1 ring-sky-300' : 'bg-surface border-slate-200 hover:bg-slate-50'}"
						onclick={() => save('voiceSource', v as VoiceSource)}
					>
						<span class="block font-medium">{title}</span>
						<span class="mt-0.5 block text-xs text-slate-500">{desc}</span>
					</button>
				{/each}
			</div>

			{#if settings.voiceSource === 'gemini'}
				<h3 class={sub}>Voz de Gemini</h3>
				{#if !settings.apiKey}<p class="mb-2 text-sm text-amber-700">Necesitas una API key (sección «Inteligencia artificial»).</p>{/if}
				<div class="flex items-end gap-2">
					<Select label="Voz" value={settings.ttsGeminiVoice} onchange={(e) => pickVoice((e.currentTarget as HTMLSelectElement).value)} class="min-w-0 flex-1">
						{#each ['media', 'aguda', 'grave'] as pitch (pitch)}
							<optgroup label={pitch === 'media' ? 'Tono medio' : pitch === 'aguda' ? 'Más aguda' : 'Más grave'}>
								{#each GEMINI_VOICES.filter((v) => v.pitch === pitch) as v (v.name)}
									<option value={v.name}>{v.name} — {v.style}</option>
								{/each}
							</optgroup>
						{/each}
					</Select>
					<Button variant="secondary" disabled={!settings.apiKey || !net.online} loading={sampling === settings.ttsGeminiVoice} onclick={() => tryGeminiVoice(settings!.ttsGeminiVoice)}
						>▶ Probar</Button
					>
				</div>
				<p class="mt-1 text-xs text-slate-500">Al elegir una voz suena una frase de ejemplo (se paga una sola vez por voz).</p>
				<h3 class={sub}>Modelo de voz</h3>
				<ModelPicker kind="tts" value={settings.ttsModel} listed={listed?.tts ?? null} customPrices={settings.modelPrices} onpick={(id) => pickModel('ttsModel', id)} onloadall={loadAll} />
				<p class="mt-2 text-xs text-slate-500">Puedes generar el audio de un mazo entero desde Mazos.</p>
			{/if}

			<h3 class={sub}>Voz del sistema {settings.voiceSource === 'gemini' ? '(si falla la IA y para las explicaciones)' : ''}</h3>
			{#if !ttsSupported()}
				<p class="text-sm text-red-600">Tu navegador no soporta síntesis de voz.</p>
			{:else}
				<div class="grid gap-3">
					<div class="flex items-end gap-2">
						<Select label="Japonés" value={settings.ttsVoiceURI} onchange={(e) => save('ttsVoiceURI', (e.currentTarget as HTMLSelectElement).value)} class="min-w-0 flex-1">
							<option value="">(Predeterminada del sistema)</option>
							{#each voices as v (v.voiceURI)}<option value={v.voiceURI}>{v.name} — {v.lang}</option>{/each}
						</Select>
						<Button variant="secondary" onclick={trySystemVoice}>▶ Probar</Button>
					</div>
					{#if !voices.length}<p class="text-sm text-slate-500">No hay voces japonesas instaladas en el sistema: usa «Voz natural IA» o instala una voz ja-JP.</p>{/if}
					<div class="flex items-end gap-2">
						<Select
							label="Español (explicaciones leídas en voz alta)"
							value={settings.ttsVoiceEsURI}
							onchange={(e) => save('ttsVoiceEsURI', (e.currentTarget as HTMLSelectElement).value)}
							class="min-w-0 flex-1"
						>
							<option value="">(Predeterminada)</option>
							{#each esVoices as v (v.voiceURI)}<option value={v.voiceURI}>{v.name} — {v.lang}</option>{/each}
						</Select>
						<Button variant="secondary" onclick={() => speakMixed('食べる significa comer.')}>▶ Probar</Button>
					</div>
					<label class="block text-sm font-medium text-slate-700">
						Velocidad: {settings.ttsRate.toFixed(2)}
						<input
							type="range"
							min="0.6"
							max="1.3"
							step="0.05"
							value={settings.ttsRate}
							oninput={(e) => (settings!.ttsRate = +(e.currentTarget as HTMLInputElement).value)}
							onchange={(e) => save('ttsRate', +(e.currentTarget as HTMLInputElement).value)}
							class="w-full"
						/>
					</label>
				</div>
			{/if}
		</SettingsSection>

		<!-- Estudio -->
		<SettingsSection id="estudio" title="Estudio" summary={studySummary}>
			<div class="grid gap-3 sm:grid-cols-2">
				<div>
					<Field
						label="Nuevas por día"
						inputmode="numeric"
						value={String(settings.newPerDay)}
						onchange={(e) => save('newPerDay', Math.max(0, Math.round(Number((e.currentTarget as HTMLInputElement).value) || 0)))}
					/>
					<p class="mt-1 text-xs text-slate-500">
						Con ≥ {BRAKE_HALF} repasos pendientes el cupo baja a la mitad; con ≥ {BRAKE_STOP}, no entran nuevas. Cada mazo puede tener su propio cupo.
					</p>
				</div>
				<Select label="Modo de respuesta por defecto" value={settings.answerStyle} onchange={(e) => save('answerStyle', (e.currentTarget as HTMLSelectElement).value as AnswerStyle)}>
					<option value="reveal">Revelar y autoevaluar (como Anki)</option>
					<option value="typed">Escribir la respuesta</option>
					<option value="choice">Elegir entre 4 opciones</option>
				</Select>
			</div>
			<fieldset class="mt-3">
				<legend class="mb-1 text-sm font-medium text-slate-700">Caras al crear tarjetas (si la tarjeta las admite)</legend>
				<div class="flex flex-wrap gap-2">
					{#each Object.entries(FACET_LABELS) as [f, label] (f)}
						<label class="flex min-h-10 items-center gap-2 rounded-full border border-slate-300 px-3 text-sm">
							<input
								type="checkbox"
								checked={f === 'recognition' || settings.defaultFacets.includes(f as Facet)}
								disabled={f === 'recognition'}
								onchange={() => toggleDefaultFacet(f as Facet)}
								class="size-4 accent-sky-600"
							/>
							{label}
						</label>
					{/each}
				</div>
				<p class="mt-1 text-xs text-slate-500">«Producir» usa el juez IA cuando tu respuesta no coincide exactamente.</p>
			</fieldset>

			<h3 class={sub}>Meta de retención (FSRS)</h3>
			<p class="mb-2 text-sm text-slate-500">Probabilidad objetivo de recordar al momento del repaso. Más alto = repasos más frecuentes.</p>
			<div class="flex items-center gap-3">
				<input
					type="range"
					min="0.7"
					max="0.97"
					step="0.01"
					value={settings.requestRetention}
					oninput={(e) => (settings!.requestRetention = +(e.currentTarget as HTMLInputElement).value)}
					onchange={(e) => save('requestRetention', +(e.currentTarget as HTMLInputElement).value)}
					class="flex-1"
				/>
				<span class="w-14 shrink-0 text-right font-mono text-lg font-semibold">{Math.round(settings.requestRetention * 100)}%</span>
			</div>

			<h3 class={sub}>Calibrar FSRS con tu historial</h3>
			<p class="text-sm text-slate-500">
				Ajusta el algoritmo a tu memoria (en tu navegador). Requiere ≥ {MIN_REVIEWS_OPTIMIZE} repasos; tienes {reviews}.
				{settings.fsrsParams ? 'Ahora usas parámetros propios.' : 'Ahora usas los parámetros por defecto.'}
			</p>
			<div class="mt-2 flex flex-wrap gap-2">
				<Button variant="secondary" loading={calibrating} disabled={reviews < MIN_REVIEWS_OPTIMIZE} onclick={runCalibration}>Calibrar</Button>
				{#if settings.fsrsParams}<Button variant="ghost" disabled={calibrating} onclick={() => applyParams(null)}>Volver a los por defecto</Button>{/if}
			</div>
			{#if calibration}
				<div class="mt-2 rounded-lg bg-sky-50 p-3 text-sm">
					<p>Con tus {calibration.reviews} repasos, los próximos 30 días tendrían <b>{calibration.workloadAfter}</b> repasos (ahora: {calibration.workloadBefore}).</p>
					<div class="mt-2 flex flex-wrap gap-2">
						<Button loading={calibrating} onclick={() => calibration && applyParams(calibration.params)}>Aplicar y reprogramar</Button>
						<Button variant="ghost" onclick={() => (calibration = null)}>Descartar</Button>
					</div>
				</div>
			{/if}
		</SettingsSection>

		<!-- Apariencia -->
		<SettingsSection id="apariencia" title="Apariencia" summary={THEMES.find(([v]) => v === theme.pref)?.[1] ?? ''}>
			<div class="flex rounded-full border border-slate-300 p-0.5 text-sm" role="radiogroup" aria-label="Tema">
				{#each THEMES as [v, label] (v)}
					<button
						role="radio"
						aria-checked={theme.pref === v}
						class="min-h-10 flex-1 rounded-full px-3 font-medium transition {theme.pref === v ? 'bg-brand text-brand-fg' : 'text-slate-600 hover:bg-slate-100'}"
						onclick={() => theme.set(v)}>{label}</button
					>
				{/each}
			</div>
			<p class="mt-1 text-xs text-slate-500">Se guarda en este dispositivo.</p>
		</SettingsSection>

		<!-- Datos y copias -->
		<SettingsSection id="datos" title="Datos y copias" summary={dataSummary}>
			<p class="mb-3 text-sm text-slate-500">Exporta o restaura mazos, tarjetas, imágenes y progreso en un archivo JSON (sin la API key). Al importar se guarda antes una copia de lo actual.</p>
			<div class="flex flex-wrap gap-2">
				<Button onclick={runExport}>Exportar</Button>
				<label class={fileLabel}>
					Importar
					<input type="file" accept="application/json,.json" class="hidden" onchange={onImportPicked} />
				</label>
				<Button variant="secondary" onclick={manualBackup}>Crear copia ahora</Button>
			</div>

			<label class="mt-3 flex min-h-11 items-center gap-3 text-sm text-slate-700">
				<input type="checkbox" checked={settings.autoBackup} onchange={(e) => save('autoBackup', (e.currentTarget as HTMLInputElement).checked)} class="size-5 accent-sky-600" />
				Copia automática diaria (7 días; sin imágenes ni audio para ocupar poco)
			</label>

			<h3 class={sub}>Copias en este navegador</h3>
			{#if backups.length}
				<ul class="divide-y divide-slate-100 text-sm">
					{#each backups as b (b.id)}
						<li class="flex flex-wrap items-center gap-1 py-2">
							<span class="min-w-0 flex-1">
								{new Date(b.createdAt).toLocaleString()} · {KIND_LABELS[b.kind]}{b.light ? ' (ligera)' : ''} · {fmtBytes(b.size)}
								<span class="block text-xs text-slate-400">{b.counts.cards ?? 0} tarjetas · {b.counts.reviewLogs ?? 0} repasos</span>
							</span>
							<Button variant="ghost" aria-label="Descargar" onclick={() => downloadBlob(b.blob, `yomigaeru-copia-${new Date(b.createdAt).toISOString().slice(0, 10)}.json`)}>⇩</Button>
							<Button variant="secondary" onclick={() => (pendingRestore = b)}>Restaurar</Button>
							<Button variant="ghost" aria-label="Borrar" onclick={() => removeBackup(b)}>🗑</Button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-slate-400">Aún no hay copias.</p>
			{/if}

			<h3 class={sub}>Almacenamiento</h3>
			<p class="text-sm text-slate-500">
				{#if storage}Usado: {fmtBytes(storage.usage)} de {fmtBytes(storage.quota)}.{/if}
				{persisted ? 'Protegido: el navegador no lo borrará por falta de espacio.' : 'Sin protección: el navegador podría borrarlo si falta espacio.'}
			</p>
			{#if persisted === false}<Button variant="secondary" class="mt-2" onclick={askPersist}>Pedir protección</Button>{/if}
		</SettingsSection>

		<!-- App -->
		<SettingsSection id="app" title="App" summary={`Versión ${version}`}>
			<p class="text-sm text-slate-500">Si algo no carga tras una actualización, «Forzar actualización» vuelve a descargar la app sin tocar tus datos.</p>
			<Button variant="secondary" class="mt-2" onclick={() => forceReload()}>Forzar actualización</Button>
		</SettingsSection>
	</div>
{:else}
	<div class="space-y-3">
		{#each [1, 2, 3, 4] as i (i)}<div class="h-16 animate-pulse rounded-2xl bg-slate-100"></div>{/each}
	</div>
{/if}

<ConfirmDialog
	open={pendingImport !== null}
	title="¿Importar backup?"
	message={`Reemplazará tus mazos, tarjetas y progreso actuales por los de «${pendingImport?.name ?? ''}». Antes se guarda una copia de lo actual.`}
	confirmLabel="Importar"
	requireText="REEMPLAZAR"
	oncancel={() => (pendingImport = null)}
	onconfirm={runImport}
/>

<ConfirmDialog
	open={pendingRestore !== null}
	title="¿Restaurar esta copia?"
	message="Reemplazará tus datos actuales por los de la copia. Antes se guarda una copia de lo actual."
	confirmLabel="Restaurar"
	requireText="REEMPLAZAR"
	oncancel={() => (pendingRestore = null)}
	onconfirm={runRestore}
/>
