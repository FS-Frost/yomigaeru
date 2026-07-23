export interface CompressedImage {
	blob: Blob;
	/** base64 sin prefijo data URI, para enviar a Gemini. */
	base64: string;
	mimeType: string;
	dataUrl: string;
}

const MAX_DIM = 1280;
const QUALITY = 0.8;

/** Comprime/redimensiona una imagen en el cliente vía canvas antes de enviarla. */
export async function compressImage(file: Blob, maxDim = MAX_DIM, quality = QUALITY): Promise<CompressedImage> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
	const w = Math.round(bitmap.width * scale);
	const h = Math.round(bitmap.height * scale);

	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No se pudo obtener el contexto 2D del canvas.');
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();

	const mimeType = 'image/jpeg';
	const blob = await new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob falló'))), mimeType, quality);
	});

	const dataUrl = await blobToDataUrl(blob);
	return { blob, base64: dataUrl.split(',')[1], mimeType, dataUrl };
}

function blobToDataUrl(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

/** Extrae el primer archivo de imagen de un evento de pegado (Ctrl+V). */
export function imageFromPaste(e: ClipboardEvent): File | null {
	const items = e.clipboardData?.items;
	if (!items) return null;
	for (const item of items) {
		if (item.type.startsWith('image/')) return item.getAsFile();
	}
	return null;
}
