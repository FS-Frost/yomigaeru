import { expect, test } from 'bun:test';
import { classifyDbError, describeError } from '$lib/errors';
import { GeminiError } from '$lib/gemini/errors';

const named = (name: string, message = 'x', inner?: unknown) => Object.assign(new Error(message), { name, inner });

test.each([
	[named('QuotaExceededError'), 'db-quota', 'backups'],
	[named('AbortError', 'tx', named('QuotaExceededError')), 'db-quota', 'backups'], // Dexie anida el original
	[named('MissingAPIError', 'IndexedDB API missing'), 'db-missing', 'none'],
	[named('VersionError'), 'db-version', 'reload'],
	[named('DatabaseClosedError'), 'db-closed', 'reload'],
	[named('DataCloneError'), 'db-clone', 'none'],
	[named('OpenFailedError'), 'db-open', 'reload'],
	[named('ConstraintError'), 'db-constraint', 'none'],
] as const)('classifyDbError %#', (e, key, action) => {
	expect(classifyDbError(e)).toMatchObject({ key, action });
});

test('classifyDbError ignora errores que no son de datos', () => {
	expect(classifyDbError(new Error('otra cosa'))).toBeNull();
});

test('describeError: IA con acción y detalle técnico', () => {
	const u = describeError(new GeminiError(null, { code: 'auth', detail: 'HTTP 403 key=AIzaSyA1234567890abcdefghijklmnop' }));
	expect(u.action).toBe('settings');
	expect(u.tech).toContain('auth');
	expect(u.tech).not.toContain('AIzaSyA1234567890abcdefghijklmnop');
});

test('describeError: red y genérico', () => {
	expect(describeError(new TypeError('Failed to fetch')).message).toBe('Sin conexión.');
	const g = describeError(new Error('boom'), 'No se pudo guardar');
	expect(g).toMatchObject({ message: 'No se pudo guardar', action: 'retry' });
	expect(g.tech).toContain('boom');
});
