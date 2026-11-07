// Voces predefinidas de Gemini TTS (documentación oficial, 2026-11-06) con su estilo en español.
// Todas hablan japonés; cambia el timbre y el carácter.

export interface GeminiVoice {
	name: string;
	style: string;
	/** Timbre aproximado, para agrupar en el selector. */
	pitch: 'grave' | 'media' | 'aguda';
}

export const GEMINI_VOICES: GeminiVoice[] = [
	{ name: 'Kore', style: 'firme', pitch: 'media' },
	{ name: 'Aoede', style: 'ligera', pitch: 'media' },
	{ name: 'Leda', style: 'juvenil', pitch: 'aguda' },
	{ name: 'Zephyr', style: 'brillante', pitch: 'aguda' },
	{ name: 'Puck', style: 'alegre', pitch: 'media' },
	{ name: 'Charon', style: 'informativa', pitch: 'grave' },
	{ name: 'Fenrir', style: 'enérgica', pitch: 'media' },
	{ name: 'Orus', style: 'firme', pitch: 'grave' },
	{ name: 'Callirrhoe', style: 'relajada', pitch: 'media' },
	{ name: 'Autonoe', style: 'brillante', pitch: 'aguda' },
	{ name: 'Enceladus', style: 'susurrante', pitch: 'grave' },
	{ name: 'Iapetus', style: 'clara', pitch: 'grave' },
	{ name: 'Umbriel', style: 'relajada', pitch: 'grave' },
	{ name: 'Algieba', style: 'suave', pitch: 'grave' },
	{ name: 'Despina', style: 'suave', pitch: 'aguda' },
	{ name: 'Erinome', style: 'clara', pitch: 'aguda' },
	{ name: 'Algenib', style: 'rasposa', pitch: 'grave' },
	{ name: 'Rasalgethi', style: 'informativa', pitch: 'media' },
	{ name: 'Laomedeia', style: 'alegre', pitch: 'aguda' },
	{ name: 'Achernar', style: 'dulce', pitch: 'aguda' },
	{ name: 'Alnilam', style: 'firme', pitch: 'grave' },
	{ name: 'Schedar', style: 'pareja', pitch: 'media' },
	{ name: 'Gacrux', style: 'madura', pitch: 'media' },
	{ name: 'Pulcherrima', style: 'directa', pitch: 'media' },
	{ name: 'Achird', style: 'amistosa', pitch: 'media' },
	{ name: 'Zubenelgenubi', style: 'informal', pitch: 'grave' },
	{ name: 'Vindemiatrix', style: 'amable', pitch: 'media' },
	{ name: 'Sadachbia', style: 'vivaz', pitch: 'aguda' },
	{ name: 'Sadaltager', style: 'erudita', pitch: 'grave' },
	{ name: 'Sulafat', style: 'cálida', pitch: 'media' },
];

export function voiceLabel(name: string): string {
	const v = GEMINI_VOICES.find((x) => x.name === name);
	return v ? `${v.name} — ${v.style}` : name;
}

/** Frase corta para «Probar» la voz. */
export const VOICE_SAMPLE = 'こんにちは。今日[きょう]も一緒[いっしょ]に日本語[にほんご]を勉強[べんきょう]しましょう。';
