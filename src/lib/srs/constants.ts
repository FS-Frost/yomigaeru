// Umbrales del SRS en un único sitio (la UI y la documentación los citan desde aquí).

/** Con tantos repasos vencidos, el cupo de nuevas se reduce a la mitad. */
export const BRAKE_HALF = 80;
/** Con tantos repasos vencidos, no entran nuevas hoy. */
export const BRAKE_STOP = 150;
/** Fallos (lapses) a partir de los cuales una cara se considera «sanguijuela». */
export const LEECH_LAPSES = 6;
/** Estabilidad (días) a partir de la cual una cara se considera dominada. */
export const MASTERED_DAYS = 21;
/** Cada cuántos repasos se intercala una nueva en la sesión. */
export const NEW_EVERY = 4;
/** Tamaño máximo de una sesión de estudio. */
export const SESSION_LIMIT = 200;
/** Días que dura una pausa rápida. */
export const PAUSE_DAYS = 7;
/** Repasos mínimos para que la calibración FSRS tenga sentido. */
export const MIN_REVIEWS_OPTIMIZE = 400;
/** Retención de copias automáticas (días). */
export const BACKUP_RETENTION_DAYS = 7;

export const DAY_MS = 86_400_000;

/** Inicio del día local de `now` (epoch ms). */
export function startOfDay(now: number = Date.now()): number {
	const d = new Date(now);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}
