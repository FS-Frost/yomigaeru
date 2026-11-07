// Pruebas rápidas desde Ajustes: ¿la key funciona?, ¿el modelo existe?, lista de modelos de la key.
import { geminiClient, generateTracked } from './client';
import { classifyModels, type ModelOption } from './models';

/** Llamada mínima (unos pocos tokens) para comprobar key + modelo. Lanza `GeminiError`. */
export async function probeModel(model: string): Promise<void> {
	await generateTracked({ feature: 'probe', model, parts: [{ text: 'Responde solo: OK' }], config: { maxOutputTokens: 64 } });
}

/** Modelos de texto y de voz disponibles para la key guardada. */
export async function listModels(): Promise<{ text: ModelOption[]; tts: ModelOption[] }> {
	const ai = await geminiClient();
	const all = [];
	for await (const m of await ai.models.list({ config: { pageSize: 200 } })) all.push(m);
	return classifyModels(all);
}
