/**
 * Parser de furigana con notación estilo Anki: `漢字[かんじ]`.
 * El texto entre corchetes es la lectura de la palabra inmediatamente anterior.
 * Ejemplo: "私[わたし]は 学生[がくせい]です" produce ruby sobre 私 y 学生.
 */
export interface FuriganaSegment {
	base: string;
	/** Lectura (rt). Ausente = texto plano sin ruby. */
	rt?: string;
}

const TOKEN = /([^\s[\]]+)\[([^\]]+)\]/g;

export function parseFurigana(text: string): FuriganaSegment[] {
	const segments: FuriganaSegment[] = [];
	let lastIndex = 0;
	let match: RegExpExecArray | null;

	TOKEN.lastIndex = 0;
	while ((match = TOKEN.exec(text)) !== null) {
		if (match.index > lastIndex) {
			segments.push({ base: text.slice(lastIndex, match.index) });
		}
		segments.push({ base: match[1], rt: match[2] });
		lastIndex = TOKEN.lastIndex;
	}
	if (lastIndex < text.length) {
		segments.push({ base: text.slice(lastIndex) });
	}
	return segments;
}

/** Texto sin marcas de furigana (para TTS y búsqueda). */
export function stripFurigana(text: string): string {
	return text.replace(TOKEN, '$1');
}
