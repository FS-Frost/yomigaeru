// Tema claro/oscuro/sistema por dispositivo (localStorage, no viaja en backups).
// El script inline de app.html aplica el tema antes de pintar; esto lo mantiene al día.

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'yomigaeru.theme';

function read(): ThemePref {
	try {
		const v = localStorage.getItem(KEY);
		return v === 'light' || v === 'dark' ? v : 'system';
	} catch {
		return 'system';
	}
}

function resolve(pref: ThemePref): 'light' | 'dark' {
	if (pref !== 'system') return pref;
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

class Theme {
	pref = $state<ThemePref>('system');
	current = $state<'light' | 'dark'>('light');

	/** Arranque en el cliente: lee la preferencia y escucha cambios del sistema. */
	init() {
		this.pref = read();
		this.apply();
		window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
			if (this.pref === 'system') this.apply();
		});
	}

	set(pref: ThemePref) {
		this.pref = pref;
		try {
			if (pref === 'system') localStorage.removeItem(KEY);
			else localStorage.setItem(KEY, pref);
		} catch {
			// Sin almacenamiento: el tema vale solo para esta sesión.
		}
		this.apply();
	}

	private apply() {
		this.current = resolve(this.pref);
		document.documentElement.dataset.theme = this.current;
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', this.current === 'dark' ? '#0b1120' : '#0f172a');
	}
}

export const theme = new Theme();
