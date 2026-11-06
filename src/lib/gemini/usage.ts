// Registro de uso de Gemini (tokens + costo estimado) y presupuesto. Ref. sensei `gemini/usage.ts`.
import { db, type GeminiUsage } from '$lib/db/schema';
import { getAllSettings } from '$lib/db/settings';
import { costOf, priceFor } from './pricing';

/** Funciones que llaman a Gemini (las claves se guardan: no renombrar). */
export const FEATURES = {
	generateCard: 'Generar tarjeta',
	imageToCards: 'Foto → tarjetas',
	textToCards: 'Texto → tarjetas',
	grammar: 'Explicar gramática',
	judge: 'Juez de producción',
	tts: 'Audio natural',
} as const;
export type Feature = keyof typeof FEATURES;

export interface UsageMeta {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	thoughtsTokenCount?: number;
	cachedContentTokenCount?: number;
}

export class BudgetError extends Error {}

/** Guarda una llamada. Las fallidas cuentan con costo 0. */
export async function recordUsage(call: { feature: Feature; model: string; usage?: UsageMeta; ok?: boolean }): Promise<void> {
	const ok = call.ok ?? true;
	const prompt = call.usage?.promptTokenCount ?? 0;
	// Los tokens de razonamiento se facturan como salida.
	const output = (call.usage?.candidatesTokenCount ?? 0) + (call.usage?.thoughtsTokenCount ?? 0);
	const cached = call.usage?.cachedContentTokenCount ?? 0;
	const { modelPrices } = await getAllSettings();
	const costUsd = ok ? costOf(priceFor(call.model, modelPrices), prompt, output, cached) : 0;
	try {
		await db.geminiUsage.add({ at: Date.now(), feature: call.feature, model: call.model, promptTokens: prompt, outputTokens: output, cachedTokens: cached, ok, costUsd });
	} catch {
		// El registro de costos nunca debe romper la función principal.
	}
}

function startOfMonth(now = Date.now()): number {
	const d = new Date(now);
	return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export interface UsageReport {
	monthUsd: number;
	/** Proyección a fin de mes al ritmo actual. */
	projectedUsd: number;
	calls: number;
	failed: number;
	unpriced: number;
	byFeature: { feature: string; label: string; usd: number; calls: number }[];
	byModel: { model: string; usd: number; calls: number }[];
	byDay: { day: number; usd: number }[];
	recent: GeminiUsage[];
	budget: number;
	/** Fracción del presupuesto gastada (0 si no hay presupuesto). */
	budgetUsed: number;
}

export async function usageReport(now = Date.now()): Promise<UsageReport> {
	const from = startOfMonth(now);
	const rows = await db.geminiUsage.where('at').aboveOrEqual(from).toArray();
	const { monthlyBudgetUsd } = await getAllSettings();
	const sum = (xs: GeminiUsage[]) => xs.reduce((a, r) => a + (r.costUsd ?? 0), 0);
	const monthUsd = sum(rows);
	const d = new Date(now);
	const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
	const elapsed = Math.max(1, (now - from) / 86_400_000);
	const group = <K extends string>(key: (r: GeminiUsage) => K) => {
		const m = new Map<K, GeminiUsage[]>();
		for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
		return m;
	};
	const byFeature = [...group((r) => r.feature)].map(([feature, xs]) => ({
		feature,
		label: FEATURES[feature as Feature] ?? feature,
		usd: sum(xs),
		calls: xs.length,
	}));
	const byModel = [...group((r) => r.model)].map(([model, xs]) => ({ model, usd: sum(xs), calls: xs.length }));
	const byDay: { day: number; usd: number }[] = [];
	for (let i = 0; i < d.getDate(); i++) {
		const start = from + i * 86_400_000;
		byDay.push({ day: i + 1, usd: sum(rows.filter((r) => r.at >= start && r.at < start + 86_400_000)) });
	}
	const recent = await db.geminiUsage.orderBy('at').reverse().limit(20).toArray();
	return {
		monthUsd,
		projectedUsd: (monthUsd / elapsed) * daysInMonth,
		calls: rows.length,
		failed: rows.filter((r) => !r.ok).length,
		unpriced: rows.filter((r) => r.ok && r.costUsd == null).length,
		byFeature: byFeature.sort((a, b) => b.usd - a.usd),
		byModel: byModel.sort((a, b) => b.usd - a.usd),
		byDay,
		recent,
		budget: monthlyBudgetUsd,
		budgetUsed: monthlyBudgetUsd > 0 ? monthUsd / monthlyBudgetUsd : 0,
	};
}

/** Lanza `BudgetError` si hay bloqueo por presupuesto y ya se superó. */
export async function assertBudget(now = Date.now()): Promise<void> {
	const { monthlyBudgetUsd, budgetHardStop } = await getAllSettings();
	if (!budgetHardStop || monthlyBudgetUsd <= 0) return;
	const rows = await db.geminiUsage.where('at').aboveOrEqual(startOfMonth(now)).toArray();
	const spent = rows.reduce((a, r) => a + (r.costUsd ?? 0), 0);
	if (spent >= monthlyBudgetUsd) {
		throw new BudgetError(`Presupuesto mensual de Gemini superado ($${spent.toFixed(2)} de $${monthlyBudgetUsd.toFixed(2)}). Cámbialo en Ajustes.`);
	}
}

/** Costo medio por llamada de una función (para estimar «≈ $…» antes de generar). */
export async function averageCost(feature: Feature): Promise<number | null> {
	const rows = await db.geminiUsage.where('feature').equals(feature).reverse().limit(20).toArray();
	const priced = rows.filter((r) => r.ok && r.costUsd != null);
	if (!priced.length) return null;
	return priced.reduce((a, r) => a + r.costUsd!, 0) / priced.length;
}
