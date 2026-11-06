import Dexie from 'dexie';
import { exportDB, importDB, peakImportFile } from 'dexie-export-import';
import { BACKUP_RETENTION_DAYS, DAY_MS, startOfDay } from '$lib/srs/constants';
import { applySchema, db, DATA_TABLES, type BackupKind, type BackupRow, type Card } from './schema';
import { getSetting } from './settings';

export const KIND_LABELS: Record<BackupKind, string> = {
	auto: 'Automática',
	manual: 'Manual',
	'pre-import': 'Antes de importar',
	'pre-reset': 'Antes de restaurar',
};

/**
 * Exporta la base a un Blob JSON. Nunca incluye la tabla `backups` (evita copias anidadas)
 * ni la API key. `light` excluye imágenes y audio para que las copias automáticas sean pequeñas.
 */
export async function exportBackup(light = false): Promise<Blob> {
	return exportDB(db, {
		prettyJson: false,
		skipTables: light ? ['backups', 'images'] : ['backups'],
		filter: (table, value) => !(table === 'settings' && (value as { key: string }).key === 'apiKey'),
		transform: (table, value, key) => {
			if (light && table === 'cards') {
				const { audioBlob: _a, ...rest } = value as Card;
				return { value: rest, key };
			}
			return { value, key };
		},
	});
}

/** Dispara la descarga de un blob en el navegador. */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Exporta y descarga la base completa (con imágenes y audio). */
export async function downloadBackup(): Promise<void> {
	const blob = await exportBackup(false);
	downloadBlob(blob, `yomigaeru-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

async function counts(): Promise<Record<string, number>> {
	const out: Record<string, number> = {};
	for (const t of DATA_TABLES) out[t] = await db.table(t).count();
	return out;
}

/** Huella barata del estado: si no cambia, no hace falta otra copia automática. */
async function fingerprint(): Promise<string> {
	const c = await counts();
	const lastLog = await db.reviewLogs.orderBy('reviewedAt').last();
	const lastCard = await db.cards.orderBy('createdAt').last();
	return JSON.stringify([c, lastLog?.reviewedAt ?? 0, lastCard?.createdAt ?? 0]);
}

/** Guarda una copia en el navegador (tabla `backups`). */
export async function createBackup(kind: BackupKind, light = kind !== 'manual'): Promise<BackupRow> {
	const blob = await exportBackup(light);
	const row: BackupRow = { kind, createdAt: Date.now(), size: blob.size, counts: await counts(), light, fingerprint: await fingerprint(), blob };
	row.id = (await db.backups.add(row)) as number;
	return row;
}

/** Lista de copias (más reciente primero) sin cargar los blobs en la UI más de lo necesario. */
export async function listBackups(): Promise<BackupRow[]> {
	return db.backups.orderBy('createdAt').reverse().toArray();
}

export async function deleteBackup(id: number): Promise<void> {
	await db.backups.delete(id);
}

/** Retención: borra copias de más de N días, conservando siempre la más reciente. */
export async function pruneBackups(now = Date.now()): Promise<number> {
	const all = await listBackups();
	const limit = now - BACKUP_RETENTION_DAYS * DAY_MS;
	const old = all.slice(1).filter((b) => b.createdAt < limit);
	if (old.length) await db.backups.bulkDelete(old.map((b) => b.id!));
	return old.length;
}

/** Copia automática diaria: solo si está activada, hay datos, no hay una de hoy y algo cambió. */
export async function ensureDailyBackup(now = Date.now()): Promise<BackupRow | null> {
	if (!(await getSetting('autoBackup'))) return null;
	if ((await db.cards.count()) === 0) return null;
	const last = (await db.backups.where('kind').equals('auto').reverse().sortBy('createdAt'))[0];
	if (last && last.createdAt >= startOfDay(now)) return null;
	if (last && last.fingerprint === (await fingerprint())) return null;
	const row = await createBackup('auto', true);
	await pruneBackups(now);
	return row;
}

/** ¿El archivo es una copia ligera (sin imágenes)? Las v1 llevan las imágenes dentro de `cards`. */
async function isLightFile(file: Blob): Promise<boolean> {
	const meta = await peakImportFile(file);
	return meta.data.databaseVersion >= 2 && !meta.data.tables.some((t) => t.name === 'images');
}

/**
 * Importa un backup reemplazando los datos actuales. Siempre crea antes una copia `pre-import`.
 * El archivo se abre en una base temporal con el schema completo, así Dexie migra backups de
 * versiones anteriores (v1 → actual) antes de copiar. Las copias ligeras conservan las imágenes
 * y el audio actuales. La API key no se toca.
 */
export async function importBackup(file: Blob, kind: BackupKind = 'pre-import'): Promise<void> {
	const meta = await peakImportFile(file);
	if (meta.formatName !== 'dexie' || meta.data.databaseName !== 'yomigaeru') {
		throw new Error('El archivo no es un backup de Yomigaeru.');
	}
	const light = await isLightFile(file);
	await createBackup(kind, false);

	const tmpName = `yomigaeru-import-${Date.now()}`;
	const raw = await importDB(file, { name: tmpName });
	raw.close();
	const tmp = applySchema(new Dexie(tmpName));
	const tables = DATA_TABLES.filter((t) => !(light && t === 'images'));
	// Se lee TODO de la base temporal antes de la transacción: dentro de una transacción de Dexie
	// no se puede esperar a otra base (la transacción se cierra y falla con InvalidStateError).
	const incoming = new Map<string, unknown[]>();
	try {
		await tmp.open();
		for (const t of tables) incoming.set(t, await tmp.table(t).toArray());
	} finally {
		tmp.close();
		await Dexie.delete(tmpName);
	}
	await db.transaction(
		'rw',
		tables.map((t) => db.table(t)),
		async () => {
			// Audio actual por id, para no perderlo al restaurar una copia ligera.
			const audio = new Map<number, Blob>();
			if (light) await db.cards.each((c) => c.audioBlob && audio.set(c.id!, c.audioBlob));
			const apiKey = await db.settings.get('apiKey');
			for (const t of tables) {
				await db.table(t).clear();
				let rows = incoming.get(t) ?? [];
				if (t === 'settings') rows = rows.filter((r) => (r as { key: string }).key !== 'apiKey');
				if (t === 'cards' && light)
					rows = rows.map((r) => {
						const c = r as Card;
						return audio.has(c.id!) ? { ...c, audioBlob: audio.get(c.id!) } : c;
					});
				if (rows.length) await db.table(t).bulkPut(rows);
			}
			if (apiKey) await db.settings.put(apiKey);
		},
	);
}

/** Restaura una copia guardada en el navegador. */
export async function restoreBackup(id: number): Promise<void> {
	const row = await db.backups.get(id);
	if (!row) throw new Error('La copia ya no existe.');
	await importBackup(row.blob, 'pre-reset');
}

/** Tamaño legible. */
export function fmtBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
	return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
