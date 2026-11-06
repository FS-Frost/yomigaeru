import { describe, expect, test } from 'bun:test';
import { boxFromPoints, MIN_SIDE, moveBox, resizeBox } from '$lib/box';

describe('cajas', () => {
	test('mover sin salirse de la imagen', () => {
		expect(moveBox([100, 100, 200, 200], 50, -30)).toEqual([70, 150, 170, 250]);
		expect(moveBox([100, 900, 200, 980], 100, 0)).toEqual([100, 920, 200, 1000]);
		expect(moveBox([10, 10, 50, 50], -100, -100)).toEqual([0, 0, 40, 40]);
	});
	test('redimensionar por esquina con lado mínimo', () => {
		expect(resizeBox([100, 100, 200, 200], 'se', 50, 20)).toEqual([100, 100, 220, 250]);
		expect(resizeBox([100, 100, 200, 200], 'nw', -20, -10)).toEqual([90, 80, 200, 200]);
		expect(resizeBox([100, 100, 200, 200], 'ne', -500, 0)).toEqual([100, 100, 200, 100 + MIN_SIDE]);
		expect(resizeBox([100, 100, 200, 200], 'sw', 0, 2000)).toEqual([100, 100, 1000, 200]);
	});
	test('dibujar en cualquier dirección; demasiado pequeña = null', () => {
		expect(boxFromPoints({ x: 300, y: 400 }, { x: 100, y: 200 })).toEqual([200, 100, 400, 300]);
		expect(boxFromPoints({ x: 100, y: 100 }, { x: 105, y: 300 })).toBeNull();
		expect(boxFromPoints({ x: -50, y: 0 }, { x: 50, y: 1200 })).toEqual([0, 0, 1000, 50]);
	});
});
