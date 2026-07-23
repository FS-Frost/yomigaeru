import { stripFurigana } from '$lib/furigana';
import { generateJson } from './client';
import { GrammarBreakdown, grammarGeminiSchema } from './schemas';

export interface GrammarFocus {
	/** La palabra que el estudiante está aprendiendo (sin marcas de furigana). */
	word: string;
	reading?: string;
	meaning?: string;
}

/** Desglosa una oración japonesa en sus componentes gramaticales. */
export async function explainGrammar(sentence: string, focus?: GrammarFocus): Promise<GrammarBreakdown> {
	const clean = stripFurigana(sentence);

	let focusBlock = '';
	if (focus?.word?.trim()) {
		const parts = [focus.word.trim()];
		if (focus.reading?.trim()) parts.push(`lectura: ${focus.reading.trim()}`);
		if (focus.meaning?.trim()) parts.push(`significado: «${focus.meaning.trim()}»`);
		focusBlock = `\nEl estudiante está aprendiendo la palabra: ${parts.join(', ')}.
Enfoca la explicación en cómo se usa esa palabra dentro de la oración y rellena "focusNote" con esa explicación específica (conjugación, partícula que la acompaña, matiz, registro).`;
	}

	const prompt = `Analiza gramaticalmente esta oración japonesa para un estudiante hispanohablante.
Oración: "${clean}"${focusBlock}

- "summary": traducción y sentido general en español.
- "focusNote": explicación enfocada en la palabra que se está aprendiendo (deja vacío si no se indicó ninguna).
- "tokens": divide la oración en fragmentos (partículas, verbos, sustantivos, etc.). Para cada uno: "surface" (el fragmento japonés), "role" (su función), "note" (explicación/matiz en español).
Responde solo con el JSON.`;

	const raw = await generateJson({ prompt, schema: grammarGeminiSchema });
	return GrammarBreakdown.parse(JSON.parse(raw));
}
