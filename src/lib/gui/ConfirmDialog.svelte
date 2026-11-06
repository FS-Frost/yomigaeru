<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Button from './Button.svelte';
	import Field from './Field.svelte';

	let {
		open = $bindable(false),
		title,
		message = '',
		confirmLabel = 'Confirmar',
		cancelLabel = 'Cancelar',
		variant = 'danger',
		requireText = '',
		onconfirm,
		oncancel,
	}: {
		open?: boolean;
		title: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'primary' | 'danger';
		/** Si se indica, hay que escribir esta palabra para confirmar (operaciones destructivas). */
		requireText?: string;
		onconfirm: () => void;
		oncancel?: () => void;
	} = $props();

	let typed = $state('');
	const ok = $derived(!requireText || typed.trim().toUpperCase() === requireText.toUpperCase());

	function confirm() {
		if (!ok) return;
		open = false;
		typed = '';
		onconfirm();
	}
	function cancel() {
		open = false;
		typed = '';
		oncancel?.();
	}
</script>

<Sheet bind:open {title} onclose={cancel}>
	{#if message}
		<p class="mb-4 text-sm text-slate-600">{message}</p>
	{/if}
	{#if requireText}
		<Field label={`Escribe ${requireText} para confirmar`} bind:value={typed} autocomplete="off" class="mb-4" onkeydown={(e) => e.key === 'Enter' && confirm()} />
	{/if}
	<div class="flex flex-col gap-2">
		<Button {variant} size="lg" full disabled={!ok} onclick={confirm}>{confirmLabel}</Button>
		<Button variant="secondary" size="lg" full onclick={cancel}>{cancelLabel}</Button>
	</div>
</Sheet>
