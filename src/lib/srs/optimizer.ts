// Calibración de FSRS con TU historial (fsrs-rs en WebAssembly vía fsrs-browser, cargado bajo demanda).
// Ref. sensei `srs/optimizer.ts`.
import { createEmptyCard, Rating, type Grade } from 'ts-fsrs';
import { db, type ReviewLog, type Schedule } from '$lib/db/schema';
import { getAllSettings, setSetting } from '$lib/db/settings';
import { fromFsrsCard, schedulerFor, toFsrsCard, type SchedulerConfig } from './fsrs';
import { DAY_MS, MIN_REVIEWS_OPTIMIZE } from './constants';

type Log = Pick<ReviewLog, 'rating' | 'reviewedAt'>;

/** Historial por programación (tarjeta + cara), en orden cronológico. */
async function historyBySchedule(): Promise<Map<string, Log[]>> {
	const logs = await db.reviewLogs.orderBy('reviewedAt').toArray();
	const out = new Map<string, Log[]>();
	for (const l of logs) {
		if (!l.rating) continue;
		const k = `${l.cardId}:${l.facet ?? 'recognition'}`;
		const list = out.get(k) ?? [];
		list.push(l);
		out.set(k, list);
	}
	return out;
}

export async function reviewCount(): Promise<number> {
	return db.reviewLogs.count();
}

/** Repasos previstos en `days` días respondiendo todo «Bien» (comparación justa entre parámetros). */
function workload(schedules: Omit<Schedule, 'id' | 'cardId' | 'facet'>[], cfg: SchedulerConfig, days = 30, now = Date.now()): number {
	const sched = schedulerFor(cfg, false);
	const end = now + days * DAY_MS;
	let total = 0;
	for (const s of schedules) {
		if (s.state === 0) continue;
		let card = toFsrsCard(s);
		let guard = 0;
		while (card.due.getTime() <= end && guard++ < 60) {
			total++;
			card = sched.next(card, new Date(Math.max(card.due.getTime(), now)), Rating.Good).card;
		}
	}
	return total;
}

/** Reconstruye una programación reproduciendo su historial con otros parámetros. */
function replay(logs: Log[], cfg: SchedulerConfig) {
	const sched = schedulerFor(cfg, false);
	let card = createEmptyCard(new Date(logs[0].reviewedAt));
	for (const l of logs) card = sched.next(card, new Date(l.reviewedAt), l.rating as Grade).card;
	return fromFsrsCard(card);
}

let wasmReady: Promise<unknown> | null = null;

async function computeParameters(items: { rating: number; deltaT: number }[][]): Promise<number[]> {
	const [{ default: init, Fsrs }, { default: wasmUrl }] = await Promise.all([import('fsrs-browser'), import('fsrs-browser/fsrs_browser_bg.wasm?url')]);
	wasmReady ??= init({ module_or_path: wasmUrl });
	await wasmReady;
	const ratings: number[] = [];
	const deltas: number[] = [];
	const lengths: number[] = [];
	for (const it of items) {
		lengths.push(it.length);
		for (const r of it) {
			ratings.push(r.rating);
			deltas.push(r.deltaT);
		}
	}
	const fsrs = new Fsrs();
	try {
		return [...fsrs.computeParameters(new Uint32Array(ratings), new Uint32Array(deltas), new Uint32Array(lengths), null, true)];
	} catch (e) {
		// Un pánico de Rust deja el módulo inservible: se reinicia la próxima vez.
		wasmReady = null;
		const msg = e instanceof Error ? e.message : String(e);
		if (/NotEnoughData/i.test(msg)) throw new Error('Aún no hay suficientes repasos espaciados para calibrar.', { cause: e });
		throw new Error(`La calibración falló: ${msg}`, { cause: e });
	}
}

export interface Calibration {
	reviews: number;
	params: number[];
	workloadBefore: number;
	workloadAfter: number;
}

/** Calcula parámetros propios y compara la carga de los próximos 30 días. No guarda nada. */
export async function calibrate(): Promise<Calibration> {
	const hist = await historyBySchedule();
	const reviews = [...hist.values()].reduce((a, l) => a + l.length, 0);
	if (reviews < MIN_REVIEWS_OPTIMIZE) throw new Error(`Hacen falta al menos ${MIN_REVIEWS_OPTIMIZE} repasos (tienes ${reviews}).`);

	// Un ítem por prefijo de historial con al menos un intervalo > 0 días (formato de fsrs-rs).
	const items: { rating: number; deltaT: number }[][] = [];
	for (const logs of hist.values()) {
		const revs = logs.map((l, i) => ({ rating: l.rating, deltaT: i === 0 ? 0 : Math.max(0, Math.floor((l.reviewedAt - logs[i - 1].reviewedAt) / DAY_MS)) }));
		for (let k = 2; k <= revs.length; k++) {
			const slice = revs.slice(0, k);
			if (slice.slice(1).some((r) => r.deltaT > 0)) items.push(slice);
		}
	}
	if (items.length < 50) throw new Error('Aún no hay suficientes repasos espaciados (de días distintos) para calibrar.');
	const params = (await computeParameters(items)).map((x) => Math.round(x * 10000) / 10000);

	const st = await getAllSettings();
	const schedules = await db.schedules.toArray();
	const before = workload(schedules, { requestRetention: st.requestRetention, params: st.fsrsParams });
	const replayed = schedules.map((s) => {
		const logs = hist.get(`${s.cardId}:${s.facet}`);
		return logs?.length ? replay(logs, { requestRetention: st.requestRetention, params }) : s;
	});
	const after = workload(replayed, { requestRetention: st.requestRetention, params });
	return { reviews, params, workloadBefore: before, workloadAfter: after };
}

/** Guarda los parámetros (null = por defecto) y reprograma cada cara reproduciendo su historial. */
export async function applyCalibration(params: number[] | null): Promise<number> {
	await setSetting('fsrsParams', params);
	const { requestRetention } = await getAllSettings();
	const hist = await historyBySchedule();
	let updated = 0;
	await db.transaction('rw', db.schedules, async () => {
		const all = await db.schedules.toArray();
		for (const s of all) {
			const logs = hist.get(`${s.cardId}:${s.facet}`);
			if (!logs?.length) continue;
			await db.schedules.put({ ...s, ...replay(logs, { requestRetention, params }) });
			updated++;
		}
	});
	return updated;
}
