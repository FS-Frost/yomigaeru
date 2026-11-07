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
bun test         # tests en tests/ (IndexedDB en memoria vía preload de bunfig.toml)
bun run test:gemini  # prueba REAL contra Gemini con GEMINI_API_KEY de .env (fuera de CI; cuesta centavos)
bun run lint     # eslint
bun run format   # prettier
bun run build    # build prod (incluye service worker)
```

Verificación: `bun run check` (0 errores, 0 avisos) + `bun test` + `bun run lint` + build. El SW solo existe tras `build`. `bun run preview` cachea el índice de archivos: reinícialo tras cada build. Para probar con base path: `MSYS_NO_PATHCONV=1 BASE_PATH=/yomigaeru bun run build` y lo mismo para `preview` (en Git Bash, sin `MSYS_NO_PATHCONV` se rompe `/yomigaeru`).

Prueba en navegador real: Edge headless con `--remote-debugging-port` + CDP por WebSocket (sembrar IndexedDB, navegar, leer `Runtime.exceptionThrown`, `DOM.setFileInputFiles` para subir archivos, `Input.dispatchMouseEvent` para arrastrar). Gemini se simula con `Page.addScriptToEvaluateOnNewDocument` que sustituye `window.fetch` para `generativelanguage.googleapis.com`: las llamadas JSON van por `…:streamGenerateContent?alt=sse` (responde un `ReadableStream` con líneas `data: {candidates:[{content:{parts:[{text}]}, finishReason}], usageMetadata}` troceadas y con retardo); TTS, `models.list` y las pruebas de modelo no son streaming. La key va en la cabecera `x-goog-api-key` (objeto `Headers`). Emula móvil con `Emulation.setDeviceMetricsOverride` (390×844, `mobile: true`) y comprueba `scrollWidth <= innerWidth`. Ojo: el SW de una prueba anterior sigue sirviendo la versión cacheada; desregístralo y borra cachés antes. `--screenshot` es asíncrono en Windows: espera a que aparezca el archivo. Los botones en mayúsculas por CSS dan `innerText` en mayúsculas.

## Arquitectura

### Datos (Dexie / IndexedDB)

- Schema en [src/lib/db/schema.ts](src/lib/db/schema.ts). `applySchema(dexie)` declara **todas** las versiones; se usa para la base real y para bases temporales al importar.
- Versiones: **v1** `fsrsData` (una programación por tarjeta), `imageBlob` por tarjeta. **v2** añade `schedules`, `images`, `backups`, `geminiUsage`, índice `cards.norm`, y migra (fsrsData → schedules con cara `recognition`, imageBlob → images, `norm`, `facets`). **v3** borra `fsrsData` (no se puede borrar en la misma versión que la lee). **v4** añade `drafts` (borrador de Crear; no está en `DATA_TABLES` ni en los backups).
- Tablas: `decks`, `cards`, `schedules` (`&[cardId+facet]`), `reviewLogs`, `images`, `backups`, `geminiUsage`, `settings`, `drafts`. `DATA_TABLES` = las que viajan en un backup.
- Al cambiar índices o tablas: **nueva versión de Dexie** (con `upgrade()` si hay que migrar). Campos no indexados (`grammar`, `box`, `audioBlob`, `suspended`, `facets`, `via`, `durationMs`) no la requieren.
- `due` y `last_review` en **epoch ms**.
- **Nunca pases un proxy de `$state` a Dexie** (DataCloneError): usa `$state.snapshot(x)` o `$state.raw` para objetos que se guardan. `setSetting` ya hace una copia plana.
- Tarjetas en [cards.ts](src/lib/db/cards.ts): `createCard(s)` crea la programación de cada cara activa; `updateCard` resincroniza caras (crea/borra schedules) y recalcula `norm`. Duplicados: `findDuplicates`, `duplicateGroups`, `mergeContext`. `suspended`, `pauseCard`, `moveCard`.
- Imágenes en [images.ts](src/lib/db/images.ts): una fila por foto, compartida (`cards.imageId`); `gcImages()` borra huérfanas; `imageUrl` cachea object URLs.
- Ajustes vía [settings.ts](src/lib/db/settings.ts) (`getSetting`/`setSetting`/`getAllSettings`, `SettingsMap`, `DEFAULTS`). El tema NO es un ajuste: es por dispositivo (`localStorage['yomigaeru.theme']`, [theme.svelte.ts](src/lib/theme.svelte.ts) + script inline en `app.html`).
- Backups en [backup.ts](src/lib/db/backup.ts): nunca incluyen las tablas `backups` y `drafts` ni la `apiKey`. `importBackup` crea antes una copia `pre-import`, abre el archivo en una base temporal con `applySchema` (migra backups antiguos), **lee todo de ella antes** y luego escribe en una sola transacción (dentro de una transacción de Dexie no se puede esperar a otra base: InvalidStateError); las copias ligeras conservan imágenes y audio actuales. `ensureDailyBackup` (al arrancar, ligera, 7 días, salta si la huella no cambió).

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

- [client.ts](src/lib/gemini/client.ts): `generateTracked` (no-JSON, p. ej. audio) y `generateJson({feature, prompt, schema, image?, signal?, onStage?, onText?, maxOutputTokens?, loop?})`, que va **en streaming** (`generateContentStream`): sin conexión → falla al instante; presupuesto; `withRetry` (429/5xx al iniciar: 1 s, 3 s); `recordUsage` siempre (también si se corta: los tokens consumidos se cobran). `validate(Zod, raw)` lanza `invalid` con el issue de Zod en `detail`. `_setTestClient` sustituye el SDK en tests.
- [errors.ts](src/lib/gemini/errors.ts) (puro): `GeminiError` con `code` (`no-key`, `offline`, `budget`, `auth`, `quota`, `unavailable`, `model-not-found`, `bad-request`, `safety`, `recitation`, `truncated`, `loop`, `invalid`, `empty`, `aborted`, `unknown`), `action` (retry|settings|none), `detail` técnico y `partial` (texto recibido antes del fallo). `classifyError` (status HTTP, `API_KEY_INVALID`, red, abort), `finishError(finishReason)`, `redact` (quita keys `AIza…` de cualquier texto: nunca deben llegar a la UI).
- [stream.ts](src/lib/gemini/stream.ts) (puro): `consumeJsonStream` (etapas sending→thinking→writing→done, texto acumulado, uso, `finishReason`, `blockReason`), `extractCompleteItems` (objetos completos de un array a medio llegar), `detectLoop` (string > máximo o fragmento repetido ≥ 8 veces: **corta el stream**; Gemini a veces entra en bucle repitiendo un campo hasta 65k tokens), `parseJsonLoose`.
- [cardgen.ts](src/lib/gemini/cardgen.ts) (puro): `resilientCards` emite cada tarjeta válida al llegar, descarta solo las inválidas, y ante bucle/corte/JSON inválido conserva lo recibido y **reintenta una vez** (añade `RETRY_HINT`), fusionando sin duplicar; cancelar conserva lo recibido. `retryOnBadOutput` para respuestas de un solo objeto.
- [request.ts](src/lib/gemini/request.ts) (puro): prompts (`textPrompt`, `imagePrompt`, `wordPrompt`) y `buildJsonRequest` (`responseSchema`, `maxOutputTokens` 8192 por defecto, `thinkingLevel: LOW` en Gemini 3+, `googleSearch` solo si el ajuste `webSearch` está activo y el modelo es Gemini 3+). Lo comparten la app y `scripts/test-gemini.ts`: cambia los prompts aquí.
- **Toda llamada lleva `feature`** (clave de `FEATURES` en [usage.ts](src/lib/gemini/usage.ts); se guardan, no renombrar). Precios en [pricing.ts](src/lib/gemini/pricing.ts) (aproximados; `priceFor` por prefijo solo con sufijo de versión; precios propios en `modelPrices`).
- [schemas.ts](src/lib/gemini/schemas.ts): cada feature tiene **dos** esquemas — `Schema` de genai y Zod. Manténlos en sync: en genai **todas** las claves en `required` y en `propertyOrdering` (helper `object()`), con `maxLength`/`maxItems` (`LIMITS`); Zod tolera `null` (→ vacío). `tests/schemas.test.ts` comprueba la paridad. `parseCard`/`parseCards` validan tarjeta a tarjeta; `cardProblem` descarta basura (frente sin japonés, lectura que no es kana, campos desmesurados). `box` (foto) es `[ymin, xmin, ymax, xmax]` 0–1000; inválida → se descarta. Se edita con [BoxEditor.svelte](src/lib/gui/BoxEditor.svelte) (mover, esquinas, dibujar, flechas) sobre funciones puras de [box.ts](src/lib/box.ts).
- Funciones: `generateCardFromText`, `imageToCards` (con cajas), `textToCards`, `explainGrammar`, `judgeAnswer`, `synthesizeJapanese` (Gemini TTS → PCM → WAV con [wav.ts](src/lib/media/wav.ts)).
- Modelos ([models.ts](src/lib/gemini/models.ts)): `CURATED_TEXT`/`CURATED_TTS` (recomendados, verificados con `test:gemini`; por defecto `gemini-3.8-flash` y `gemini-3.8-flash-tts`), `classifyModels` (filtra `models.list` a texto/TTS), `modelOptions`. [probe.ts](src/lib/gemini/probe.ts): `probeModel` (llamada mínima, feature `probe`) y `listModels`. Voces de Gemini TTS en [voices.ts](src/lib/gemini/voices.ts) (30, con estilo). Precios oficiales (nov. 2026) en `DEFAULT_PRICES`.
- El SW **no** cachea llamadas a Gemini (origen externo).

### Creación e importación

- **Crear unificado** ([crear/+page.svelte](src/routes/crear/+page.svelte)): una entrada (texto + Cámara/Galería múltiple/Pegar). [create.ts](src/lib/create.ts) (puro): `detectMode` (sin japonés o línea corta ≤ 25 sin puntuación de oración → 1 tarjeta; si no → varias; interruptor manual), grupos de propuestas (`CreateGroup`: uno por texto, palabra o foto), `addUnique` (no repite frentes entre grupos), `setAllKept`. Fotos en cola (máx. 10, recorte/giro con [ImageCropper.svelte](src/lib/gui/ImageCropper.svelte)) se procesan en orden; progreso con [GenerationProgress.svelte](src/lib/gui/GenerationProgress.svelte) y Cancelar (`AbortController`). Borrador en [drafts.ts](src/lib/db/drafts.ts) (`structuredClone` conserva los Blob) ofrecido al volver. `/foto` solo redirige a `/crear?camara=1`.
- [proposals.ts](src/lib/proposals.ts) + [CardProposals.svelte](src/lib/gui/CardProposals.svelte): revisión compacta (fila por tarjeta, se despliega para editar; duplicados con `dupAction` skip|merge|create; cajas sobre la foto con BoxEditor). `saveProposals` guarda la foto una vez por grupo.
- [anki.ts](src/lib/anki.ts): `cardsToTsv` (cabeceras Anki), `parseTable`/`guessColumns`/`mapRows` (TSV/CSV), `readApkg` (sql.js + fflate con import dinámico; `anki21b` no soportado). UI en [ImportWizard.svelte](src/lib/gui/ImportWizard.svelte).

### Furigana y japonés

- Notación Anki `漢字[かんじ]`. [furigana.ts](src/lib/furigana.ts): `parseFurigana`, `stripFurigana`.
- [jp.ts](src/lib/jp.ts): `normalizeFront` (duplicados), `normalizeReading`, `meaningMatches` (tildes, artículos, erratas, acepciones), `readingMatches`, `japaneseMatches`, `romajiToKana` (IME de wanakana).

### Estado global y avisos

- [app.svelte.ts](src/lib/state/app.svelte.ts): `app.settings` + toasts. `app.toast(msg, 'info'|'success'|'warn'|'error', { action, actions, detail, tech, duration, key, persistent })`. **Para errores usa `app.error(e, 'qué se intentaba', { retry?, detail? })`**: clasifica con [errors.ts](src/lib/errors.ts) (`describeError`: IA, IndexedDB vía `classifyDbError` —cupo lleno, base bloqueada, sin IndexedDB—, red), pone la acción adecuada (Reintentar / Ajustes / Copias / Recargar) y el detalle técnico plegable y copiable; ignora cancelaciones. No uses `catch {}` que traguen la causa. Render en [Toaster.svelte](src/lib/gui/Toaster.svelte) (encima de la barra inferior y de `--action-bar`; deslizar para cerrar).
- Captura global en [+layout.svelte](src/routes/+layout.svelte) (`error`/`unhandledrejection` → «Algo falló»), `db.open()` con pantalla explicativa si falla, `blocked`/`versionchange` de Dexie; [+error.svelte](src/routes/+error.svelte); [net.svelte.ts](src/lib/net.svelte.ts) (`net.online`: chip «Sin conexión» y botones de IA deshabilitados).
- Confirmaciones destructivas: `ConfirmDialog` con `requireText="REEMPLAZAR"`.

### PWA

- [pwa.ts](src/lib/pwa.ts): registro del SW, aviso «Actualizar» cuando hay uno esperando (comprueba `_app/version.json` sin caché), `SKIP_WAITING` + recarga, detección de actualización fallida → «Forzar» (`forceReload`: desregistra SW y borra cachés `yomigaeru-*`, no datos).
- [service-worker.ts](src/service-worker.ts): **sin `skipWaiting` en install** (la página lo pide). Precache del shell + assets (incluye los `.wasm`), **deduplicado** (`prerendered` ya trae `<base>/` y `addAll` con duplicados rechaza la instalación entera); navegación red-primero; ignora orígenes externos; recibe el **Share Target** (`POST <base>/compartir`) en la caché `yomigaeru-inbox` (sobrevive a versiones). Constantes compartidas con la página en [inbox-core.ts](src/lib/inbox-core.ts) (sin imports de Kit).
- [manifest.webmanifest](static/manifest.webmanifest): `share_target`, `file_handlers`, `shortcuts`, iconos PNG en `static/icons/` (renderizados desde los SVG con Edge headless; regenéralos si cambian los SVG).
- [inbox.ts](src/lib/inbox.ts): `takeShared`, `onOpenedFiles`, `setPending`/`takePending(destino)`; `/compartir` decide el destino.

### Rutas ([src/routes/](src/routes/))

`/` inicio (Estudiar N, accesos, borrador pendiente) · `/estudio` (`?mazo=id`) · `/crear` (palabra, texto o fotos; `?camara=1`) · `/mazos` (nuevo mazo en hoja, caras, suspender, filtros, duplicados, import/export Anki, audio por lotes) · `/foto` (redirige a Crear) · `/estadisticas` (solo en la barra de escritorio; en móvil desde Inicio) · `/compartir` · `/ajustes` (secciones plegables [SettingsSection.svelte](src/lib/gui/SettingsSection.svelte) con `#ia`, `#voz`, `#estudio`, `#apariencia`, `#datos`, `#app`: key con «Probar conexión», [ModelPicker.svelte](src/lib/gui/ModelPicker.svelte), búsqueda web, costos; fuente de voz `voiceSource` system|gemini —con `gemini`, Estudio genera y guarda el audio la primera vez que suena— y voces con «Probar» cacheado).

Móvil: barra inferior de 5 pestañas (Inicio · Estudio · Crear · Mazos · Ajustes). Acciones fijas abajo con [ActionBar.svelte](src/lib/gui/ActionBar.svelte) (publica su alto en `--action-bar`); diálogos como `Sheet` (hoja inferior, máx. 85dvh); el viewport usa `interactive-widget=resizes-content` para que el teclado no tape las barras.

## Reglas al hacer cambios

- Cambio de datos → revisar si hace falta versión nueva de Dexie; tablas nuevas de usuario → añadirlas a `DATA_TABLES`.
- Feature de IA → mantener sincronizados el `Schema` de genai y el Zod (todas las claves en `required` y `propertyOrdering`, con límites), pasar un `feature` registrado en `FEATURES`, prompt en `request.ts`, test con el doble del SDK (`tests/gemini-features.test.ts`) y comprobarlo con `bun run test:gemini`.
- URLs/rutas → siempre con `base`.
- **Móvil vertical primero**: el uso principal es el teléfono en vertical. Diseña y revisa a 390×844 (acciones al alcance del pulgar, objetivos ≥ 44 px, inputs ≥ 16 px, sin scroll horizontal); el escritorio es secundario pero debe seguir funcionando.
- Nada de dependencias de servidor ni Node-only APIs (corre en navegador). Librerías pesadas (WASM) con `import()` dinámico.
- Lógica nueva testeable → función pura + test en `tests/`.
- Al terminar: `bun run check`, `bun test`, `bun run lint` y, si tocaste rutas/build/SW, `bun run build`.
- La API key del usuario es privada: nunca loguearla, exportarla ni enviarla fuera de Gemini.
