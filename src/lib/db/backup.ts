import { exportDB, importInto } from 'dexie-export-import';
import { db } from './schema';

/** Exporta toda la base a un Blob JSON descargable. */
export async function exportBackup(): Promise<Blob> {
	return exportDB(db, { prettyJson: false });
}

/** Dispara la descarga del backup en el navegador. */
export async function downloadBackup(): Promise<void> {
	const blob = await exportBackup();
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	const stamp = new Date().toISOString().slice(0, 10);
	a.href = url;
	a.download = `yomigaeru-backup-${stamp}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

/** Importa un backup JSON, reemplazando los datos existentes. */
export async function importBackup(file: Blob): Promise<void> {
	await importInto(db, file, { clearTablesBeforeImport: true });
}
