<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';

	// `mobile: false` = solo en la barra de escritorio (en móvil se llega desde Inicio).
	const links = [
		{ href: '/', icon: '蘇', label: 'Inicio', mobile: true },
		{ href: '/estudio', icon: '本', label: 'Estudio', mobile: true },
		{ href: '/mazos', icon: '⊞', label: 'Mazos', mobile: true },
		{ href: '/crear', icon: '＋', label: 'Crear', mobile: true },
		{ href: '/foto', icon: '📷', label: 'Foto', mobile: true },
		{ href: '/estadisticas', icon: '📊', label: 'Estadísticas', mobile: false },
		{ href: '/ajustes', icon: '⚙', label: 'Ajustes', mobile: true },
	];
	const mobileLinks = links.filter((l) => l.mobile);

	function isActive(href: string): boolean {
		const path = page.url.pathname.slice(base.length) || '/';
		return href === '/' ? path === '/' : path.startsWith(href);
	}

	function url(href: string): string {
		return `${base}${href === '/' ? '/' : href}`;
	}
</script>

<!-- Escritorio: barra superior sticky -->
<nav class="bg-surface/90 sticky top-0 z-10 hidden border-b border-slate-200 backdrop-blur sm:block">
	<div class="mx-auto flex max-w-3xl items-center gap-1 overflow-x-auto px-3 py-2">
		{#each links as link (link.href)}
			<a
				href={url(link.href)}
				class="rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition {isActive(link.href) ? 'bg-brand text-brand-fg' : 'text-slate-600 hover:bg-slate-100'}"
			>
				{link.icon}
				{link.label}
			</a>
		{/each}
	</div>
</nav>

<!-- Móvil: bottom tab bar fija -->
<nav class="pb-safe bg-surface/95 fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 backdrop-blur sm:hidden">
	<div class="mx-auto grid max-w-3xl grid-cols-6">
		{#each mobileLinks as link (link.href)}
			<a
				href={url(link.href)}
				aria-current={isActive(link.href) ? 'page' : undefined}
				class="flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[0.65rem] font-medium transition {isActive(link.href)
					? 'text-slate-900'
					: 'text-slate-400 hover:text-slate-600'}"
			>
				<span class="text-lg leading-none">{link.icon}</span>
				<span class="leading-none">{link.label}</span>
			</a>
		{/each}
	</div>
</nav>
