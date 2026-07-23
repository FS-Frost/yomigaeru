# 蘇 Yomigaeru

PWA estática tipo Anki para aprender japonés, con SRS (repetición espaciada) e integración de IA multimodal (Gemini). **Offline-first**: todo se guarda en el navegador (IndexedDB) y funciona sin conexión una vez cargada.

> _yomigaeru_ (蘇る): "revivir / resurgir" — la memoria que vuelve.

## Características

- **Estudio SRS** con [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (algoritmo FSRS). Botones Repetir / Difícil / Bien / Fácil con previsualización de intervalos.
- **Furigana** con notación estilo Anki: `漢字[かんじ]` → renderizado `<ruby>`.
- **TTS** en japonés (`ja-JP`) vía Web Speech API; voz configurable.
- **Mazos y tarjetas**: CRUD completo, imagen de contexto opcional.
- **IA (Gemini)**:
    - Generar tarjeta desde texto.
    - Foto/captura → tarjetas (multimodal, con compresión de imagen en cliente).
    - Juez de producción: escribes tu respuesta y la IA la evalúa.
    - Desglose gramatical de la oración (cacheado por tarjeta).
- **Backup**: exportar / importar toda la base de datos (JSON, vía `dexie-export-import`).
- **PWA**: service worker offline-first, almacenamiento persistente (`navigator.storage.persist()`), instalable.

## Stack

| Área       | Tecnología                                  |
| ---------- | ------------------------------------------- |
| Framework  | SvelteKit + Svelte 5 (runes)                |
| Build      | Vite 8                                      |
| Estilos    | Tailwind CSS 4                              |
| DB local   | IndexedDB vía [Dexie.js](https://dexie.org) |
| SRS        | ts-fsrs                                     |
| IA         | `@google/genai` (Gemini)                    |
| Validación | Zod                                         |
| Runtime/PM | [Bun](https://bun.sh)                       |
| Adapter    | `adapter-static` → GitHub Pages             |

## Requisitos

- [Bun](https://bun.sh) (última versión).
- API key de Gemini ([aistudio.google.com](https://aistudio.google.com/apikey)) — se ingresa en **Ajustes** y se guarda solo en tu navegador. No se envía a ningún servidor propio.

## Desarrollo

```bash
bun install
bun run dev        # servidor local (PORT=5000 por defecto)
```

| Comando           | Qué hace                                       |
| ----------------- | ---------------------------------------------- |
| `bun run dev`     | Servidor de desarrollo                         |
| `bun run build`   | Build de producción a `build/`                 |
| `bun run preview` | Previsualiza el build                          |
| `bun run check`   | `svelte-kit sync` + `svelte-check` (typecheck) |
| `bun run format`  | Prettier escribe                               |
| `bun run lint`    | Prettier verifica                              |

> El service worker **solo** se construye en `build` (no en dev).

## Estructura

```
src/
  lib/
    db/         # Dexie: schema, decks, cards, settings, backup
    gemini/     # cliente + funciones IA (generateCard, imageToCards, judge, grammar) + schemas
    srs/        # fsrs.ts (wrapper ts-fsrs), queue.ts (tarjetas vencidas)
    media/      # tts.ts (Web Speech), image.ts (compresión canvas)
    gui/        # componentes Svelte reutilizables + nav/
    state/      # app.svelte.ts (estado global runes: ajustes + toasts)
    furigana.ts # parser 漢字[かんじ] -> segmentos ruby
    pwa.ts      # persistencia + registro del SW
  routes/       # +page (inicio), estudio, mazos, crear, foto, ajustes
  service-worker.ts
```

### Modelo de datos (IndexedDB / Dexie v1)

- `decks` — mazos.
- `cards` — tarjetas (`front` con furigana, `back` español, `reading`, `context`, `imageBlob`, `grammar` cacheado).
- `fsrsData` — estado de programación FSRS por tarjeta (`due`/`last_review` como epoch ms; índice `[state+due]`).
- `reviewLogs` — historial de repasos.
- `settings` — clave/valor (`apiKey`, `geminiModel`, `ttsVoiceURI`, `requestRetention`).

## Despliegue

Push a `main` dispara GitHub Actions ([.github/workflows/main.yml](.github/workflows/main.yml)): `check` → `build` con `BASE_PATH=/yomigaeru` → deploy a la rama `gh-pages`.

Para servir bajo otra ruta, ajusta `BASE_PATH` (debe coincidir con el nombre del repo).
