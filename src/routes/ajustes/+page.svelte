<script lang="ts">
	import { onMount } from 'svelte';
	import { getAllSettings, setSetting, type SettingsMap } from '$lib/db/settings';
	import { listJapaneseVoices, speakJapanese, ttsSupported } from '$lib/media/tts';
	import { downloadBackup, importBackup } from '$lib/db/backup';
	import { app } from '$lib/state/app.svelte';
	import Button from '$lib/gui/Button.svelte';
	import Field from '$lib/gui/Field.svelte';
	import Select from '$lib/gui/Select.svelte';
	import ConfirmDialog from '$lib/gui/ConfirmDialog.svelte';

	// Archivo pendiente de confirmación de importación.
	let pendingImport = $state<File | null>(null);

	function onImportPicked(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // permite re-elegir el mismo archivo
		if (file) pendingImport = file;
	}

	async function runImport() {
		if (!pendingImport) return;
		const file = pendingImport;
		pendingImport = null;
		try {
			await importBackup(file);
			app.toast('Backup importado', 'success');
		} catch {
			app.toast('Archivo de backup inválido', 'error');
		}
	}

	let settings = $state<SettingsMap | null>(null);
	let voices = $state<SpeechSynthesisVoice[]>([]);

	onMount(async () => {
		settings = await getAllSettings();
		if (ttsSupported()) voices = await listJapaneseVoices();
	});

	async function save<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]) {
		await setSetting(key, value);
		if (settings) settings[key] = value;
		await app.loadSettings();
		app.toast('Guardado', 'success');
	}
</script>

<h1 class="mb-4 text-2xl font-bold">Ajustes</h1>

{#if settings}
	<div class="space-y-6">
		<!-- API key Gemini -->
		<section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
			<h2 class="mb-1 font-semibold">Gemini API Key</h2>
			<p class="mb-3 text-sm text-slate-500">
				Se guarda solo en este dispositivo (IndexedDB). Las llamadas van directo desde tu navegador a Google, así que la clave es visible en las
				herramientas de desarrollo. Úsala solo en un equipo de confianza.
			</p>
			<Field
				type="password"
				mono
				value={settings.apiKey}
				placeholder="AIza…"
				onchange={(e) => save('apiKey', (e.currentTarget as HTMLInputElement).value)}
			/>
			<div class="mt-3">
				<Field
					label="Modelo"
					mono
					value={settings.geminiModel}
					onchange={(e) => save('geminiModel', (e.currentTarget as HTMLInputElement).value)}
				/>
			</div>
		</section>

		<!-- Voz TTS -->
		<section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
			<h2 class="mb-1 font-semibold">Voz japonesa (TTS)</h2>
			{#if !ttsSupported()}
				<p class="text-sm text-red-600">Tu navegador no soporta síntesis de voz.</p>
			{:else if voices.length === 0}
				<p class="text-sm text-slate-500">No se encontraron voces ja-JP instaladas en el sistema.</p>
			{:else}
				<div class="flex gap-2">
					<Select
						value={settings.ttsVoiceURI}
						onchange={(e) => save('ttsVoiceURI', (e.currentTarget as HTMLSelectElement).value)}
						class="flex-1"
					>
						<option value="">(Predeterminada del sistema)</option>
						{#each voices as v}
							<option value={v.voiceURI}>{v.name} — {v.lang}</option>
						{/each}
					</Select>
					<Button onclick={() => speakJapanese('こんにちは。元気ですか。')}>Probar</Button>
				</div>
			{/if}
		</section>

		<!-- Retención FSRS -->
		<section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
			<h2 class="mb-1 font-semibold">Meta de retención (FSRS)</h2>
			<p class="mb-3 text-sm text-slate-500">Probabilidad objetivo de recordar al momento del repaso. Más alto = repasos más frecuentes.</p>
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
		</section>

		<!-- Backup -->
		<section class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
			<h2 class="mb-1 font-semibold">Backup</h2>
			<p class="mb-3 text-sm text-slate-500">Exporta o restaura todos tus mazos, tarjetas y progreso en un archivo JSON.</p>
			<div class="flex gap-2">
				<Button onclick={() => downloadBackup()}>Exportar</Button>
				<label class="inline-flex min-h-11 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-medium transition select-none hover:bg-slate-50 active:scale-[.98]">
					Importar
					<input type="file" accept="application/json,.json" class="hidden" onchange={onImportPicked} />
				</label>
			</div>
		</section>
	</div>
{/if}

<ConfirmDialog
	open={pendingImport !== null}
	variant="primary"
	title="¿Importar backup?"
	message="Reemplazará tus mazos, tarjetas y progreso actuales por los del archivo."
	confirmLabel="Importar"
	oncancel={() => (pendingImport = null)}
	onconfirm={runImport}
/>
