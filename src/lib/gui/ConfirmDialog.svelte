<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Button from './Button.svelte';

	let {
		open = $bindable(false),
		title,
		message = '',
		confirmLabel = 'Confirmar',
		cancelLabel = 'Cancelar',
		variant = 'danger',
		onconfirm,
		oncancel,
	}: {
		open?: boolean;
		title: string;
		message?: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'primary' | 'danger';
		onconfirm: () => void;
		oncancel?: () => void;
	} = $props();

	function confirm() {
		open = false;
		onconfirm();
	}
	function cancel() {
		open = false;
		oncancel?.();
	}
</script>

<Sheet bind:open {title} onclose={cancel}>
	{#if message}
		<p class="mb-4 text-sm text-slate-600">{message}</p>
	{/if}
	<div class="flex flex-col gap-2">
		<Button {variant} size="lg" full onclick={confirm}>{confirmLabel}</Button>
		<Button variant="secondary" size="lg" full onclick={cancel}>{cancelLabel}</Button>
	</div>
</Sheet>
