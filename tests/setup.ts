// Preload de `bun test` (bunfig.toml): IndexedDB en memoria antes de que Dexie cree la base,
// para probar el código real de la app (ajustes, uso de Gemini, borradores) sin navegador.
import 'fake-indexeddb/auto';
