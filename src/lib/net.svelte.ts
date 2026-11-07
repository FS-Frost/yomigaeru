// Estado de conexión reactivo: los botones de IA se deshabilitan sin red.

class NetState {
	online = $state(true);
	private started = false;

	init() {
		if (this.started || typeof window === 'undefined') return;
		this.started = true;
		this.online = navigator.onLine;
		window.addEventListener('online', () => (this.online = true));
		window.addEventListener('offline', () => (this.online = false));
	}
}

export const net = new NetState();
