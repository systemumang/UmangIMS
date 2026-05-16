import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function requireOk<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data && typeof data.error === 'string' && data.error) || fallbackMessage;
    throw new Error(message);
  }
  return data as T;
}
