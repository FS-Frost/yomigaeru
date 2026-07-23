<script lang="ts">
	import { fade } from 'svelte/transition';

	let {
		open = $bindable(false),
		oncapture,
		onclose,
	}: {
		open?: boolean;
		oncapture: (blob: Blob) => void;
		onclose?: () => void;
	} = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let stream: MediaStream | null = null;
	let error = $state('');
	let starting = $state(false);
	let facingMode = $state<'environment' | 'user'>('environment');

	// Arranca la cámara al abrir y la detiene al cerrar/desmontar.
	$effect(() => {
		if (open) {
			startCamera();
		}
		return () => stopCamera();
	});

	async function startCamera() {
		error = '';
		starting = true;
		try {
			if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
				error = 'Tu navegador no soporta la cámara o el sitio no es seguro (HTTPS).';
				return;
			}
			stopCamera();
			stream = await navigator.mediaDevices.getUserMedia({
				video: { facingMode },
				audio: false,
			});
			if (video) {
				video.srcObject = stream;
				await video.play();
			}
		} catch (err) {
			const name = err instanceof DOMException ? err.name : '';
			if (name === 'NotAllowedError' || name === 'SecurityError') {
				error = 'Permiso de cámara denegado. Habilítalo en los ajustes del navegador.';
			} else if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') {
				error = 'No se encontró ninguna cámara en este dispositivo.';
			} else {
				error = 'No se pudo iniciar la cámara.';
			}
		} finally {
			starting = false;
		}
	}

	function stopCamera() {
		stream?.getTracks().forEach((t) => t.stop());
		stream = null;
		if (video) video.srcObject = null;
	}

	function close() {
		stopCamera();
		open = false;
		onclose?.();
	}

	async function switchCamera() {
		facingMode = facingMode === 'environment' ? 'user' : 'environment';
		await startCamera();
	}

	function capture() {
		if (!video || !video.videoWidth) return;
		const canvas = document.createElement('canvas');
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			error = 'No se pudo capturar la imagen.';
			return;
		}
		ctx.drawImage(video, 0, 0);
		canvas.toBlob(
			(blob) => {
				if (blob) {
					oncapture(blob);
					close();
				} else {
					error = 'No se pudo capturar la imagen.';
				}
			},
			'image/jpeg',
			0.92,
		);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}
</script>

<svelte:window onkeydown={open ? onkeydown : undefined} />

{#if open}
	<div class="fixed inset-0 z-50 flex flex-col bg-black" transition:fade={{ duration: 150 }} role="dialog" aria-modal="true" aria-label="Cámara">
		<!-- Vídeo en vivo -->
		<div class="relative flex-1 overflow-hidden">
			<video bind:this={video} autoplay playsinline muted class="h-full w-full object-cover"></video>

			{#if error}
				<div class="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-6 text-center">
					<p class="text-sm text-white">{error}</p>
					<button type="button" onclick={close} class="min-h-11 rounded-lg bg-white px-5 text-sm font-medium text-slate-900 active:scale-[.98]">
						Cerrar
					</button>
				</div>
			{:else if starting}
				<div class="absolute inset-0 flex items-center justify-center bg-black/60">
					<span class="inline-block size-8 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true"></span>
				</div>
			{/if}

			<!-- Cambiar cámara -->
			{#if !error}
				<button
					type="button"
					onclick={switchCamera}
					aria-label="Cambiar cámara"
					class="absolute top-4 right-4 flex size-11 items-center justify-center rounded-full bg-black/50 text-xl text-white active:scale-[.98]"
				>
					🔄
				</button>
			{/if}
		</div>

		<!-- Controles -->
		<div class="pb-safe flex items-center justify-between gap-4 bg-black px-6 py-5">
			<button type="button" onclick={close} class="min-h-11 px-3 text-sm font-medium text-white/80 active:scale-[.98]">
				Cancelar
			</button>

			<button
				type="button"
				onclick={capture}
				disabled={!!error || starting}
				aria-label="Capturar foto"
				class="flex size-16 items-center justify-center rounded-full border-4 border-white bg-white/20 transition active:scale-95 disabled:opacity-40"
			>
				<span class="size-12 rounded-full bg-white"></span>
			</button>

			<div class="w-16" aria-hidden="true"></div>
		</div>
	</div>
{/if}
