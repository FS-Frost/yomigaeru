// Prueba REAL contra la API de Gemini con el código de la app (no corre en CI; cuesta centavos).
//   bun run test:gemini                     # todas las funciones, 1 vez
//   bun run test:gemini --runs 10 --only text
//   bun run test:gemini --model gemini-3.5-flash --search
//   bun run test:gemini --list              # modelos disponibles para tu key
// Lee GEMINI_API_KEY de .env (tolera comillas). Nunca la imprime.
import { readFileSync, existsSync } from 'node:fs';

// IndexedDB en memoria ANTES de cargar Dexie (por eso el resto se importa dinámicamente).
await import('fake-indexeddb/auto');
const { db } = await import('$lib/db/schema');
const { setSetting } = await import('$lib/db/settings');
const { geminiClient } = await import('$lib/gemini/client');
const { textToCards, imageToCards, topicToCards } = await import('$lib/gemini/imageToCards');
const { stripFurigana } = await import('$lib/furigana');
const { generateCardFromText } = await import('$lib/gemini/generateCard');
const { judgeAnswer } = await import('$lib/gemini/judge');
const { explainGrammar } = await import('$lib/gemini/grammar');
const { synthesizeJapanese } = await import('$lib/gemini/tts');
const { GeminiError } = await import('$lib/gemini/errors');
const { fmtUsd } = await import('$lib/gemini/pricing');
const { classifyModels } = await import('$lib/gemini/models');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};

const env = existsSync('.env') ? readFileSync('.env', 'utf8') : '';
const key = (process.env.GEMINI_API_KEY ?? env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
if (!key) {
	console.error('Falta GEMINI_API_KEY (en .env o en el entorno).');
	process.exit(1);
}

await setSetting('apiKey', key);
if (opt('model')) await setSetting('geminiModel', opt('model')!);
if (opt('tts-model')) await setSetting('ttsModel', opt('tts-model')!);
await setSetting('webSearch', flag('search'));

if (flag('list')) {
	const ai = await geminiClient();
	const all = [];
	for await (const m of await ai.models.list({ config: { pageSize: 200 } })) all.push(m);
	const c = classifyModels(all);
	console.log('Texto:', c.text.map((m) => m.id).join(', '));
	console.log('Voz:  ', c.tts.map((m) => m.id).join(', '));
	process.exit(0);
}

const runs = Number(opt('runs') ?? 1);
const only = opt('only')?.split(',');
const want = (k: string) => !only || only.includes(k);

const TEXT = `吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。吾輩はここで始めて人間というものを見た。しかもあとで聞くとそれは書生という人間中で一番獰悪な種族であったそうだ。この書生というのは時々我々を捕えて煮て食うという話である。しかしその当時は何という考もなかったから別段恐しいとも思わなかった。ただ彼の掌に載せられてスーと持ち上げられた時何だかフワフワした感じがあったばかりである。`;

type Row = { feature: string; ok: boolean; ms: number; info: string };
const rows: Row[] = [];

async function measure(feature: string, fn: () => Promise<string>): Promise<void> {
	const before = await db.geminiUsage.count();
	const t0 = performance.now();
	let ok = true;
	let info: string;
	try {
		info = await fn();
	} catch (e) {
		ok = false;
		info = e instanceof GeminiError ? `${e.code}: ${e.message}${e.detail ? ` [${e.detail.slice(0, 200)}]` : ''}` : String(e);
	}
	const ms = performance.now() - t0;
	const usage = (await db.geminiUsage.toArray()).slice(before);
	const out = usage.reduce((a, u) => a + u.outputTokens, 0);
	const cost = usage.reduce((a, u) => a + (u.costUsd ?? 0), 0);
	const priced = usage.every((u) => u.costUsd != null);
	info += ` · ${usage.length} llamada(s), ${out} tokens de salida, ${priced ? fmtUsd(cost) : 'sin precio'}`;
	rows.push({ feature, ok, ms, info });
	console.log(`${ok ? '✓' : '✗'} ${feature.padEnd(8)} ${(ms / 1000).toFixed(1).padStart(5)} s  ${info}`);
}

const model = (await db.settings.get('geminiModel'))?.value ?? '(por defecto)';
console.log(`Modelo: ${model} · búsqueda web: ${flag('search') ? 'sí' : 'no'} · corridas: ${runs}\n`);

for (let i = 0; i < runs; i++) {
	if (want('text'))
		await measure('text', async () => {
			let live = 0;
			const r = await textToCards(TEXT, { onCard: () => live++ });
			if (!r.cards.length) throw new Error('0 tarjetas');
			return `${r.cards.length} tarjetas (${live} en vivo)${r.retried ? ', CON REINTENTO' : ''}${r.dropped.length ? `, ${r.dropped.length} descartadas: ${r.dropped.join(' | ')}` : ''}${r.warning ? `, aviso ${r.warning.code}` : ''} · ${r.cards
				.slice(0, 3)
				.map((c) => `${c.front}=${c.back}`)
				.join('; ')}`;
		});
	if (want('topic'))
		await measure('topic', async () => {
			const count = Number(opt('count') ?? 10);
			const r = await topicToCards(opt('topic') ?? 'anime persona 5', { count, level: 'intermediate', exclude: ['猫', '犬', '学校'] });
			if (!r.cards.length) throw new Error('0 tarjetas');
			// La cara «Completar frase» necesita que el contexto contenga la palabra.
			const withCtx = r.cards.filter((c) => stripFurigana(c.context).includes(stripFurigana(c.front))).length;
			const excluded = r.cards.filter((c) => ['猫', '犬', '学校'].includes(stripFurigana(c.front))).length;
			return `mazo «${r.deckName}» · ${r.cards.length}/${count} tarjetas, ${withCtx} con la palabra en el contexto, ${excluded} excluidas que se colaron${r.retried ? ', CON REINTENTO' : ''}${r.dropped.length ? `, ${r.dropped.length} descartadas` : ''} · ${r.cards
				.slice(0, 4)
				.map((c) => `${c.front}=${c.back}`)
				.join('; ')}`;
		});
	if (want('word'))
		await measure('word', async () => {
			const c = await generateCardFromText(i % 2 ? 'perro' : '見当');
			return `${c.front} (${c.reading}) = ${c.back}`;
		});
	if (want('image') && existsSync('tests/fixtures/japones.png'))
		await measure('image', async () => {
			const base64 = readFileSync('tests/fixtures/japones.png').toString('base64');
			const r = await imageToCards({ mimeType: 'image/png', base64 });
			const boxes = r.cards.filter((c) => c.box).length;
			return `${r.cards.length} tarjetas, ${boxes} con caja · ${r.cards
				.slice(0, 3)
				.map((c) => `${c.front}${c.box ? `@[${c.box}]` : ''}`)
				.join('; ')}`;
		});
	if (want('judge'))
		await measure('judge', async () => {
			const j = await judgeAnswer({ front: '食[た]べる', back: 'comer', reading: 'たべる', context: '' }, 'たべます');
			return `${j.verdict} (${j.suggestedRating}) ${j.feedback.slice(0, 80)}`;
		});
	if (want('grammar'))
		await measure('grammar', async () => {
			const g = await explainGrammar('吾輩は猫である。', { word: '吾輩' });
			return `${g.tokens.length} fragmentos · ${g.summary.slice(0, 60)}`;
		});
	if (want('tts'))
		await measure('tts', async () => {
			const wav = await synthesizeJapanese('猫[ねこ]が好[す]きです');
			return `WAV ${wav.size} bytes`;
		});
}

const failed = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} OK`);
process.exit(failed.length ? 1 : 0);
