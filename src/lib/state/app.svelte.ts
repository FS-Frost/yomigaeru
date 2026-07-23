import { getAllSettings, type SettingsMap } from '$lib/db/settings';

interface ToastAction {
	label: string;
	run: () => void;
}

interface Toast {
	id: number;
	kind: 'info' | 'error' | 'success';
	message: string;
	action?: ToastAction;
}

interface ToastOptions {
	/** Botón de acción (p. ej. "Deshacer"). */
	action?: ToastAction;
	/** Duración en ms antes del auto-cierre. */
	duration?: number;
}

/** Estado global de la app (runes). Ajustes cacheados + cola de toasts. */
class AppState {
	settings = $state<SettingsMap | null>(null);
	toasts = $state<Toast[]>([]);
	private nextId = 1;

	async loadSettings() {
		this.settings = await getAllSettings();
	}

	toast(message: string, kind: Toast['kind'] = 'info', opts: ToastOptions = {}) {
		const id = this.nextId++;
		this.toasts.push({ id, kind, message, action: opts.action });
		// Los toasts con acción duran más para dar tiempo a pulsarla.
		const duration = opts.duration ?? (opts.action ? 6000 : 4000);
		setTimeout(() => this.dismiss(id), duration);
	}

	/** Ejecuta la acción del toast y lo cierra. */
	runAction(id: number) {
		const t = this.toasts.find((x) => x.id === id);
		t?.action?.run();
		this.dismiss(id);
	}

	dismiss(id: number) {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}
}

export const app = new AppState();
