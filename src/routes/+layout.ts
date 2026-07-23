// App cliente-only (IndexedDB, TTS, Gemini): prerenderizamos el shell y
// desactivamos SSR. adapter-static con fallback index.html sirve el SPA.
export const prerender = true;
export const ssr = false;
