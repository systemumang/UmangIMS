const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;
const TARGET_IMAGE_BYTES = 700 * 1024;

export type UploadResult = {
  url: string;
  fileName?: string;
  originalSize: number;
  storedSize: number;
  optimized: boolean;
};

export async function uploadFileToServer(file: File): Promise<UploadResult> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('File is too large. Maximum upload size is 15 MB.');
  const upload = await optimizeUploadFile(file);
  let res = await fetch('/api/uploads', {
    method: 'POST',
    headers: {
      'Content-Type': upload.type || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(upload.name),
      'X-Original-Size': String(file.size),
    },
    body: upload,
  });
  let data = (await res.json().catch(() => null)) as any;

  // Keep uploads working during a rolling deployment while the previous server is still active.
  if (!res.ok && res.status === 400 && /base64/i.test(String(data?.error ?? ''))) {
    res = await fetch('/api/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: upload.name,
        contentType: upload.type || undefined,
        base64: await fileToBase64(upload),
      }),
    });
    data = (await res.json().catch(() => null)) as any;
  }
  if (!res.ok) {
    const message = data?.error ? String(data.error) : `Upload failed (${res.status})`;
    throw new Error(message);
  }
  const url = data?.url ? String(data.url) : '';
  if (!url) throw new Error('Upload failed: missing url');
  const storedSize = Number(data?.storedSize ?? upload.size);
  const originalSize = Number(data?.originalSize ?? file.size);
  return {
    url,
    fileName: data?.fileName ? String(data.fileName) : upload.name,
    originalSize,
    storedSize,
    optimized: Boolean(data?.optimized ?? storedSize < originalSize),
  };
}

export function formatUploadSize(result: Pick<UploadResult, 'originalSize' | 'storedSize' | 'optimized'>): string {
  const stored = formatBytes(result.storedSize);
  return result.optimized ? `${formatBytes(result.originalSize)} -> ${stored}` : stored;
}

async function optimizeUploadFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const image = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: true });
    if (!context) {
      image.close();
      return file;
    }
    context.drawImage(image, 0, 0, width, height);
    image.close();

    const keepPng = file.type === 'image/png' && hasTransparency(context, width, height);
    const outputType = keepPng ? 'image/png' : 'image/jpeg';
    let quality = 0.82;
    let blob = await canvasToBlob(canvas, outputType, quality);
    while (outputType === 'image/jpeg' && blob.size > TARGET_IMAGE_BYTES && quality > 0.62) {
      quality = Math.max(0.62, quality - 0.06);
      blob = await canvasToBlob(canvas, outputType, quality);
    }
    if (blob.size >= file.size) return file;
    return new File([blob], replaceImageExtension(file.name, outputType), {
      type: outputType,
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}

function hasTransparency(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  const pixels = context.getImageData(0, 0, width, height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] < 255) return true;
  }
  return false;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image optimization failed'))), type, quality);
  });
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
function replaceImageExtension(fileName: string, type: string): string {
  const extension = type === 'image/png' ? '.png' : '.jpg';
  const base = fileName.replace(/\.[^.]+$/, '') || 'image';
  return `${base}${extension}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
