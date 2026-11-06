import { db } from './schema';

/** Guarda una imagen (compartida por varias tarjetas) y devuelve su id. */
export async function addImage(blob: Blob): Promise<number> {
	return db.images.add({ blob, createdAt: Date.now() }) as Promise<number>;
}

export async function getImage(id: number): Promise<Blob | undefined> {
	return (await db.images.get(id))?.blob;
}

/** Borra imágenes que ninguna tarjeta referencia. Devuelve cuántas borró. */
export async function gcImages(): Promise<number> {
	const used = new Set<number>();
	await db.cards.each((c) => {
		if (c.imageId != null) used.add(c.imageId);
	});
	const all = (await db.images.toCollection().primaryKeys()) as number[];
	const orphan = all.filter((id) => !used.has(id));
	if (orphan.length) await db.images.bulkDelete(orphan);
	return orphan.length;
}

// Object URLs cacheadas por id de imagen (se reutilizan entre tarjetas de la misma foto).
const urls = new Map<number, string>();

/** URL de objeto para mostrar la imagen; se mantiene en caché mientras dure la página. */
export async function imageUrl(id: number): Promise<string | null> {
	const hit = urls.get(id);
	if (hit) return hit;
	const blob = await getImage(id);
	if (!blob) return null;
	const url = URL.createObjectURL(blob);
	urls.set(id, url);
	return url;
}

/** Libera todas las URLs de objeto (al salir de una página con muchas imágenes). */
export function revokeImageUrls(): void {
	for (const u of urls.values()) URL.revokeObjectURL(u);
	urls.clear();
}
