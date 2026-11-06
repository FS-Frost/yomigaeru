import { generateJson, validate, type InlineImage } from './client';
import { GeneratedCards, cardsGeminiSchema, cardsWithBoxGeminiSchema, type GeneratedCard } from './schemas';

export interface RefineOptions {
	/** Instrucción extra del usuario para ajustar la extracción. */
	instruction?: string;
	/** Tarjetas propuestas en la extracción previa, para que la IA las ajuste. */
	previous?: GeneratedCard[];
}

const FIELDS = `   - "front": la palabra/frase en japonés con furigana en notación Anki (kanji seguido de lectura entre corchetes, ej: 私[わたし]).
   - "reading": lectura en kana.
   - "back": significado en español.
   - "context": la oración original donde aparece, tal cual (con furigana Anki sobre sus kanji).
   - "examples": opcional.`;

function refineBlock(opts: RefineOptions): string {
	let out = '';
	if (opts.previous?.length) {
		out += `\n\nEsta es una segunda pasada. Estas son las tarjetas propuestas antes (JSON):
${JSON.stringify(opts.previous, null, 2)}
Ajústalas según la instrucción del usuario en vez de empezar de cero: conserva lo que sirve, corrige o reemplaza el resto.`;
	}
	if (opts.instruction?.trim()) out += `\n\nInstrucción del usuario: "${opts.instruction.trim()}"`;
	out += `\nSi alguna palabra es poco común, un nombre propio, jerga o un término reciente, verifica su lectura y uso con una búsqueda web antes de responder.
Responde solo con el JSON.`;
	return out;
}

/** Detecta japonés en una imagen y devuelve tarjetas propuestas, con la caja de cada palabra. */
export async function imageToCards(image: InlineImage, opts: RefineOptions = {}): Promise<GeneratedCard[]> {
	const prompt = `Esta imagen contiene texto en japonés (captura de pantalla, foto de libro, manga, subtítulo, cartel, etc.).
1. Extrae el texto japonés relevante.
2. Elige las palabras o expresiones más útiles para un estudiante (evita partículas sueltas y trivialidades).
3. Para cada una crea una tarjeta en "cards" con:
${FIELDS}
   - "box": la caja que rodea esa palabra en la imagen, como [ymin, xmin, ymax, xmax] normalizada de 0 a 1000. Si la palabra aparece varias veces, usa la primera aparición.
Devuelve entre 1 y 10 tarjetas.${refineBlock(opts)}`;

	const raw = await generateJson({ feature: 'imageToCards', prompt, schema: cardsWithBoxGeminiSchema, image, useSearch: true });
	return validate(GeneratedCards, raw).cards;
}

/** Igual que `imageToCards` pero desde un texto japonés pegado (letra, subtítulo, artículo). */
export async function textToCards(text: string, opts: RefineOptions = {}): Promise<GeneratedCard[]> {
	const prompt = `Este es un texto en japonés que un estudiante hispanohablante quiere estudiar:
"""
${text.slice(0, 8000)}
"""
1. Elige las palabras o expresiones más útiles para un estudiante (evita partículas sueltas y trivialidades).
2. Para cada una crea una tarjeta en "cards" con:
${FIELDS}
Devuelve entre 1 y 15 tarjetas.${refineBlock(opts)}`;

	const raw = await generateJson({ feature: 'textToCards', prompt, schema: cardsGeminiSchema, useSearch: true });
	return validate(GeneratedCards, raw).cards;
}
