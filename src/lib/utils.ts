import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function openDocument(url: string) {
  if (!url) return;
  const s = String(url).trim();
  if (s.startsWith('data:')) {
    try {
      const parts = s.split(';base64,');
      if (parts.length === 2) {
        const contentType = parts[0].split(':')[1] || 'application/octet-stream';
        const byteCharacters = atob(parts[1]);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: contentType });
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        return;
      }
    } catch (e) {
      console.error('Failed to open base64 document', e);
    }
  }
  window.open(s, '_blank');
}

export async function requireOk<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data && typeof data.error === 'string' && data.error) || fallbackMessage;
    throw new Error(message);
  }
  return data as T;
}
