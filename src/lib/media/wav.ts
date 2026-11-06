/** Envuelve PCM 16-bit little-endian mono en un WAV reproducible. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1): Blob {
	const header = new ArrayBuffer(44);
	const v = new DataView(header);
	const write = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	const byteRate = sampleRate * channels * 2;
	write(0, 'RIFF');
	v.setUint32(4, 36 + pcm.byteLength, true);
	write(8, 'WAVE');
	write(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, channels, true);
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, byteRate, true);
	v.setUint16(32, channels * 2, true);
	v.setUint16(34, 16, true);
	write(36, 'data');
	v.setUint32(40, pcm.byteLength, true);
	return new Blob([header, pcm as BlobPart], { type: 'audio/wav' });
}

/** base64 → bytes. */
export function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Frecuencia de muestreo desde un mimeType tipo `audio/L16;codec=pcm;rate=24000`. */
export function rateFromMime(mime: string | undefined, fallback = 24000): number {
	const m = mime?.match(/rate=(\d+)/);
	return m ? Number(m[1]) : fallback;
}
