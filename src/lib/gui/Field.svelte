<script lang="ts">
	import type { FullAutoFill } from 'svelte/elements';

	let {
		label = '',
		value = $bindable(''),
		type = 'text',
		placeholder = '',
		rows = 3,
		inputmode,
		autocomplete,
		mono = false,
		onchange,
		onkeydown,
		class: className = '',
	}: {
		label?: string;
		value?: string;
		type?: 'text' | 'password' | 'textarea';
		placeholder?: string;
		rows?: number;
		inputmode?: 'text' | 'search' | 'none' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal';
		autocomplete?: FullAutoFill;
		mono?: boolean;
		onchange?: (e: Event) => void;
		onkeydown?: (e: KeyboardEvent) => void;
		class?: string;
	} = $props();

	// text-base (16px) evita el zoom automático de iOS al enfocar.
	const base =
		'w-full rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 transition placeholder:text-slate-400 focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:outline-none';
</script>

{#snippet control()}
	{#if type === 'textarea'}
		<textarea bind:value {placeholder} {rows} {onchange} class="{base} min-h-24 py-2 {mono ? 'font-mono' : ''}"></textarea>
	{:else}
		<input
			bind:value
			{type}
			{placeholder}
			{inputmode}
			{autocomplete}
			{onchange}
			{onkeydown}
			class="{base} min-h-11 py-2 {mono ? 'font-mono' : ''}"
		/>
	{/if}
{/snippet}

{#if label}
	<label class="block text-sm font-medium text-slate-700 {className}">
		<span class="mb-1 block">{label}</span>
		{@render control()}
	</label>
{:else}
	<div class={className}>{@render control()}</div>
{/if}
