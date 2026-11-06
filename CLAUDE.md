# CLAUDE.md

Guía para agentes que trabajen en este repo. Lee esto antes de editar.

## Qué es

PWA estática tipo Anki para japonés. Offline-first, todo en el navegador (IndexedDB). SRS con ts-fsrs + IA con Gemini. Se despliega a GitHub Pages. Muchas ideas se portaron de `../sensei` (otro proyecto del autor); el plan está en `plan.md` (gitignored).

## Stack y convenciones

- **SvelteKit 2 + Svelte 5 con runes** (`$state`, `$props`, `$derived`). No usar sintaxis Svelte 4 (`export let`, stores para estado local).
- **Tailwind 4** para estilos (utility-first inline; sin CSS suelto salvo `app.css`).
- **TypeScript estricto.** Nada de `any` sin motivo; validar entradas externas (respuestas de Gemini) con **Zod**.
- **Bun** como runtime y gestor de paquetes. No usar npm/yarn/pnpm.
- **adapter-static**: la app es 100% cliente. No hay backend ni `+page.server.ts`. Nada de código exclusivo de servidor.
- **Comentarios y textos de UI en español.** Mantén el idioma existente.
- **Alias `$lib`** para imports dentro de `src/lib` (también funciona en `bun test`).
- **Base path**: usa `import { base } from '$app/paths'` para toda URL/enlace/ruta de asset. En producción el sitio vive bajo `/yomigaeru`.
- **Colores y tema**: claro/oscuro vía `data-theme` en `<html>`. En oscuro `app.css` remapea la escala `slate` y los tonos 50–200 de sky/emerald/red/amber. Usa **`bg-surface`** (nunca `bg-white`) para tarjetas/paneles y **`bg-brand text-brand-fg`** para lo principal/activo. Botón verde = `<Button variant="success">`. No combines clases de color en conflicto (`bg-brand` + `bg-emerald-600`): Tailwind no garantiza cuál gana.

## Comandos

```bash
bun install
bun run dev      # desarrollo
bun run check    # typecheck (svelte-check) — CORRE ESTO antes de dar por hecho un cambio
bun test         # tests de funciones puras en tests/
bun run lint     # eslint
bun run format   # prettier
bun run build    # build prod (incluye service worker)
```

Verificación: `bun run check` (0 errores, 0 avisos) + `bun test` + `bun run lint` + build. El SW solo existe tras `build`. `bun run preview` cachea el índice de archivos: reinícialo tras cada build. Para probar con base path: `MSYS_NO_PATHCONV=1 BASE_PATH=/yomigaeru bun run build` y lo mismo para `preview` (en Git Bash, sin `MSYS_NO_PATHCONV` se rompe `/yomigaeru`).

Prueba en navegador real: Edge headless con `--remote-debugging-port` + CDP por WebSocket (sembrar IndexedDB, navegar, leer `Runtime.exceptionThrown`, `DOM.setFileInputFiles` para subir archivos, `Input.dispatchMouseEvent` para arrastrar). Gemini se simula con `Page.addScriptToEvaluateOnNewDocument` que sustituye `window.fetch` para `generativelanguage.googleapis.com` (respuesta `{candidates:[{content:{parts:[…]}}], usageMetadata}`). Ojo: el SW de una prueba anterior sigue sirviendo la versión cacheada; desregístralo y borra cachés antes. `--screenshot` es asíncrono en Windows: espera a que aparezca el archivo. Los botones en mayúsculas por CSS dan `innerText` en mayúsculas.

## Arquitectura

### Datos (Dexie / IndexedDB)

- Schema en [src/lib/db/schema.ts](src/lib/db/schema.ts). `applySchema(dexie)` declara **todas** las versiones; se usa para la base real y para bases temporales al importar.
- Versiones: **v1** `fsrsData` (una programación por tarjeta), `imageBlob` por tarjeta. **v2** añade `schedules`, `images`, `backups`, `geminiUsage`, índice `cards.norm`, y migra (fsrsData → schedules con cara `recognition`, imageBlob → images, `norm`, `facets`). **v3** borra `fsrsData` (no se puede borrar en la misma versión que la lee).
- Tablas: `decks`, `cards`, `schedules` (`&[cardId+facet]`), `reviewLogs`, `images`, `backups`, `geminiUsage`, `settings`. `DATA_TABLES` = las que viajan en un backup.
- Al cambiar índices o tablas: **nueva versión de Dexie** (con `upgrade()` si hay que migrar). Campos no indexados (`grammar`, `box`, `audioBlob`, `suspended`, `facets`, `via`, `durationMs`) no la requieren.
- `due` y `last_review` en **epoch ms**.
- **Nunca pases un proxy de `$state` a Dexie** (DataCloneError): usa `$state.snapshot(x)` o `$state.raw` para objetos que se guardan. `setSetting` ya hace una copia plana.
- Tarjetas en [cards.ts](src/lib/db/cards.ts): `createCard(s)` crea la programación de cada cara activa; `updateCard` resincroniza caras (crea/borra schedules) y recalcula `norm`. Duplicados: `findDuplicates`, `duplicateGroups`, `mergeContext`. `suspended`, `pauseCard`, `moveCard`.
- Imágenes en [images.ts](src/lib/db/images.ts): una fila por foto, compartida (`cards.imageId`); `gcImages()` borra huérfanas; `imageUrl` cachea object URLs.
- Ajustes vía [settings.ts](src/lib/db/settings.ts) (`getSetting`/`setSetting`/`getAllSettings`, `SettingsMap`, `DEFAULTS`). El tema NO es un ajuste: es por dispositivo (`localStorage['yomigaeru.theme']`, [theme.svelte.ts](src/lib/theme.svelte.ts) + script inline en `app.html`).
- Backups en [backup.ts](src/lib/db/backup.ts): nunca incluyen la tabla `backups` ni la `apiKey`. `importBackup` crea antes una copia `pre-import`, abre el archivo en una base temporal con `applySchema` (migra backups antiguos), **lee todo de ella antes** y luego escribe en una sola transacción (dentro de una transacción de Dexie no se puede esperar a otra base: InvalidStateError); las copias ligeras conservan imágenes y audio actuales. `ensureDailyBackup` (al arrancar, ligera, 7 días, salta si la huella no cambió).

### SRS ([src/lib/srs/](src/lib/srs/))

- **Caras** (`Facet`): `recognition` (siempre), `cloze` (requiere que el contexto contenga la palabra), `production` (escribir en japonés; juez IA), `visual` (requiere `imageId`). [facets.ts](src/lib/srs/facets.ts): `eligibleFacets`, `activeFacets`, `buildCloze`. Ajuste `defaultFacets` al crear.
- [fsrs.ts](src/lib/srs/fsrs.ts): `Schedule` ↔ ts-fsrs `Card`; `schedulerFor(cfg)` memoizado con `requestRetention` + `fsrsParams`; `applyRating(schedule, grade, cfg, {now, via, durationMs})`; `previewIntervals` en días reales (incluye minutos). `toFsrsCard` acota dificultad/estabilidad inválidas (si no, ts-fsrs lanza y rompe la sesión).
- [queue.ts](src/lib/srs/queue.ts): `getSession` (repasos vencidos por `due` + nuevas del cupo intercaladas, sin tarjetas suspendidas, `?mazo=` opcional), `queueSummary`, `countDue`. Nuevas de hoy = logs de hoy con `state === 0` (en ts-fsrs `log.state` es el estado **previo**).
- [quota.ts](src/lib/srs/quota.ts) (puro): `newQuota` con freno `BRAKE_HALF`/`BRAKE_STOP`, `interleave`, `separateSiblings`.
- [constants.ts](src/lib/srs/constants.ts): todos los umbrales (freno, `LEECH_LAPSES`, `MASTERED_DAYS`, pausa, `MIN_REVIEWS_OPTIMIZE`, retención de copias). Cámbialos ahí, la UI los cita.
- [options.ts](src/lib/srs/options.ts): opción múltiple con distractores de las propias tarjetas; nunca uno que también sea válido; `null` si no hay 3 seguros. Acertar por opción = máximo «Bien» (sin «Fácil»).
- [stats.ts](src/lib/srs/stats.ts): forecast, repasos por día, rachas (por día local), retención (solo Review con ≥ 1 día), `loadStats`.
- [optimizer.ts](src/lib/srs/optimizer.ts): calibración con fsrs-browser (WASM, import dinámico), un ítem por prefijo de historial por cara; `applyCalibration` reprograma reproduciendo el historial.
- Estudio ([estudio/+page.svelte](src/routes/estudio/+page.svelte)): modos `reveal|typed|choice` (ajuste `answerStyle`, conmutador en la barra); producción siempre se escribe (o se elige). Comparación local con [jp.ts](src/lib/jp.ts) antes de llamar al juez. Pasos de aprendizaje < 30 min se reencolan en la sesión. Deshacer = restaurar schedule previo + borrar log (`$state.raw`). Atajos: Espacio/Enter, 1–4, Ctrl+Z/U (ignorados al escribir en un input).

### Gemini ([src/lib/gemini/](src/lib/gemini/))

- [client.ts](src/lib/gemini/client.ts): `generateTracked` = presupuesto (`assertBudget`) + `withRetry` (429/5xx: 1 s, 3 s) + `recordUsage` (también si falla) y lanza siempre `GeminiError` con mensaje en español (`errorMessage` por código HTTP). `generateJson({feature, …})` → objeto parseado (tolera ```json); valida con `validate(ZodSchema, raw)`.
- **Toda llamada lleva `feature`** (clave de `FEATURES` en [usage.ts](src/lib/gemini/usage.ts); se guardan, no renombrar). Precios en [pricing.ts](src/lib/gemini/pricing.ts) (aproximados; `priceFor` por prefijo solo con sufijo de versión; precios propios en `modelPrices`).
- [schemas.ts](src/lib/gemini/schemas.ts): cada feature tiene **dos** esquemas — `Schema` de genai y Zod. Manténlos en sync. `box` (foto) es `[ymin, xmin, ymax, xmax]` 0–1000; inválida → se descarta. Se edita con [BoxEditor.svelte](src/lib/gui/BoxEditor.svelte) (mover, esquinas, dibujar, flechas) sobre funciones puras de [box.ts](src/lib/box.ts).
- Funciones: `generateCardFromText`, `imageToCards` (con cajas), `textToCards`, `explainGrammar`, `judgeAnswer`, `synthesizeJapanese` (Gemini TTS → PCM → WAV con [wav.ts](src/lib/media/wav.ts)).
- Los modelos (`geminiModel`, `ttsModel`) son ajustes; la búsqueda web solo con la serie Gemini 3.
- El SW **no** cachea llamadas a Gemini (origen externo).

### Creación e importación

- [proposals.ts](src/lib/proposals.ts) + [CardProposals.svelte](src/lib/gui/CardProposals.svelte): revisión compartida de foto/texto (duplicados con `dupAction` skip|merge|create, cajas sobre la imagen, refinado). `saveProposals` guarda la foto una vez.
- [anki.ts](src/lib/anki.ts): `cardsToTsv` (cabeceras Anki), `parseTable`/`guessColumns`/`mapRows` (TSV/CSV), `readApkg` (sql.js + fflate con import dinámico; `anki21b` no soportado). UI en [ImportWizard.svelte](src/lib/gui/ImportWizard.svelte).

### Furigana y japonés

- Notación Anki `漢字[かんじ]`. [furigana.ts](src/lib/furigana.ts): `parseFurigana`, `stripFurigana`.
- [jp.ts](src/lib/jp.ts): `normalizeFront` (duplicados), `normalizeReading`, `meaningMatches` (tildes, artículos, erratas, acepciones), `readingMatches`, `japaneseMatches`, `romajiToKana` (IME de wanakana).

### Estado global y avisos

- [app.svelte.ts](src/lib/state/app.svelte.ts): `app.settings` + toasts. `app.toast(msg, 'info'|'success'|'warn'|'error', { action, actions, detail, duration, key, persistent })`. Errores persistentes por defecto; `key` reemplaza el anterior; pausa al pasar el ratón. Render en [Toaster.svelte](src/lib/gui/Toaster.svelte) (deslizar para cerrar). Errores de IA: ofrece «Reintentar».
- Confirmaciones destructivas: `ConfirmDialog` con `requireText="REEMPLAZAR"`.

### PWA

- [pwa.ts](src/lib/pwa.ts): registro del SW, aviso «Actualizar» cuando hay uno esperando (comprueba `_app/version.json` sin caché), `SKIP_WAITING` + recarga, detección de actualización fallida → «Forzar» (`forceReload`: desregistra SW y borra cachés `yomigaeru-*`, no datos).
- [service-worker.ts](src/service-worker.ts): **sin `skipWaiting` en install** (la página lo pide). Precache del shell + assets (incluye los `.wasm`), **deduplicado** (`prerendered` ya trae `<base>/` y `addAll` con duplicados rechaza la instalación entera); navegación red-primero; ignora orígenes externos; recibe el **Share Target** (`POST <base>/compartir`) en la caché `yomigaeru-inbox` (sobrevive a versiones). Constantes compartidas con la página en [inbox-core.ts](src/lib/inbox-core.ts) (sin imports de Kit).
- [manifest.webmanifest](static/manifest.webmanifest): `share_target`, `file_handlers`, `shortcuts`, iconos PNG en `static/icons/` (renderizados desde los SVG con Edge headless; regenéralos si cambian los SVG).
- [inbox.ts](src/lib/inbox.ts): `takeShared`, `onOpenedFiles`, `setPending`/`takePending(destino)`; `/compartir` decide el destino.

### Rutas ([src/routes/](src/routes/))

`/` inicio (pendientes, cupo, freno) · `/estudio` (`?mazo=id`) · `/mazos` (caras, suspender, filtros, duplicados, import/export Anki, audio por lotes) · `/crear` (palabra o texto largo) · `/foto` · `/estadisticas` (solo en la barra de escritorio; en móvil desde Inicio) · `/compartir` · `/ajustes` (Gemini, costos, estudio, calibración, voz, tema, copias, app).

## Reglas al hacer cambios

- Cambio de datos → revisar si hace falta versión nueva de Dexie; tablas nuevas de usuario → añadirlas a `DATA_TABLES`.
- Feature de IA → mantener sincronizados el `Schema` de genai y el Zod, y pasar un `feature` registrado en `FEATURES`.
- URLs/rutas → siempre con `base`.
- Nada de dependencias de servidor ni Node-only APIs (corre en navegador). Librerías pesadas (WASM) con `import()` dinámico.
- Lógica nueva testeable → función pura + test en `tests/`.
- Al terminar: `bun run check`, `bun test`, `bun run lint` y, si tocaste rutas/build/SW, `bun run build`.
- La API key del usuario es privada: nunca loguearla, exportarla ni enviarla fuera de Gemini.
