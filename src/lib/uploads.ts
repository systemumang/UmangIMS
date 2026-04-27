export async function uploadFileToServer(file: File): Promise<{ url: string; fileName?: string }> {
  const base64 = await readFileAsBase64(file);
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || undefined,
      base64,
    }),
  });
  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    const message = data?.error ? String(data.error) : `Upload failed (${res.status})`;
    throw new Error(message);
  }
  const url = data?.url ? String(data.url) : '';
  if (!url) throw new Error('Upload failed: missing url');
  return { url, fileName: data?.fileName ? String(data.fileName) : undefined };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return reject(new Error('Failed to read file'));
      const comma = result.indexOf(',');
      if (comma >= 0) return resolve(result.slice(comma + 1));
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

