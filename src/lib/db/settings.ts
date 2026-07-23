import { db } from './schema';

/** Claves de configuración conocidas y su tipo. */
export interface SettingsMap {
	apiKey: string;
	geminiModel: string;
	ttsVoiceURI: string;
	requestRetention: number;
}

const DEFAULTS: SettingsMap = {
	apiKey: '',
	geminiModel: 'gemini-3-flash-preview',
	ttsVoiceURI: '',
	requestRetention: 0.9,
};

export async function getSetting<K extends keyof SettingsMap>(key: K): Promise<SettingsMap[K]> {
	const row = await db.settings.get(key);
	return (row?.value as SettingsMap[K]) ?? DEFAULTS[key];
}

export async function setSetting<K extends keyof SettingsMap>(key: K, value: SettingsMap[K]): Promise<void> {
	await db.settings.put({ key, value });
}

export async function getAllSettings(): Promise<SettingsMap> {
	const rows = await db.settings.toArray();
	const map = { ...DEFAULTS };
	for (const row of rows) {
		(map as Record<string, unknown>)[row.key] = row.value;
	}
	return map;
}
