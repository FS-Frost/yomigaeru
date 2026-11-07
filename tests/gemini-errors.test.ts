import { describe, expect, test } from 'bun:test';
import { classifyError, errorMessage, finishError, GeminiError, isBadOutput, isTransient, redact, snippet } from '$lib/gemini/errors';

const sdkError = (status: number, msg = 'x') => Object.assign(new Error(`{"error":{"code":${status},"message":"${msg}"}}`), { status });

describe('classifyError', () => {
	test.each([
		[500, 'unavailable'],
		[502, 'unavailable'],
		[503, 'unavailable'],
		[504, 'unavailable'],
		[429, 'quota'],
		[401, 'auth'],
		[403, 'auth'],
		[404, 'model-not-found'],
		[400, 'bad-request'],
	] as const)('HTTP %d → %s', (status, code) => {
		expect(classifyError(sdkError(status)).code).toBe(code);
	});

	test('key inválida (400 API_KEY_INVALID) → auth con acción Ajustes', () => {
		const e = classifyError(sdkError(400, 'API key not valid. Please pass a valid API key.'));
		expect(e.code).toBe('auth');
		expect(e.action).toBe('settings');
	});

	test('red caída → offline', () => {
		expect(classifyError(new TypeError('Failed to fetch')).code).toBe('offline');
	});

	test('AbortError → aborted', () => {
		const e = new Error('The operation was aborted');
		e.name = 'AbortError';
		expect(classifyError(e).code).toBe('aborted');
	});

	test('BudgetError conserva su mensaje', () => {
		const e = new Error('Presupuesto superado');
		e.name = 'BudgetError';
		const g = classifyError(e);
		expect(g.code).toBe('budget');
		expect(g.message).toBe('Presupuesto superado');
	});

	test('un GeminiError pasa tal cual', () => {
		const g = new GeminiError(null, { code: 'loop' });
		expect(classifyError(g)).toBe(g);
	});

	test('el detalle nunca incluye la API key', () => {
		const e = classifyError(new Error('bad request https://x/?key=AIzaSyA1234567890abcdefghijklmnop&alt=sse'));
		expect(e.detail).not.toContain('AIzaSyA1234567890abcdefghijklmnop');
		expect(e.message).not.toContain('AIzaSyA1234567890abcdefghijklmnop');
	});

	test('mensaje legible desde JSON anidado', () => {
		expect(classifyError(sdkError(400, 'Invalid schema')).message).toContain('Invalid schema');
	});
});

describe('finishError', () => {
	test('STOP y ausente → null', () => {
		expect(finishError('STOP')).toBeNull();
		expect(finishError(undefined)).toBeNull();
	});
	test.each([
		['MAX_TOKENS', 'truncated'],
		['SAFETY', 'safety'],
		['PROHIBITED_CONTENT', 'safety'],
		['RECITATION', 'recitation'],
		['OTHER', 'invalid'],
	] as const)('%s → %s', (reason, code) => {
		expect(finishError(reason)?.code).toBe(code);
	});
});

test('isTransient / isBadOutput', () => {
	expect(isTransient(sdkError(503))).toBe(true);
	expect(isTransient(sdkError(400))).toBe(false);
	expect(isTransient(new GeminiError(null, { code: 'quota' }))).toBe(true);
	expect(isBadOutput(new GeminiError(null, { code: 'loop' }))).toBe(true);
	expect(isBadOutput(new GeminiError(null, { code: 'truncated' }))).toBe(true);
	expect(isBadOutput(new GeminiError(null, { code: 'auth' }))).toBe(false);
	expect(isBadOutput(new Error('x'))).toBe(false);
});

test('mensajes por defecto en español y acción', () => {
	const e = new GeminiError(null, { code: 'no-key' });
	expect(e.message).toContain('API key');
	expect(e.action).toBe('settings');
	expect(errorMessage(sdkError(429))).toContain('limitó');
});

test('withPartial conserva código y detalle', () => {
	const e = new GeminiError(null, { code: 'loop', detail: 'd' }).withPartial('{"cards":[');
	expect(e.code).toBe('loop');
	expect(e.detail).toBe('d');
	expect(e.partial).toBe('{"cards":[');
});

test('redact y snippet', () => {
	expect(redact('k=AIzaSyA1234567890abcdefghijklmnop')).toBe('k=AIza…');
	expect(snippet('a'.repeat(1000), 10)).toContain('[980 caracteres]');
	expect(snippet('corto')).toBe('corto');
});
