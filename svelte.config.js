import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html',
			precompress: false,
			strict: true,
		}),
		// GitHub Pages sirve el sitio bajo /<repo>. En CI se pasa BASE_PATH=/yomigaeru.
		// En dev/preview local queda vacío.
		paths: {
			base: process.env.BASE_PATH ?? '',
		},
	},
};

export default config;
