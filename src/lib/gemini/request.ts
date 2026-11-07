// Prompts y configuración de las peticiones JSON (puro: lo comparten la app y `bun run test:gemini`,
// así el script real prueba exactamente la misma petición).
import { ThinkingLevel, type GenerateContentConfig, type Schema } from '@google/genai';
import { RETRY_HINT } from './cardgen';
import { LIMITS, type GeneratedCard } from './schemas';

export interface InlineImage {
	mimeType: string;
	/** Datos en base64 sin el prefijo `data:...;base64,`. */
	base64: string;
}

export interface RefineOptions {
	/** Instrucción extra del usuario para ajustar la extracción. */
	instruction?: string;
	/** Tarjetas propuestas en la extracción previa, para que la IA las ajuste. */
	previous?: GeneratedCard[];
}

/** ¿El modelo es de la serie Gemini 3 o posterior (búsqueda + JSON, `thinkingLevel`)? */
export function isGen3Plus(model: string): boolean {
	const m = model.match(/^gemini-(\d+)/);
	return !!m && Number(m[1]) >= 3;
}

const SEARCH_HINT = '\nSi alguna palabra es poco común, un nombre propio, jerga o un término reciente, verifica su lectura y uso con una búsqueda web.';

export interface JsonRequestInput {
	model: string;
	prompt: string;
	schema: Schema;
	image?: InlineImage;
	webSearch?: boolean;
	maxOutputTokens?: number;
	/** `null` = no tocar el razonamiento del modelo. Por defecto LOW en Gemini 3+. */
	thinking?: ThinkingLevel | null;
}

/** Contenido + config de una petición JSON (sin `abortSignal`). */
export function buildJsonRequest(r: JsonRequestInput): {
	contents: { role: 'user'; parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] }[];
	config: GenerateContentConfig;
} {
	const gen3 = isGen3Plus(r.model);
	const search = !!r.webSearch && gen3;
	const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [{ text: search ? r.prompt + SEARCH_HINT : r.prompt }];
	if (r.image) parts.push({ inlineData: { mimeType: r.image.mimeType, data: r.image.base64 } });
	const config: GenerateContentConfig = {
		responseMimeType: 'application/json',
		responseSchema: r.schema,
		maxOutputTokens: r.maxOutputTokens ?? 8192,
	};
	// Razonamiento bajo: menos latencia y costo; el JSON ya está guiado por el esquema.
	const thinking = r.thinking === undefined ? ThinkingLevel.LOW : r.thinking;
	if (gen3 && thinking) config.thinkingConfig = { thinkingLevel: thinking };
	// La búsqueda web (grounding) solo es compatible con salida JSON desde Gemini 3. Se cobra aparte.
	if (search) config.tools = [{ googleSearch: {} }];
	return { contents: [{ role: 'user', parts }], config };
}

// --- Prompts ---

export const FIELDS = `   - "front": la palabra/frase en japonés con furigana en notación Anki (kanji seguido de lectura entre corchetes, ej: 私[わたし]). Solo la palabra, sin la oración.
   - "reading": lectura en kana (solo hiragana/katakana).
   - "back": significado breve en español.
   - "context": la oración original donde aparece, tal cual (con furigana Anki sobre sus kanji).
   - "examples": lista vacía [] (no hacen falta ejemplos aquí).`;

function refineBlock(opts: RefineOptions): string {
	let out = '';
	if (opts.previous?.length) {
		out += `\n\nEsta es una segunda pasada. Estas son las tarjetas propuestas antes (JSON):
${JSON.stringify(opts.previous.map(({ front, reading, back, context }) => ({ front, reading, back, context })))}
Ajústalas según la instrucción del usuario en vez de empezar de cero: conserva lo que sirve, corrige o reemplaza el resto.`;
	}
	if (opts.instruction?.trim()) out += `\n\nInstrucción del usuario: "${opts.instruction.trim()}"`;
	out += `\nCada campo debe ser breve y sin repetir texto. Responde solo con el JSON.`;
	return out;
}

const retry = (attempt: number) => (attempt > 0 ? `\n${RETRY_HINT}` : '');

export function imagePrompt(opts: RefineOptions, attempt: number): string {
	return `Esta imagen contiene texto en japonés (captura de pantalla, foto de libro, manga, subtítulo, cartel, etc.).
1. Extrae el texto japonés relevante.
2. Elige las palabras o expresiones más útiles para un estudiante (evita partículas sueltas y trivialidades).
3. Para cada una crea una tarjeta en "cards" con:
${FIELDS}
   - "box": la caja que rodea esa palabra en la imagen, como [ymin, xmin, ymax, xmax] normalizada de 0 a 1000. Si la palabra aparece varias veces, usa la primera aparición.
Devuelve entre 1 y 10 tarjetas.${refineBlock(opts)}${retry(attempt)}`;
}

export function textPrompt(text: string, opts: RefineOptions, attempt: number): string {
	return `Este es un texto en japonés que un estudiante hispanohablante quiere estudiar:
"""
${text.slice(0, 8000)}
"""
1. Elige las palabras o expresiones más útiles para un estudiante (evita partículas sueltas y trivialidades).
2. Para cada una crea una tarjeta en "cards" con:
${FIELDS}
Devuelve entre 1 y ${LIMITS.cards} tarjetas.${refineBlock(opts)}${retry(attempt)}`;
}

export function wordPrompt(input: string, attempt: number): string {
	return `Eres un profesor de japonés. A partir de la entrada del alumno, crea UNA tarjeta de estudio.
Entrada: "${input}"

Reglas:
- "front": la palabra o frase en japonés con furigana en notación Anki (kanji seguido de su lectura entre corchetes, ej: 私[わたし]は 学生[がくせい]). Solo pon furigana sobre kanji.
- "reading": lectura completa en hiragana.
- "back": significado claro y conciso en español.
- "context": una breve nota de uso o gramática en español.
- "examples": 1 a 2 oraciones de ejemplo (jp con furigana, es traducción).
Cada campo debe ser breve y sin repetir texto. Responde solo con el JSON.${retry(attempt)}`;
}

/** Límite por string para el detector de bucles en tarjetas. */
export const CARD_LOOP = { maxString: LIMITS.context * 3 };
