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

async function canvasBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', quality = 0.92): Promise<Blob> {
	return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob falló'))), type, quality));
}

/** Gira una imagen 90° en sentido horario. */
export async function rotateImage(file: Blob): Promise<Blob> {
	const bmp = await createImageBitmap(file);
	const canvas = document.createElement('canvas');
	canvas.width = bmp.height;
	canvas.height = bmp.width;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No se pudo obtener el contexto 2D del canvas.');
	ctx.translate(canvas.width, 0);
	ctx.rotate(Math.PI / 2);
	ctx.drawImage(bmp, 0, 0);
	bmp.close();
	return canvasBlob(canvas);
}

/** Recorta una imagen a la caja [ymin, xmin, ymax, xmax] (0–1000). */
export async function cropImage(file: Blob, [y0, x0, y1, x1]: [number, number, number, number]): Promise<Blob> {
	const bmp = await createImageBitmap(file);
	const sx = Math.round((x0 / 1000) * bmp.width);
	const sy = Math.round((y0 / 1000) * bmp.height);
	const sw = Math.max(1, Math.round(((x1 - x0) / 1000) * bmp.width));
	const sh = Math.max(1, Math.round(((y1 - y0) / 1000) * bmp.height));
	const canvas = document.createElement('canvas');
	canvas.width = sw;
	canvas.height = sh;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No se pudo obtener el contexto 2D del canvas.');
	ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
	bmp.close();
	return canvasBlob(canvas);
}
