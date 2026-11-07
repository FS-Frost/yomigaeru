import { goto } from '$app/navigation';
import { base } from '$app/paths';
import { getAllSettings, type SettingsMap } from '$lib/db/settings';
import { describeError } from '$lib/errors';

export interface ToastAction {
	label: string;
	run: () => void;
}

export type ToastKind = 'info' | 'success' | 'warn' | 'error';

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
	detail?: string;
	/** Detalle técnico plegable y copiable. */
	tech?: string;
	actions: ToastAction[];
	/** Sin auto-cierre (errores y avisos con acción importante). */
	persistent: boolean;
	/** ms restantes antes del auto-cierre. */
	remaining: number;
	key?: string;
}

export interface ToastOptions {
	/** Botón de acción (p. ej. "Deshacer"). */
	action?: ToastAction;
	actions?: ToastAction[];
	detail?: string;
	/** Detalle técnico plegable y copiable. */
	tech?: string;
	/** Duración en ms antes del auto-cierre. */
	duration?: number;
	/** Reemplaza un toast anterior con la misma clave. */
	key?: string;
	/** No se cierra solo (por defecto los errores). */
	persistent?: boolean;
}

const DEFAULT_MS: Record<ToastKind, number> = { success: 3500, info: 5000, warn: 8000, error: 0 };

/** Estado global de la app (runes). Ajustes cacheados + cola de toasts. */
class AppState {
	settings = $state<SettingsMap | null>(null);
	toasts = $state<Toast[]>([]);
	private nextId = 1;
	private timers = new Map<number, { handle: ReturnType<typeof setTimeout>; started: number }>();

	async loadSettings() {
		this.settings = await getAllSettings();
	}

	/**
	 * Muestra un aviso. Los errores quedan hasta cerrarlos; el resto se cierra solo
	 * (pasar el ratón o enfocar lo pausa). Con `key`, reemplaza el anterior de esa clave.
	 */
	toast(message: string, kind: ToastKind = 'info', opts: ToastOptions = {}): number {
		if (opts.key) for (const t of this.toasts.filter((x) => x.key === opts.key)) this.dismiss(t.id);
		const id = this.nextId++;
		const actions = [...(opts.action ? [opts.action] : []), ...(opts.actions ?? [])];
		const persistent = opts.persistent ?? kind === 'error';
		// Los toasts con acción duran más para dar tiempo a pulsarla.
		const duration = opts.duration ?? (actions.length ? Math.max(DEFAULT_MS[kind], 7000) : DEFAULT_MS[kind]);
		this.toasts.push({ id, kind, message, detail: opts.detail, tech: opts.tech, actions, persistent, remaining: duration, key: opts.key });
		if (!persistent) this.resume(id);
		return id;
	}

	/**
	 * Aviso de error a partir de cualquier excepción (IA, IndexedDB, red…): mensaje claro, acción
	 * adecuada (Reintentar / Ajustes / Copias / Recargar) y detalle técnico plegable.
	 * Una cancelación del usuario no es un error: no muestra nada.
	 */
	error(e: unknown, fallback = 'Algo falló', opts: { retry?: () => void; detail?: string; key?: string } = {}): number | null {
		if ((e as { code?: string } | null)?.code === 'aborted') return null;
		const u = describeError(e, fallback);
		const actions: ToastAction[] = [];
		if (u.action === 'retry' && opts.retry) actions.push({ label: 'Reintentar', run: opts.retry });
		if (u.action === 'settings') actions.push({ label: 'Ajustes', run: () => void goto(`${base}/ajustes#ia`) });
		if (u.action === 'backups') actions.push({ label: 'Copias', run: () => void goto(`${base}/ajustes#datos`) });
		if (u.action === 'reload') actions.push({ label: 'Recargar', run: () => location.reload() });
		return this.toast(u.message, 'error', { actions, tech: u.tech, detail: opts.detail, key: opts.key ?? u.key });
	}

	/** Pausa el auto-cierre (hover/foco). */
	pause(id: number) {
		const t = this.timers.get(id);
		if (!t) return;
		clearTimeout(t.handle);
		this.timers.delete(id);
		const toast = this.toasts.find((x) => x.id === id);
		if (toast) toast.remaining = Math.max(1500, toast.remaining - (Date.now() - t.started));
	}

	/** Reanuda el auto-cierre. */
	resume(id: number) {
		const toast = this.toasts.find((x) => x.id === id);
		if (!toast || toast.persistent || this.timers.has(id)) return;
		this.timers.set(id, { handle: setTimeout(() => this.dismiss(id), toast.remaining), started: Date.now() });
	}

	/** Ejecuta una acción del toast y lo cierra. */
	runAction(id: number, index = 0) {
		const t = this.toasts.find((x) => x.id === id);
		t?.actions[index]?.run();
		this.dismiss(id);
	}

	dismiss(id: number) {
		const t = this.timers.get(id);
		if (t) clearTimeout(t.handle);
		this.timers.delete(id);
		this.toasts = this.toasts.filter((x) => x.id !== id);
	}
}

export const app = new AppState();
