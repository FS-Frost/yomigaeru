<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'default' | 'danger' | 'accent';

	let {
		label,
		variant = 'default',
		disabled = false,
		class: className = '',
		children,
		...rest
	}: {
		/** aria-label obligatorio: el contenido es un glifo. */
		label: string;
		variant?: Variant;
		disabled?: boolean;
		class?: string;
		children: Snippet;
	} & HTMLButtonAttributes = $props();

	const variants: Record<Variant, string> = {
		default: 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 active:bg-slate-200',
		danger: 'text-red-600 hover:bg-red-50 active:bg-red-100',
		accent: 'text-sky-600 hover:bg-sky-50 active:bg-sky-100',
	};
</script>

<button
	type="button"
	aria-label={label}
	title={label}
	{disabled}
	class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-xl leading-none transition select-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none active:scale-95 disabled:pointer-events-none disabled:opacity-50 {variants[
		variant
	]} {className}"
	{...rest}
>
	{@render children()}
</button>
