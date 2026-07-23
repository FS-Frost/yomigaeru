import { generateJson, GeminiError, type InlineImage } from './client';
import { GeneratedCards, cardsGeminiSchema, type GeneratedCard } from './schemas';

export interface RefineOptions {
	/** Instrucción extra del usuario para ajustar la extracción. */
	instruction?: string;
	/** Tarjetas propuestas en la extracción previa, para que la IA las ajuste. */
	previous?: GeneratedCard[];
}

/** Detecta japonés en una imagen y devuelve tarjetas de vocabulario propuestas. */
export async function imageToCards(image: InlineImage, opts: RefineOptions = {}): Promise<GeneratedCards['cards']> {
	let prompt = `Esta imagen contiene texto en japonés (captura de pantalla, foto de libro, subtítulo, etc.).
1. Extrae el texto japonés relevante.
2. Elige las palabras o expresiones más útiles para un estudiante (evita partículas sueltas y trivialidades).
3. Para cada una crea una tarjeta en "cards" con:
   - "front": la palabra/frase en japonés con furigana en notación Anki (kanji seguido de lectura entre corchetes).
   - "reading": lectura en kana.
   - "back": significado en español.
   - "context": la oración original donde aparece (si aplica).
   - "examples": opcional.
Devuelve entre 1 y 10 tarjetas.`;

	if (opts.previous?.length) {
		prompt += `\n\nEsta es una segunda pasada. Estas son las tarjetas propuestas antes (JSON):
${JSON.stringify(opts.previous, null, 2)}
Ajústalas según la instrucción del usuario en vez de empezar de cero: conserva lo que sirve, corrige o reemplaza el resto.`;
	}
	if (opts.instruction?.trim()) {
		prompt += `\n\nInstrucción del usuario: "${opts.instruction.trim()}"`;
	}

	prompt += `\nSi alguna palabra es poco común, un nombre propio, jerga o un término reciente, verifica su lectura y uso con una búsqueda web antes de responder.
Responde solo con el JSON.`;

	const raw = await generateJson({ prompt, schema: cardsGeminiSchema, image, useSearch: true });
	try {
		return GeneratedCards.parse(JSON.parse(raw)).cards;
	} catch {
		throw new GeminiError('La IA devolvió una respuesta con un formato inesperado. Inténtalo de nuevo.');
	}
}
