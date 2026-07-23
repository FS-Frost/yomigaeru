<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		value = $bindable(),
		label = '',
		onchange,
		class: className = '',
		children,
	}: {
		value?: string | number | null;
		label?: string;
		onchange?: (e: Event) => void;
		class?: string;
		children: Snippet;
	} = $props();
</script>

{#snippet control()}
	<div class="relative {label ? '' : className}">
		<select
			bind:value
			{onchange}
			class="min-h-11 w-full min-w-0 appearance-none rounded-lg border border-slate-300 bg-white py-2 pr-9 pl-3 text-base text-slate-900 transition focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:outline-none"
		>
			{@render children()}
		</select>
		<span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400" aria-hidden="true">▾</span>
	</div>
{/snippet}

{#if label}
	<label class="block text-sm font-medium text-slate-700 {className}">
		<span class="mb-1 block">{label}</span>
		{@render control()}
	</label>
{:else}
	{@render control()}
{/if}
