import { generateJson } from './client';
import { GeneratedCard, cardGeminiSchema } from './schemas';

/** Genera una tarjeta completa a partir de una palabra/frase japonesa o en español. */
export async function generateCardFromText(input: string): Promise<GeneratedCard> {
	const prompt = `Eres un profesor de japonés. A partir de la entrada del alumno, crea UNA tarjeta de estudio.
Entrada: "${input}"

Reglas:
- "front": la palabra o frase en japonés con furigana en notación Anki (kanji seguido de su lectura entre corchetes, ej: 私[わたし]は 学生[がくせい]). Solo pon furigana sobre kanji.
- "reading": lectura completa en hiragana.
- "back": significado claro y conciso en español.
- "context": una breve nota de uso o gramática en español.
- "examples": 1 a 2 oraciones de ejemplo (jp con furigana, es traducción).
Responde solo con el JSON.`;

	const raw = await generateJson({ prompt, schema: cardGeminiSchema });
	return GeneratedCard.parse(JSON.parse(raw));
}
