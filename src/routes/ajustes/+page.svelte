<script lang="ts">
	import { onMount } from 'svelte';
	import { version } from '$app/environment';
	import { getAllSettings, setSetting, DEFAULTS, type SettingsMap, type AnswerStyle } from '$lib/db/settings';
	import type { BackupRow, Facet } from '$lib/db/schema';
	import { listJapaneseVoices, listSpanishVoices, speakJapanese, speakMixed, ttsSupported } from '$lib/media/tts';
	import { createBackup, deleteBackup, downloadBackup, downloadBlob, fmtBytes, importBackup, KIND_LABELS, listBackups, restoreBackup } from '$lib/db/backup';
	import { FACET_LABELS } from '$lib/srs/facets';
	import { BRAKE_HALF, BRAKE_STOP, MIN_REVIEWS_OPTIMIZE } from '$lib/srs/constants';
	import { applyCalibration, calibrate, reviewCount, type Calibration } from '$lib/srs/optimizer';
	import { usageReport, type UsageReport } from '$lib/gemini/usage';
	import { fmtUsd, priceFor } from '$lib/gemini/pricing';
	import { theme, type ThemePref } from '$lib/theme.svelte';
	import { forceReload } from '$lib/pwa';
	import { takePending } from '$lib/inbox';
	import { app } from '$lib/state/app.svelte';
	import Button from '$lib/gui/Button.svelte';
	import Field from '$lib/gui/Field.svelte';
	import Select from '$lib/gui/Select.svelte';
	import ConfirmDialog from '$lib/gui/ConfirmDialog.svelte';

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

	// Confirmaciones destructivas.
	let pendingImport = $state<File | null>(null);
	let pendingRestore = $state<BackupRow | null>(null);

	// Precio propio de un modelo.
	let priceForm = $state({ model: '', input: '', output: '' });

	onMount(async () => {
		try {
			settings = await getAllSettings();
			if (ttsSupported()) [voices, esVoices] = await Promise.all([listJapaneseVoices(), listSpanishVoices()]);
			await refresh();
			reviews = await reviewCount();
			persisted = (await navigator.storage?.persisted?.()) ?? null;
			const est = await navigator.storage?.estimate?.();
			if (est?.usage != null && est.quota) storage = { usage: est.usage, quota: est.quota };
		} catch {
			app.toast('No se pudieron cargar los ajustes', 'error');
		}
		const shared = takePending('ajustes');
		if (shared?.files[0]) pendingImport = shared.files[0];
	});

	async function refresh() {
		backups = await listBackups();
		usage = await usageReport();
	}

	async function save<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]) {
		try {
			await setSetting(key, value);
			if (settings) settings[key] = value;
			await app.loadSettings();
		} catch {
			app.toast('No se pudo guardar el ajuste', 'error');
			return;
		}
		app.toast('Guardado', 'success', { key: 'saved' });
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
		} catch {
			app.toast('No se pudo exportar el backup', 'error');
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
			app.toast(msg.includes('Yomigaeru') ? msg : 'No se pudo importar el backup', 'error', {
				detail: msg.includes('Yomigaeru') ? 'Tus datos no se tocaron.' : `${msg.slice(0, 200)} · Tus datos no se tocaron (hay una copia previa en la lista).`,
			});
		}
	}

	async function manualBackup() {
		try {
			await createBackup('manual');
			await refresh();
			app.toast('Copia creada', 'success');
		} catch {
			app.toast('No se pudo crear la copia (¿espacio lleno?)', 'error');
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
		} catch {
			app.toast('No se pudo restaurar la copia', 'error');
		}
	}

	async function removeBackup(b: BackupRow) {
		await deleteBackup(b.id!);
		await refresh();
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
			app.toast(e instanceof Error ? e.message : 'La calibración falló', 'error');
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
		} catch {
			app.toast('No se pudieron aplicar los parámetros', 'error');
		} finally {
			calibrating = false;
		}
	}

	const section = 'rounded-xl border border-slate-200 bg-surface p-4 shadow-sm';
	const fileLabel =
		'inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-surface px-4 text-sm font-medium transition select-none hover:bg-slate-50 active:scale-[.98]';
</script>

<h1 class="mb-4 text-2xl font-bold">Ajustes</h1>

{#if settings}
	<div class="space-y-6">
		<!-- Gemini -->
		<section class={section}>
			<h2 class="mb-1 font-semibold">Gemini API Key</h2>
			<p class="mb-3 text-sm text-slate-500">
				Se guarda solo en este dispositivo (IndexedDB) y nunca va en los backups. Las llamadas van directo desde tu navegador a Google, así que la clave es visible en las herramientas de
				desarrollo. Restríngela por dominio en Google Cloud y úsala solo en un equipo de confianza.
			</p>
			<Field type="password" mono value={settings.apiKey} placeholder="AIza…" autocomplete="off" onchange={(e) => save('apiKey', (e.currentTarget as HTMLInputElement).value.trim())} />
			<div class="mt-3 grid gap-3 sm:grid-cols-2">
				<div>
					<Field label="Modelo" mono value={settings.geminiModel} onchange={(e) => save('geminiModel', (e.currentTarget as HTMLInputElement).value.trim())} />
					<p class="mt-1 text-xs text-slate-500">La búsqueda web requiere la serie Gemini 3 (ej: gemini-3-flash-preview).</p>
				</div>
				<div>
					<Field label="Modelo de audio (TTS)" mono value={settings.ttsModel} onchange={(e) => save('ttsModel', (e.currentTarget as HTMLInputElement).value.trim())} />
					<p class="mt-1 text-xs text-slate-500">Para «🔊 Audio natural». Voz:</p>
					<Field mono value={settings.ttsGeminiVoice} onchange={(e) => save('ttsGeminiVoice', (e.currentTarget as HTMLInputElement).value.trim() || DEFAULTS.ttsGeminiVoice)} />
				</div>
			</div>
		</section>

		<!-- Costos -->
		<section class={section} id="costos">
			<h2 class="mb-1 font-semibold">Costos de Gemini (estimados)</h2>
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
						<summary class="cursor-pointer text-slate-500">Últimas llamadas</summary>
						<ul class="mt-1 space-y-0.5 font-mono text-xs text-slate-500">
							{#each usage.recent as r (r.id)}
								<li>{new Date(r.at).toLocaleString()} · {r.feature} · {r.model} · {r.promptTokens}+{r.outputTokens} tok · {r.ok ? fmtUsd(r.costUsd) : 'falló'}</li>
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
				<summary class="cursor-pointer text-slate-600">Precios por modelo (USD por millón de tokens)</summary>
				<p class="mt-1 text-xs text-slate-500">
					Modelo actual: {settings.geminiModel} → {priceFor(settings.geminiModel, settings.modelPrices)
						? `entrada $${priceFor(settings.geminiModel, settings.modelPrices)?.input}, salida $${priceFor(settings.geminiModel, settings.modelPrices)?.output}`
						: 'sin precio'}. Los precios por defecto son aproximados: compruébalos en la web de Google. La factura real está en Google AI Studio.
				</p>
				{#each Object.entries(settings.modelPrices) as [m, p] (m)}
					<div class="mt-1 flex items-center gap-2 font-mono text-xs">
						<span class="flex-1">{m}: ${p.input} / ${p.output}</span>
						<Button variant="ghost" onclick={() => removePrice(m)}>Quitar</Button>
					</div>
				{/each}
				<div class="mt-2 grid grid-cols-[2fr_1fr_1fr_auto] gap-2">
					<Field bind:value={priceForm.model} placeholder="modelo" mono />
					<Field bind:value={priceForm.input} placeholder="entrada" inputmode="decimal" />
					<Field bind:value={priceForm.output} placeholder="salida" inputmode="decimal" />
					<Button variant="secondary" onclick={addPrice}>Añadir</Button>
				</div>
			</details>
		</section>

		<!-- Estudio -->
		<section class={section}>
			<h2 class="mb-3 font-semibold">Estudio</h2>
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
						<label class="flex min-h-9 items-center gap-2 rounded-full border border-slate-300 px-3 text-sm">
							<input
								type="checkbox"
								checked={f === 'recognition' || settings.defaultFacets.includes(f as Facet)}
								disabled={f === 'recognition'}
								onchange={() => toggleDefaultFacet(f as Facet)}
								class="accent-sky-600"
							/>
							{label}
						</label>
					{/each}
				</div>
				<p class="mt-1 text-xs text-slate-500">«Producir» usa el juez IA cuando tu respuesta no coincide exactamente.</p>
			</fieldset>

			<h3 class="mt-4 mb-1 text-sm font-semibold">Meta de retención (FSRS)</h3>
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

			<h3 class="mt-4 mb-1 text-sm font-semibold">Calibrar FSRS con tu historial</h3>
			<p class="text-sm text-slate-500">
				Ajusta el algoritmo a tu memoria (fsrs-rs en tu navegador). Requiere ≥ {MIN_REVIEWS_OPTIMIZE} repasos; tienes {reviews}.
				{settings.fsrsParams ? 'Ahora usas parámetros propios.' : 'Ahora usas los parámetros por defecto.'}
			</p>
			<div class="mt-2 flex flex-wrap gap-2">
				<Button variant="secondary" loading={calibrating} disabled={reviews < MIN_REVIEWS_OPTIMIZE} onclick={runCalibration}>Calibrar</Button>
				{#if settings.fsrsParams}<Button variant="ghost" disabled={calibrating} onclick={() => applyParams(null)}>Volver a los por defecto</Button>{/if}
			</div>
			{#if calibration}
				<div class="mt-2 rounded-lg bg-sky-50 p-3 text-sm">
					<p>Con tus {calibration.reviews} repasos, los próximos 30 días tendrían <b>{calibration.workloadAfter}</b> repasos (ahora: {calibration.workloadBefore}).</p>
					<div class="mt-2 flex gap-2">
						<Button loading={calibrating} onclick={() => calibration && applyParams(calibration.params)}>Aplicar y reprogramar</Button>
						<Button variant="ghost" onclick={() => (calibration = null)}>Descartar</Button>
					</div>
				</div>
			{/if}
		</section>

		<!-- Voz -->
		<section class={section}>
			<h2 class="mb-1 font-semibold">Voz (TTS del sistema)</h2>
			{#if !ttsSupported()}
				<p class="text-sm text-red-600">Tu navegador no soporta síntesis de voz.</p>
			{:else}
				<div class="grid gap-3">
					<div class="flex items-end gap-2">
						<Select label="Japonés" value={settings.ttsVoiceURI} onchange={(e) => save('ttsVoiceURI', (e.currentTarget as HTMLSelectElement).value)} class="flex-1">
							<option value="">(Predeterminada del sistema)</option>
							{#each voices as v (v.voiceURI)}<option value={v.voiceURI}>{v.name} — {v.lang}</option>{/each}
						</Select>
						<Button onclick={() => speakJapanese('こんにちは。元気ですか。')}>Probar</Button>
					</div>
					{#if !voices.length}<p class="text-sm text-slate-500">No hay voces ja-JP instaladas en el sistema (usa «Audio natural» con Gemini).</p>{/if}
					<div class="flex items-end gap-2">
						<Select
							label="Español (explicaciones leídas en voz alta)"
							value={settings.ttsVoiceEsURI}
							onchange={(e) => save('ttsVoiceEsURI', (e.currentTarget as HTMLSelectElement).value)}
							class="flex-1"
						>
							<option value="">(Predeterminada)</option>
							{#each esVoices as v (v.voiceURI)}<option value={v.voiceURI}>{v.name} — {v.lang}</option>{/each}
						</Select>
						<Button onclick={() => speakMixed('食べる significa comer.')}>Probar</Button>
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
		</section>

		<!-- Apariencia -->
		<section class={section}>
			<h2 class="mb-2 font-semibold">Apariencia</h2>
			<div class="flex rounded-full border border-slate-300 p-0.5 text-sm" role="radiogroup" aria-label="Tema">
				{#each [['light', '☀ Claro'], ['dark', '☾ Oscuro'], ['system', 'Sistema']] as [v, label] (v)}
					<button
						role="radio"
						aria-checked={theme.pref === v}
						class="min-h-9 flex-1 rounded-full px-3 font-medium transition {theme.pref === v ? 'bg-brand text-brand-fg' : 'text-slate-600 hover:bg-slate-100'}"
						onclick={() => theme.set(v as ThemePref)}>{label}</button
					>
				{/each}
			</div>
			<p class="mt-1 text-xs text-slate-500">Se guarda en este dispositivo.</p>
		</section>

		<!-- Datos y copias -->
		<section class={section}>
			<h2 class="mb-1 font-semibold">Datos y copias</h2>
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

			<h3 class="mt-3 mb-1 text-sm font-semibold">Copias en este navegador</h3>
			{#if backups.length}
				<ul class="divide-y divide-slate-100 text-sm">
					{#each backups as b (b.id)}
						<li class="flex flex-wrap items-center gap-2 py-2">
							<span class="min-w-0 flex-1">
								{new Date(b.createdAt).toLocaleString()} · {KIND_LABELS[b.kind]}{b.light ? ' (ligera)' : ''} · {fmtBytes(b.size)}
								<span class="block text-xs text-slate-400">{b.counts.cards ?? 0} tarjetas · {b.counts.reviewLogs ?? 0} repasos</span>
							</span>
							<Button variant="ghost" onclick={() => downloadBlob(b.blob, `yomigaeru-copia-${new Date(b.createdAt).toISOString().slice(0, 10)}.json`)}>⇩</Button>
							<Button variant="secondary" onclick={() => (pendingRestore = b)}>Restaurar</Button>
							<Button variant="ghost" onclick={() => removeBackup(b)}>🗑</Button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-sm text-slate-400">Aún no hay copias.</p>
			{/if}

			<h3 class="mt-4 mb-1 text-sm font-semibold">Almacenamiento</h3>
			<p class="text-sm text-slate-500">
				{#if storage}Usado: {fmtBytes(storage.usage)} de {fmtBytes(storage.quota)}.{/if}
				{persisted ? 'Protegido: el navegador no lo borrará por falta de espacio.' : 'Sin protección: el navegador podría borrarlo si falta espacio.'}
			</p>
			{#if persisted === false}<Button variant="secondary" class="mt-2" onclick={askPersist}>Pedir protección</Button>{/if}
		</section>

		<!-- App -->
		<section class={section}>
			<h2 class="mb-1 font-semibold">App</h2>
			<p class="text-sm text-slate-500">Versión {version}. Si algo no carga tras una actualización, «Forzar actualización» vuelve a descargar la app sin tocar tus datos.</p>
			<Button variant="secondary" class="mt-2" onclick={() => forceReload()}>Forzar actualización</Button>
		</section>
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
