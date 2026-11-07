// Borrador de la sesión de «Crear»: se guarda mientras se revisan propuestas y se ofrece al volver.
import type { CreateGroup, CreateMode } from '$lib/create';
import { db } from './schema';

export interface CreateDraft {
	text: string;
	mode: CreateMode | null;
	deckId: number | null;
	groups: CreateGroup[];
}

const ID = 'crear';

/** Guarda el borrador (copia plana: nada de proxies de runes). Si no hay propuestas ni fotos, lo borra. */
export async function saveDraft(d: CreateDraft): Promise<void> {
	const groups = d.groups.filter((g) => g.proposals.length || g.image).map((g) => ({ ...g, status: g.status === 'running' ? 'pending' : g.status }));
	if (!groups.length) return clearDraft();
	// structuredClone conserva los Blob (JSON no).
	const data = structuredClone({ ...d, groups }) as CreateDraft;
	await db.drafts.put({ id: ID, updatedAt: Date.now(), data });
}

export async function loadDraft(): Promise<(CreateDraft & { updatedAt: number }) | null> {
	const row = await db.drafts.get(ID);
	return row ? { ...(row.data as CreateDraft), updatedAt: row.updatedAt } : null;
}

export async function clearDraft(): Promise<void> {
	await db.drafts.delete(ID);
}
