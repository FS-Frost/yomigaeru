// Interoperabilidad con Anki. La notación de furigana 漢字[かな] es la misma de Anki (Japanese Support),
// así que el TSV exportado se importa tal cual. Funciones de texto puras (testeadas); `.apkg` usa sql.js
// y fflate cargados bajo demanda solo en la importación.
import type { Card } from '$lib/db/schema';

export interface ImportRow {
	front: string;
	back: string;
	reading?: string;
	context?: string;
}

const esc = (s: string | undefined) => (s ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, '<br>');

/** TSV con cabeceras de Anki 2.1.55+ (separador, html, mazo, columnas). */
export function cardsToTsv(cards: Pick<Card, 'front' | 'back' | 'reading' | 'context'>[], deckName: string): string {
	const lines = ['#separator:tab', '#html:true', `#deck:${deckName}`, '#columns:Frente\tSignificado\tLectura\tContexto', '#tags column:5'];
	for (const c of cards) lines.push([esc(c.front), esc(c.back), esc(c.reading), esc(c.context), 'yomigaeru'].join('\t'));
	return lines.join('\n') + '\n';
}

/** Separa una línea CSV respetando comillas. */
function splitCsvLine(line: string, sep: string): string[] {
	if (sep === '\t') return line.split('\t');
	const out: string[] = [];
	let cur = '';
	let q = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (q) {
			if (ch === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (ch === '"') q = false;
			else cur += ch;
		} else if (ch === '"') q = true;
		else if (ch === sep) {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out;
}

/** HTML de Anki → texto: <br> a salto de línea, sin etiquetas, entidades básicas. */
export function htmlToText(s: string): string {
	return s
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(div|p)>/gi, '\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

export interface ParsedTable {
	rows: string[][];
	/** Columnas declaradas en `#columns:` o la primera fila si parece cabecera. */
	header: string[] | null;
	deck: string | null;
}

/** Parsea TSV/CSV (con cabeceras `#…:` de Anki opcionales). */
export function parseTable(text: string, filename = ''): ParsedTable {
	const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/);
	let sep: string | null = filename.toLowerCase().endsWith('.csv') ? ',' : filename.toLowerCase().endsWith('.tsv') ? '\t' : null;
	let header: string[] | null = null;
	let deck: string | null = null;
	const body: string[] = [];
	for (const l of lines) {
		const m = l.match(/^#(\w[\w ]*):(.*)$/);
		if (m) {
			const [, k, v] = m;
			if (k === 'separator') sep = { tab: '\t', comma: ',', semicolon: ';', pipe: '|' }[v.trim().toLowerCase()] ?? v.trim();
			if (k === 'deck') deck = v.trim();
			if (k === 'columns') header = v.split(sep ?? '\t').map((x) => x.trim());
			continue;
		}
		if (l.trim()) body.push(l);
	}
	if (!sep) sep = body[0]?.includes('\t') ? '\t' : body[0]?.includes(';') && !body[0]?.includes(',') ? ';' : ',';
	const rows = body.map((l) => splitCsvLine(l, sep!).map(htmlToText));
	return { rows, header, deck };
}

export interface ColumnMap {
	front: number;
	back: number;
	reading: number | null;
	context: number | null;
}

/** Adivina el mapeo de columnas por nombre de cabecera o, si no, por contenido. */
export function guessColumns(t: ParsedTable): ColumnMap {
	const h = t.header?.map((x) => x.toLowerCase()) ?? [];
	const find = (re: RegExp) => {
		const i = h.findIndex((x) => re.test(x));
		return i >= 0 ? i : null;
	};
	const front = find(/^(frente|front|expression|word|palabra|japon|vocab|kanji)/);
	const back = find(/^(significado|back|meaning|reverso|traduc|glosa|definition)/);
	const reading = find(/^(lectura|reading|kana|furigana|yomi)/);
	const context = find(/^(contexto|context|sentence|frase|ejemplo|example|notes?)/);
	if (front != null && back != null) return { front, back, reading, context };
	// Por contenido: la columna con más japonés es el frente; la siguiente con latín, el significado.
	const cols = Math.max(...t.rows.slice(0, 20).map((r) => r.length), 0);
	const jpScore = (i: number) => t.rows.slice(0, 20).filter((r) => /[぀-ヿ㐀-鿿]/.test(r[i] ?? '')).length;
	const order = [...Array(cols).keys()].sort((a, b) => jpScore(b) - jpScore(a));
	const f = front ?? order[0] ?? 0;
	const b = back ?? [...Array(cols).keys()].find((i) => i !== f && jpScore(i) < t.rows.slice(0, 20).length / 2) ?? (f === 0 ? 1 : 0);
	return { front: f, back: b, reading, context };
}

/** Aplica el mapeo y descarta filas sin frente o sin significado. */
export function mapRows(t: ParsedTable, map: ColumnMap): ImportRow[] {
	const out: ImportRow[] = [];
	for (const r of t.rows) {
		const front = r[map.front]?.trim();
		const back = r[map.back]?.trim();
		if (!front || !back) continue;
		out.push({
			front,
			back,
			reading: map.reading != null ? r[map.reading]?.trim() || undefined : undefined,
			context: map.context != null ? r[map.context]?.trim() || undefined : undefined,
		});
	}
	return out;
}

export interface ApkgNote {
	fields: string[];
	fieldNames: string[];
	deck: string;
	/** Imágenes referenciadas en los campos (`<img src="…">`), ya extraídas. */
	images: Blob[];
}

/**
 * Lee un `.apkg` (zip con SQLite `collection.anki2`/`anki21` + medios). Devuelve las notas con
 * los nombres de sus campos. Las colecciones `anki21b` (zstd) no se admiten: Anki permite exportar
 * en modo compatible («Support older Anki versions»).
 */
export async function readApkg(file: Blob): Promise<ApkgNote[]> {
	const [{ unzipSync, strFromU8 }, initSqlJs, wasmUrl] = await Promise.all([
		import('fflate'),
		import('sql.js').then((m) => m.default),
		import('sql.js/dist/sql-wasm-browser.wasm?url').then((m) => m.default as string),
	]);
	const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
	const dbBytes = zip['collection.anki21'] ?? zip['collection.anki2'];
	if (!dbBytes) {
		if (zip['collection.anki21b']) throw new Error('Este .apkg usa el formato nuevo de Anki. Expórtalo marcando «Compatibilidad con versiones antiguas».');
		throw new Error('El archivo no parece un mazo de Anki (.apkg).');
	}
	// Medios: `media` es un JSON { "0": "nombre.jpg", … } y los archivos se llaman 0, 1, …
	let media: Record<string, string>;
	try {
		media = JSON.parse(strFromU8(zip['media'] ?? new Uint8Array()));
	} catch {
		media = {};
	}
	const byName = new Map(Object.entries(media).map(([num, name]) => [name, num]));

	const SQL = await initSqlJs({ locateFile: () => wasmUrl });
	const sdb = new SQL.Database(dbBytes);
	try {
		const col = sdb.exec('select models, decks from col')[0]?.values[0];
		const models = JSON.parse(String(col?.[0] ?? '{}')) as Record<string, { flds: { name: string; ord: number }[] }>;
		const decks = JSON.parse(String(col?.[1] ?? '{}')) as Record<string, { name: string }>;
		const res = sdb.exec('select n.mid, n.flds, min(c.did) from notes n left join cards c on c.nid = n.id group by n.id')[0];
		const out: ApkgNote[] = [];
		for (const [mid, flds, did] of res?.values ?? []) {
			const model = models[String(mid)];
			const names = model ? [...model.flds].sort((a, b) => a.ord - b.ord).map((f) => f.name) : [];
			const raw = String(flds).split('\x1f');
			const images: Blob[] = [];
			for (const f of raw) {
				for (const m of f.matchAll(/<img[^>]+src="([^"]+)"/gi)) {
					const num = byName.get(m[1]);
					const bytes = num != null ? zip[num] : undefined;
					if (bytes) images.push(new Blob([bytes as BlobPart], { type: /\.png$/i.test(m[1]) ? 'image/png' : /\.webp$/i.test(m[1]) ? 'image/webp' : 'image/jpeg' }));
				}
			}
			out.push({
				fields: raw.map((f) => htmlToText(f.replace(/\[sound:[^\]]+\]/g, ''))),
				fieldNames: names,
				deck: decks[String(did)]?.name ?? 'Anki',
				images,
			});
		}
		return out;
	} finally {
		sdb.close();
	}
}

/** Convierte notas de Anki a tabla para reutilizar el mapeo de columnas. */
export function apkgToTable(notes: ApkgNote[]): ParsedTable {
	const header = notes[0]?.fieldNames.length ? notes[0].fieldNames : null;
	return { rows: notes.map((n) => n.fields), header, deck: notes[0]?.deck ?? null };
}
