import { beforeEach, expect, test } from 'bun:test';
import { db, DATA_TABLES } from '$lib/db/schema';
import { clearDraft, loadDraft, saveDraft } from '$lib/db/drafts';
import type { CreateGroup } from '$lib/create';

const group = (over: Partial<CreateGroup> = {}): CreateGroup => ({
	id: 'g1',
	kind: 'text',
	text: '猫が好き。',
	status: 'done',
	proposals: [{ front: '猫', reading: 'ねこ', back: 'gato', context: '', examples: [], keep: true, dups: [], dupAction: 'create' }],
	...over,
});

beforeEach(async () => {
	await db.open();
	await clearDraft();
});

test('guarda y recupera el borrador con blobs; «running» vuelve a «pending»', async () => {
	await saveDraft({ text: 'x', mode: 'text', deckId: 3, groups: [group(), group({ id: 'g2', kind: 'image', image: new Blob(['abc'], { type: 'image/jpeg' }), status: 'running', proposals: [] })] });
	const d = await loadDraft();
	expect(d?.deckId).toBe(3);
	expect(d?.groups).toHaveLength(2);
	expect(d?.groups[1].status).toBe('pending');
	expect(d?.groups[0].proposals[0].front).toBe('猫');
	expect(d?.updatedAt).toBeGreaterThan(0);
});

test('sin propuestas ni fotos no se guarda nada (y borra el anterior)', async () => {
	await saveDraft({ text: '', mode: null, deckId: null, groups: [group()] });
	await saveDraft({ text: '', mode: null, deckId: null, groups: [group({ proposals: [] })] });
	expect(await loadDraft()).toBeNull();
});

test('los borradores no viajan en backups', () => {
	expect(DATA_TABLES as readonly string[]).not.toContain('drafts');
});
