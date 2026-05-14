export type AuthUser = {
  id: string;
  name: string;
  email?: string | null;
  role?: string;
  loginId?: string;
  isActive?: boolean;
  menuAccess?: string[];
};

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function requireOk<T>(res: Response, fallbackMessage: string): Promise<T> {
  const data = await readJsonSafe<T & { error?: string }>(res);
  if (!res.ok) {
    const serverMessage = (data as any)?.error;
    throw new Error(serverMessage ? String(serverMessage) : `${fallbackMessage} (${res.status})`);
  }
  if (data == null) throw new Error(fallbackMessage);
  return data as T;
}

export async function loginWithLoginId(loginId: string, password: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginId, password }),
  });
  const data = await requireOk<{ user: AuthUser }>(res, 'Login failed');
  return data.user;
}

