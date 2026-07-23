# CLAUDE.md

Guía para agentes que trabajen en este repo. Lee esto antes de editar.

## Qué es

PWA estática tipo Anki para japonés. Offline-first, todo en el navegador (IndexedDB). SRS con ts-fsrs + IA con Gemini. Se despliega a GitHub Pages.

## Stack y convenciones

- **SvelteKit + Svelte 5 con runes** (`$state`, `$props`, `$derived`). No usar sintaxis Svelte 4 (`export let`, stores para estado local).
- **Tailwind 4** para estilos (utility-first inline; sin CSS suelto salvo `app.css`).
- **TypeScript estricto.** Nada de `any` sin motivo; validar entradas externas (respuestas de Gemini) con **Zod**.
- **Bun** como runtime y gestor de paquetes. No usar npm/yarn/pnpm.
- **adapter-static**: la app es 100% cliente. No hay backend ni `+page.server.ts`. Nada de código exclusivo de servidor.
- **Comentarios y textos de UI en español.** Mantén el idioma existente.
- **Alias `$lib`** para imports dentro de `src/lib`.
- **Base path**: usa `import { base } from '$app/paths'` para toda URL/enlace/ruta de asset. En producción el sitio vive bajo `/yomigaeru`.

## Comandos

```bash
bun install
bun run dev      # desarrollo
bun run check    # typecheck (svelte-check) — CORRE ESTO antes de dar por hecho un cambio
bun run format   # prettier
bun run build    # build prod (incluye service worker)
```

No hay tests. La verificación es `bun run check` + build. El SW solo existe tras `build`.

## Arquitectura

### Datos (Dexie / IndexedDB)
- Schema en [src/lib/db/schema.ts](src/lib/db/schema.ts). Tablas: `decks`, `cards`, `fsrsData`, `reviewLogs`, `settings`.
- Al cambiar índices o tablas: **subir la versión de Dexie** (`db.version(N).stores({...})`). Campos no indexados (p. ej. `grammar` en `cards`) no requieren nueva versión.
- `due` y `last_review` se guardan como **epoch ms** (números), no `Date`, para poder indexar/ordenar.
- Acceso a ajustes vía [settings.ts](src/lib/db/settings.ts) (`getSetting`/`setSetting`/`getAllSettings`) con `SettingsMap` tipado y `DEFAULTS`.

### SRS
- [src/lib/srs/fsrs.ts](src/lib/srs/fsrs.ts): envuelve ts-fsrs. Convierte entre `FsrsCard` (Date) y `FsrsData` (epoch ms). `applyRating`, `previewIntervals`, `newFsrsData`. Respeta `requestRetention` de ajustes.
- [src/lib/srs/queue.ts](src/lib/srs/queue.ts): tarjetas vencidas (`countDue`, `getDueCards`), orden por `due` asc.

### Gemini
- [src/lib/gemini/client.ts](src/lib/gemini/client.ts): `generateJson()` fuerza salida JSON con `responseSchema`. Lanza `GeminiError` (con mensaje en español) en fallos. La API key sale de `settings`.
- [src/lib/gemini/schemas.ts](src/lib/gemini/schemas.ts): cada feature tiene **dos** esquemas — el `Schema` de `@google/genai` (para forzar el JSON) y el schema **Zod** (para validar la respuesta). Manténlos en sync.
- Funciones: `generateCard`, `imageToCards`, `judge`, `grammar`. Patrón: construir prompt → `generateJson` → `Zod.parse`.
- El SW **no** cachea llamadas a Gemini (origen externo se ignora en `fetch`).

### Furigana
- Notación Anki `漢字[かんじ]`. Parser en [src/lib/furigana.ts](src/lib/furigana.ts): `parseFurigana` (segmentos ruby) y `stripFurigana` (texto plano para TTS/búsqueda).

### Estado global
- [src/lib/state/app.svelte.ts](src/lib/state/app.svelte.ts): clase `AppState` con runes. `settings` cacheados + cola de `toasts`. Instancia exportada `app`. Usa `app.toast(msg, kind, {action})` para feedback.

### PWA
- [src/lib/pwa.ts](src/lib/pwa.ts): `requestPersistentStorage`, `registerServiceWorker` (solo en build).
- [src/service-worker.ts](src/service-worker.ts): precache del shell + assets; navegación red-primero con fallback al shell; ignora orígenes externos. Deriva el base path de su propia ubicación.

### Rutas ([src/routes/](src/routes/))
`/` inicio · `/estudio` repaso · `/mazos` gestión · `/crear` nueva tarjeta (texto/IA) · `/foto` foto→tarjetas · `/ajustes` config (API key, modelo, voz, retención).

## Reglas al hacer cambios

- Cambio de datos → revisar si hace falta versión nueva de Dexie.
- Feature de IA → mantener sincronizados el `Schema` de genai y el schema Zod.
- URLs/rutas → siempre con `base`.
- Nada de dependencias de servidor ni Node-only APIs (corre en navegador).
- Al terminar: `bun run check` y, si tocaste rutas/build, `bun run build`.
- La API key del usuario es privada: nunca loguearla ni enviarla fuera de Gemini.
