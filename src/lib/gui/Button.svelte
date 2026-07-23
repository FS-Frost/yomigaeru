<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
	type Size = 'md' | 'lg';

	let {
		variant = 'primary',
		size = 'md',
		full = false,
		loading = false,
		type = 'button',
		disabled = false,
		class: className = '',
		children,
		...rest
	}: {
		variant?: Variant;
		size?: Size;
		full?: boolean;
		loading?: boolean;
		type?: 'button' | 'submit' | 'reset';
		disabled?: boolean;
		class?: string;
		children: Snippet;
	} & HTMLButtonAttributes = $props();

	const variants: Record<Variant, string> = {
		primary: 'bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950',
		secondary: 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 active:bg-slate-100',
		danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800',
		ghost: 'text-slate-700 hover:bg-slate-100 active:bg-slate-200',
	};
	const sizes: Record<Size, string> = {
		md: 'min-h-11 px-4 text-sm',
		lg: 'min-h-12 px-5 text-base',
	};
</script>

<button
	{type}
	disabled={disabled || loading}
	class="inline-flex items-center justify-center gap-2 rounded-lg font-medium transition select-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 {variants[
		variant
	]} {sizes[size]} {full ? 'w-full' : ''} {className}"
	{...rest}
>
	{#if loading}
		<span class="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>
	{/if}
	{@render children()}
</button>
