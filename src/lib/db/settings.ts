import { db, type Facet } from './schema';

export type AnswerStyle = 'reveal' | 'typed' | 'choice';

/** Claves de configuración conocidas y su tipo. */
export interface SettingsMap {
	apiKey: string;
	geminiModel: string;
	/** Modelo para el audio natural (Gemini TTS). */
	ttsModel: string;
	/** Voz preconstruida de Gemini TTS. */
	ttsGeminiVoice: string;
	ttsVoiceURI: string;
	/** Voz española para lecturas mixtas (explicaciones). */
	ttsVoiceEsURI: string;
	ttsRate: number;
	requestRetention: number;
	/** Tarjetas (caras) nuevas por día. */
	newPerDay: number;
	answerStyle: AnswerStyle;
	/** Caras que se activan al crear una tarjeta (si la tarjeta las admite). */
	defaultFacets: Facet[];
	autoBackup: boolean;
	/** Presupuesto mensual de Gemini en USD (0 = sin límite). */
	monthlyBudgetUsd: number;
	/** Bloquear llamadas al superar el presupuesto. */
	budgetHardStop: boolean;
	/** Precios propios por modelo (USD por millón de tokens). */
	modelPrices: Record<string, { input: number; output: number }>;
	/** Parámetros FSRS calibrados con el historial (null = por defecto). */
	fsrsParams: number[] | null;
}

export const DEFAULTS: SettingsMap = {
	apiKey: '',
	geminiModel: 'gemini-3-flash-preview',
	ttsModel: 'gemini-2.5-flash-preview-tts',
	ttsGeminiVoice: 'Kore',
	ttsVoiceURI: '',
	ttsVoiceEsURI: '',
	ttsRate: 0.95,
	requestRetention: 0.9,
	newPerDay: 20,
	answerStyle: 'reveal',
	defaultFacets: ['recognition', 'cloze', 'visual'],
	autoBackup: true,
	monthlyBudgetUsd: 0,
	budgetHardStop: false,
	modelPrices: {},
	fsrsParams: null,
};

export async function getSetting<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]> {
	const row = await db.settings.get(key);
	return (row?.value as SettingsMap[K]) ?? DEFAULTS[key];
}

export async function setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void> {
	await db.settings.put({ key, value: plainCopy(value) });
}

/** Copia plana (sin proxies de runes) apta para IndexedDB. */
function plainCopy<T>(v: T): T {
	return v === null || typeof v !== 'object' ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export async function getAllSettings(): Promise<SettingsMap> {
	const rows = await db.settings.toArray();
	const map = { ...DEFAULTS };
	for (const row of rows) {
		(map as Record<string, unknown>)[row.key] = row.value;
	}
	return map;
}
