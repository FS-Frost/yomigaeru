// Propuestas de tarjetas (foto → tarjetas, texto → tarjetas): duplicados y guardado compartidos.
import { createCards, findDuplicates, mergeContext, type NewCard } from '$lib/db/cards';
import { addImage } from '$lib/db/images';
import type { Card } from '$lib/db/schema';
import type { GeneratedCard } from '$lib/gemini/schemas';

export type DupAction = 'skip' | 'create' | 'merge';

export interface Proposal extends GeneratedCard {
	keep: boolean;
	/** Tarjetas existentes con el mismo frente. */
	dups: Card[];
	/** Qué hacer si es duplicada. */
	dupAction: DupAction;
}

/** Contexto final: nota/frase + ejemplos «jp — es». */
export function contextOf(c: Pick<GeneratedCard, 'context' | 'examples'>): string | undefined {
	return [c.context, ...c.examples.map((e) => `${e.jp} — ${e.es}`)].filter(Boolean).join('\n') || undefined;
}

/** Envuelve las tarjetas de la IA y marca duplicadas (desmarcadas por defecto). */
export async function toProposals(cards: GeneratedCard[]): Promise<Proposal[]> {
	const out: Proposal[] = [];
	for (const c of cards) {
		const dups = await findDuplicates(c.front);
		out.push({ ...c, keep: dups.length === 0, dups, dupAction: dups.length ? 'skip' : 'create' });
	}
	return out;
}

/** Recalcula duplicados tras editar el frente. */
export async function refreshDups(p: Proposal): Promise<void> {
	p.dups = await findDuplicates(p.front);
	if (!p.dups.length) p.dupAction = 'create';
}

/**
 * Guarda las propuestas marcadas: crea las nuevas (una sola imagen compartida si se adjunta)
 * y fusiona el contexto en las existentes cuando se eligió «fusionar».
 * Devuelve cuántas creó y cuántas fusionó.
 */
export async function saveProposals(props: Proposal[], deckId: number, image?: Blob): Promise<{ created: number; merged: number }> {
	const chosen = props.filter((p) => p.keep);
	let merged = 0;
	const toCreate: NewCard[] = [];
	const needsImage = image && chosen.some((p) => !p.dups.length || p.dupAction === 'create');
	const imageId = needsImage ? await addImage(image) : undefined;
	for (const p of chosen) {
		if (p.dups.length && p.dupAction === 'merge') {
			await mergeContext(p.dups[0].id!, contextOf(p));
			merged++;
			continue;
		}
		if (p.dups.length && p.dupAction === 'skip') continue;
		toCreate.push({
			deckId,
			front: p.front,
			back: p.back,
			reading: p.reading || undefined,
			context: contextOf(p),
			imageId,
			box: imageId != null ? p.box : undefined,
		});
	}
	if (toCreate.length) await createCards(toCreate);
	return { created: toCreate.length, merged };
}
