<script lang="ts">
	// Campo de respuesta. En modo `kana` convierte romaji a kana mientras se escribe
	// (wanakana IME) para quien no tiene teclado japonés.
	import { romajiToKana } from '$lib/jp';

	let {
		value = $bindable(''),
		kana = false,
		placeholder = '',
		disabled = false,
		autofocus = false,
		onsubmit,
	}: {
		value?: string;
		kana?: boolean;
		placeholder?: string;
		disabled?: boolean;
		autofocus?: boolean;
		onsubmit: () => void;
	} = $props();

	let el = $state<HTMLInputElement | null>(null);

	$effect(() => {
		if (autofocus && el && !disabled) el.focus();
	});

	function oninput(e: Event) {
		if (!kana) return;
		const input = e.currentTarget as HTMLInputElement;
		// Durante composición IME nativa no se toca.
		if ((e as InputEvent).isComposing) return;
		input.value = romajiToKana(input.value);
		value = input.value;
	}
</script>

<input
	bind:this={el}
	bind:value
	{placeholder}
	{disabled}
	lang={kana ? 'ja' : 'es'}
	autocomplete="off"
	autocapitalize="off"
	spellcheck="false"
	class="bg-surface min-h-12 w-full rounded-lg border border-slate-300 px-3 text-center text-lg text-slate-900 transition placeholder:text-slate-400 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:outline-none disabled:opacity-60"
	{oninput}
	onkeydown={(e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			onsubmit();
		}
	}}
/>
