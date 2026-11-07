<script lang="ts">
	// «Foto» se unificó con «Crear». Se conserva la ruta para enlaces y atajos de apps ya instaladas:
	// redirige a /crear abriendo la cámara (lo pendiente de compartir ya apunta a «crear»).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';

	onMount(() => {
		void goto(`${base}/crear?camara=1`, { replaceState: true });
	});
</script>

<p class="py-10 text-center text-slate-400">Abriendo Crear…</p>
