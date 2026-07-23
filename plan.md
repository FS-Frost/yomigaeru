Aquí tienes una especificación técnica completa y estructurada, lista para copiar y pegar directamente a **Claude Code**. Está optimizada como un **PRD (Documento de Requisitos de Producto) + Guía de Arquitectura** para que un agente de código entienda el alcance, el stack y los pasos de ejecución sin perderse.

---

```markdown
# PROMPT PARA CLAUDE CODE: Proyecto "Anki-IA Japonés (PWA Estática)"

Actúa como un Arquitecto de Software Senior y Desarrollador Full-Stack Frontend. Vamos a construir una aplicación web estática (PWA) inspirada en Anki para el aprendizaje de japonés, alojada en GitHub Pages, con arquitectura **Offline-First**, almacenamiento masivo local con **IndexedDB** y capacidades inteligentes integradas mediante la **API de Gemini**.

Sigue las especificaciones a continuación para estructurar y crear el proyecto desde cero.

---

## 🏗️ 1. Arquitectura y Stack Tecnológico

- **Hosting & Despliegue:** GitHub Pages (Static Site Generator / SPA bundle).
- **Framework Frontend:** React / Vue / Svelte o JS/TS Vanilla compilado con **Vite**.
- **Base de Datos Local:** **IndexedDB** administrada a través de **Dexie.js**.
- **Motor SRS (Repetición Espaciada):** **`ts-fsrs`** (Free Spaced Repetition Scheduler).
- **Integración de IA:** API de Gemini (versión gratuita/multimodal) mediante `@google/genai` o `fetch` usando la API Key ingresada por el usuario en local.
- **Audio & Voz:** **Web Speech API** (`window.speechSynthesis` con voz `ja-JP`) + **Web Audio API / MediaRecorder** para grabación de voz (shadowing).
- **Procesamiento de Imágenes (OCR/Capturas):** HTML5 `<canvas>` para compresión/redimensionamiento en cliente antes de enviar a Gemini.
- **Estrategia PWA & Offline:** **Vite PWA Plugin** / Workbox (Service Workers + `manifest.json`).

---

## 🗄️ 2. Esquema de Base de Datos (Dexie.js)

Diseña las tablas en IndexedDB con el siguiente modelo de datos aproximado:

1. **`decks`**: `{ id, name, description, createdAt }`
2. **`cards`**:
    - `id`: Auto-incremental / UUID.
    - `deckId`: FK.
    - `front`: Texto principal en japonés (soporta Furigana `<ruby>`).
    - `back`: Traducción al español / significado.
    - `reading`: Lectura pura en Hiragana/Katakana.
    - `context`: Frase de ejemplo o explicación gramatical.
    - `imageBlob`: Blob opcional (captura de pantalla o foto comprimida).
    - `createdAt`: Timestamp.
3. **`fsrsData`**:
    - `cardId`: FK a la tarjeta.
    - `due`: Fecha de próximo repaso.
    - `stability`: Número float.
    - `difficulty`: Número float.
    - `elapsed_days`: Días transcurridos.
    - `scheduled_days`: Días agendados.
    - `reps`: Total de repeticiones.
    - `lapses`: Cantidad de fallos.
    - `state`: Estado FSRS (0: New, 1: Learning, 2: Review, 3: Relearning).
    - `last_review`: Timestamp.
4. **`reviewLogs`**: Registro histórico de cada respuesta para analíticas.
5. **`settings`**: `{ key, value }` (para guardar la `GEMINI_API_KEY`, voz seleccionada, metas de retención FSRS, etc.).

---

## 🎯 3. Funcionalidades Core a Implementar

### A. Módulo de Estudio e Interfaz de Tarjetas

- Soporte nativo para renderizar **Furigana** usando sintaxis `<ruby>漢<rt>かん</rt>字<rt>じ</rt></ruby>`.
- Reproducción automática o por botón de audio en japonés con `window.speechSynthesis`.
- Botones de calificación FSRS (Repetir, Difícil, Bien, Fácil) que actualicen la tabla `fsrsData` usando la librería `ts-fsrs`.
- "Shadowing Mode": Permitir al usuario grabar su voz con el micrófono y reproducirla junto al audio de la tarjeta para comparar.

### B. Módulo Gemini API (Integración Inteligente)

- **Configuración:** Vista donde el usuario ingresa su `GEMINI_API_KEY`. Se guarda en IndexedDB / localStorage.
- **Generador de Tarjetas desde Texto:** Entrada de texto $\rightarrow$ Prompt estructurado con `response_schema` en JSON $\rightarrow$ Generación de tarjeta con Kanji, Furigana, traducción, oraciones de ejemplo y lectura.
- **Evaluador de Producción ("Juez de Respuestas"):** Permite al usuario tipear su respuesta. Gemini evalúa la corrección gramatical y sinonimia antes de calificar.
- **Desglose Gramatical:** Botón "Explicar Gramática" que llama a Gemini para desglosar la oración de la tarjeta en sus partes (partículas, verbos, matices).

### C. Módulo "Foto a Tarjeta" (Multimodal / OCR)

- Soporte para seleccionar archivo, abrir cámara nativa en móvil o **pegar directamente desde el portapapeles (`Ctrl+V`)**.
- Compresión previa de la imagen usando HTML5 Canvas (convertir a WebP / JPEG 80% calidad, máx. 1280px).
- Envío del Payload (Base64 + Prompt) a Gemini para detectar texto en japonés, elegir palabras clave y devolver un JSON estructurado con tarjetas listas para guardar.
- Guardar la imagen comprimida como `Blob` en IndexedDB vinculada a la tarjeta como contexto visual.

### D. PWA, Persistencia y Backup

- Solicitud de `navigator.storage.persist()` al inicio para evitar borrado por el navegador.
- Service Worker para precachear el bundle SPA completo (funcionamiento 100% offline para repasos).
- **Backup & Restore:** Botones de Importación/Exportación en JSON o SQLite para sincronización manual / respaldos.

---

## 🚀 4. Plan de Ejecución por Fases (Fases de Desarrollo)

Construye la aplicación de forma incremental siguiendo estas etapas:

### **Fase 1: Estructura del Proyecto y Almacenamiento Local**

1. Inicializa un proyecto Vite con TypeScript.
2. Configura Dexie.js e implementa el esquema de base de datos.
3. Crea un CRUD básico de Mazos y Tarjetas.
4. Implementa el renderizador de Furigana y el reproductor TTS nativo (`ja-JP`).

### **Fase 2: Motor FSRS y Flujo de Repaso**

1. Integra la librería `ts-fsrs`.
2. Crea la vista de repaso (Pregunta $\rightarrow$ Revelar $\rightarrow$ Botones FSRS).
3. Conecta el feedback del usuario con el cálculo de FSRS y actualiza IndexedDB.

### **Fase 3: Integración de la API de Gemini**

1. Crea la pantalla de Ajustes para almacenar la API Key.
2. Implementa un cliente/servicio para la API de Gemini que utilice respuestas JSON forzadas (`response_schema`).
3. Agrega la vista "Creador de Tarjetas por Texto" y "Explicador Gramatical".

### **Fase 4: Módulo Multimodal "Foto a Tarjeta"**

1. Implementa el gestor de capturas de pantalla / imágenes con Canvas para compresión.
2. Envía las imágenes a Gemini para extracción de vocabulario/tarjetas.
3. Agrega una vista de pre-visualización de las tarjetas extraídas antes de guardarlas en el mazo.

### **Fase 5: PWA, Calidad y Despliegue**

1. Configura el Service Worker con `vite-plugin-pwa` para asegurar soporte Offline-First.
2. Añade las funciones de Importación / Exportación JSON globales.
3. Crea el flujo de CI/CD para GitHub Actions para desplegar automáticamente en GitHub Pages.

---

Por favor, comienza proponiendo la estructura de archivos inicial del proyecto y la configuración de `package.json` para dar el primer paso.
```

Ocuparemos Svelte 5 + tailwind. Ocupa como referencial el proyecto "C:\Users\inazu\Desktop\Mis cosas\repos\asu-web", que ya está configurado para github pages y tiene la estructura de svelte que me interesa seguir.

Pregunta cualquier duda antes de implementar, sé pedante. La idea es refinar lo más posible para que no queden dudas sin responder.
