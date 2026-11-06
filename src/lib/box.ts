// Cajas normalizadas 0–1000 en formato Gemini [ymin, xmin, ymax, xmax]: mover, redimensionar y dibujar.
// Funciones puras (testeadas) usadas por el editor de cajas.
import type { Box } from '$lib/db/schema';

/** Lado mínimo de una caja (en unidades 0–1000). */
export const MIN_SIDE = 15;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Desplaza la caja sin que salga de la imagen. */
export function moveBox([y0, x0, y1, x1]: Box, dx: number, dy: number): Box {
	const ddx = clamp(dx, -x0, 1000 - x1);
	const ddy = clamp(dy, -y0, 1000 - y1);
	return [Math.round(y0 + ddy), Math.round(x0 + ddx), Math.round(y1 + ddy), Math.round(x1 + ddx)];
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

/** Arrastra una esquina; respeta el lado mínimo y los bordes. */
export function resizeBox([y0, x0, y1, x1]: Box, corner: Corner, dx: number, dy: number): Box {
	if (corner === 'nw' || corner === 'sw') x0 = clamp(x0 + dx, 0, x1 - MIN_SIDE);
	else x1 = clamp(x1 + dx, x0 + MIN_SIDE, 1000);
	if (corner === 'nw' || corner === 'ne') y0 = clamp(y0 + dy, 0, y1 - MIN_SIDE);
	else y1 = clamp(y1 + dy, y0 + MIN_SIDE, 1000);
	return [Math.round(y0), Math.round(x0), Math.round(y1), Math.round(x1)];
}

/** Caja a partir de dos puntos (dibujar arrastrando), en cualquier dirección. Null si es demasiado pequeña. */
export function boxFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Box | null {
	const x0 = clamp(Math.min(a.x, b.x), 0, 1000);
	const x1 = clamp(Math.max(a.x, b.x), 0, 1000);
	const y0 = clamp(Math.min(a.y, b.y), 0, 1000);
	const y1 = clamp(Math.max(a.y, b.y), 0, 1000);
	if (x1 - x0 < MIN_SIDE || y1 - y0 < MIN_SIDE) return null;
	return [Math.round(y0), Math.round(x0), Math.round(y1), Math.round(x1)];
}
