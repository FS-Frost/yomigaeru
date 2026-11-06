# 蘇 Yomigaeru

PWA estática tipo Anki para aprender japonés, con SRS (repetición espaciada) e integración de IA multimodal (Gemini). **Offline-first**: todo se guarda en el navegador (IndexedDB) y funciona sin conexión una vez cargada (salvo lo que usa Gemini).

> _yomigaeru_ (蘇る): "revivir / resurgir" — la memoria que vuelve.

## Características

### Estudio

- **SRS con [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)** (FSRS). Repetir / Difícil / Bien / Fácil con el intervalo de cada botón (min, h, d, meses).
- **Caras por tarjeta**, cada una con su propia programación:
    - **Reconocer**: japonés → significado (siempre activa).
    - **Completar frase** (cloze): la frase de contexto con la palabra oculta.
    - **Producir**: significado en español → escribirlo en japonés. Si no coincide exactamente, el **juez IA** la evalúa (alternativas, partículas, conjugación) y sugiere la nota.
    - **Imagen**: el recorte de la foto donde apareció la palabra (viñeta, cartel, subtítulo).
- **Tres modos de respuesta**: revelar y autoevaluar (como Anki), **escribir** (romaji → かな en vivo; significados con tolerancia a tildes, artículos y erratas) u **opción múltiple** con distractores sacados de tus propias tarjetas (un acierto así cuenta como «Bien» como máximo).
- **Cupo de nuevas por día** (global o por mazo) con freno automático: con ≥ 80 repasos pendientes el cupo baja a la mitad; con ≥ 150 no entran nuevas. Las nuevas se intercalan con los repasos.
- **Atajos**: Espacio/Enter revela, 1–4 califican (o eligen opción), Ctrl+Z / U deshace la última calificación.
- **Tarjetas que se resisten** (≥ 6 fallos): aviso con «Pausar 7 días» o «Suspender»; filtros en Mazos.
- **Furigana** estilo Anki `漢字[かんじ]` → `<ruby>`, oculta por defecto en estudio.
- **Voz**: TTS del sistema (`ja-JP`) o **audio natural** generado con Gemini TTS y guardado en la tarjeta (suena offline). Las explicaciones se leen con voz española y japonesa.
- **Estadísticas** (`/estadisticas`): previsión de 30 días, repasos por día, racha, retención real, estado de las caras, por mazo y tarjetas que se resisten.

### Crear tarjetas

- **Foto → tarjetas**: la IA detecta el japonés, propone tarjetas y marca dónde aparece cada palabra en la imagen. Las cajas se ajustan arrastrando (moverlas, sus esquinas o dibujar una nueva; flechas para afinar), también después desde Mazos. La foto se guarda una sola vez y la comparten sus tarjetas.
- **Texto → tarjeta** (una palabra) o **texto largo → varias** (letra, subtítulos, artículo).
- **Compartir hacia Yomigaeru** (app instalada): una captura desde otra app abre «Foto», un texto abre «Crear». También abre archivos `.apkg`, `.tsv`, `.csv` y backups `.json`.
- **Duplicados**: aviso al crear (descartar, fusionar el contexto en la existente o guardar igual) y buscador de duplicados en Mazos.
- **Anki**: exportar un mazo a TSV (se importa en Anki con Japanese Support) e importar `.apkg`, TSV o CSV con mapeo de columnas.

### Datos

- **Backup** JSON completo (sin la API key). Al importar se guarda antes una copia de lo actual; se admiten backups de versiones anteriores.
- **Copias automáticas diarias** en el navegador (7 días, ligeras: sin imágenes ni audio), restaurables y descargables desde Ajustes.
- **Costos de Gemini**: tokens y costo estimado por llamada, gasto del mes con proyección, por función, presupuesto mensual con bloqueo opcional y precios editables.
- **Calibración FSRS** con tu historial (fsrs-rs en WebAssembly) a partir de 400 repasos.

### App

- **PWA** instalable, offline-first, con atajos de inicio. Las actualizaciones se avisan con «Actualizar» (no se aplican a mitad de una sesión); «Forzar actualización» en Ajustes.
- **Tema** claro, oscuro o del sistema.
- **Avisos** que se cierran solos (pasar el ratón los pausa, deslizar los cierra); los errores quedan hasta cerrarlos.

## Stack

| Área       | Tecnología                                              |
| ---------- | ------------------------------------------------------- |
| Framework  | SvelteKit + Svelte 5 (runes)                            |
| Build      | Vite 8                                                  |
| Estilos    | Tailwind CSS 4                                          |
| DB local   | IndexedDB vía [Dexie.js](https://dexie.org)             |
| SRS        | ts-fsrs + fsrs-browser (calibración, WASM bajo demanda) |
| IA         | `@google/genai` (Gemini)                                |
| Validación | Zod                                                     |
| Japonés    | wanakana (romaji ↔ kana)                                |
| Anki       | sql.js + fflate (solo al importar `.apkg`)              |
| Runtime/PM | [Bun](https://bun.sh)                                   |
| Adapter    | `adapter-static` → GitHub Pages                         |

## Requisitos

- [Bun](https://bun.sh) (última versión).
- API key de Gemini ([aistudio.google.com](https://aistudio.google.com/apikey)): se ingresa en **Ajustes** y se guarda solo en tu navegador; nunca va en los backups. Restríngela por dominio en Google Cloud. Sin key funcionan el estudio, los mazos, la importación y las estadísticas.

## Desarrollo

```bash
bun install
bun run dev        # servidor local (PORT=5000 por defecto)
```

| Comando           | Qué hace                                           |
| ----------------- | -------------------------------------------------- |
| `bun run dev`     | Servidor de desarrollo                             |
| `bun run build`   | Build de producción a `build/`                     |
| `bun run preview` | Previsualiza el build (reinícialo tras cada build) |
| `bun run check`   | `svelte-kit sync` + `svelte-check` (typecheck)     |
| `bun test`        | Tests de funciones puras (`tests/`)                |
| `bun run lint`    | ESLint                                             |
| `bun run format`  | Prettier (escribe)                                 |

> El service worker **solo** se construye en `build` (no en dev). Para previsualizar con la ruta de producción: `BASE_PATH=/yomigaeru bun run build && BASE_PATH=/yomigaeru bun run preview` (en Git Bash, antepone `MSYS_NO_PATHCONV=1`).

## Estructura

```
src/
  lib/
    db/          # Dexie: schema (v1→v3), cards, decks, images, settings, backup
    gemini/      # cliente (reintentos, errores, costos), generateCard, imageToCards (+textToCards),
                 # grammar, judge, tts, schemas, usage, pricing
    srs/         # fsrs, queue (sesión), quota (cupo/freno), facets (caras/cloze), options (opción múltiple),
                 # stats, optimizer (calibración), constants
    media/       # tts (Web Speech + audio guardado), image (compresión), wav
    gui/         # componentes (Toaster, CardImage, CardProposals, ImportWizard, BarChart, AnswerInput…)
    state/       # app.svelte.ts (ajustes + toasts)
    anki.ts      # TSV/CSV/.apkg
    jp.ts        # normalización y comparación de respuestas
    proposals.ts # propuestas de la IA: duplicados y guardado
    inbox*.ts    # compartir hacia la app (Share Target / File Handling)
    theme.svelte.ts, pwa.ts, furigana.ts
  routes/        # inicio, estudio, mazos, crear, foto, estadisticas, compartir, ajustes
  service-worker.ts
tests/           # bun test
```

### Modelo de datos (IndexedDB / Dexie v3)

- `decks` — mazos (`newPerDay` opcional).
- `cards` — tarjetas: `front` con furigana, `back`, `reading`, `context`, `norm` (frente normalizado, para duplicados), `imageId` + `box`, `facets`, `suspended`, `audioBlob`, `grammar` cacheado.
- `schedules` — programación FSRS por **cara** (`[cardId+facet]` único; `due`/`last_review` en epoch ms).
- `reviewLogs` — historial (`facet`, `via`, `durationMs`).
- `images` — fotos compartidas por las tarjetas que salen de ellas.
- `backups` — copias en el navegador.
- `geminiUsage` — llamadas a Gemini (tokens, costo).
- `settings` — clave/valor (ver `SettingsMap`).

Las bases v1 (`fsrsData` por tarjeta, `imageBlob` por tarjeta) se migran solas al abrir la app.

## Despliegue

Push a `main` dispara GitHub Actions ([.github/workflows/main.yml](.github/workflows/main.yml)): `check` → `bun test` → `build` con `BASE_PATH=/yomigaeru` → deploy a la rama `gh-pages`.

Para servir bajo otra ruta, ajusta `BASE_PATH` (debe coincidir con el nombre del repo).
