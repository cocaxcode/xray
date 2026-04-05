import { ref, computed } from 'vue';

const STORAGE_KEY = 'xray-auth-token';

const token = ref<string | null>(localStorage.getItem(STORAGE_KEY));
const isAuthenticated = computed(() => token.value !== null);
const authError = ref<string | null>(null);

/**
 * Check URL for ?auth=TOKEN (from QR scan)
 */
function handleQrAuth(): boolean {
  const params = new URLSearchParams(window.location.search);
  const authToken = params.get('auth');
  if (authToken) {
    setToken(authToken);
    // Remove token from URL bar (security)
    const url = new URL(window.location.href);
    url.searchParams.delete('auth');
    window.history.replaceState({}, '', url.toString());
    return true;
  }
  return false;
}

function setToken(t: string): void {
  token.value = t;
  localStorage.setItem(STORAGE_KEY, t);
  authError.value = null;
}

function clearToken(): void {
  token.value = null;
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Exchange a 6-digit PIN for a full auth token
 */
async function exchangePin(pin: string): Promise<boolean> {
  authError.value = null;
  try {
    const res = await fetch('/api/auth/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });

    if (res.ok) {
      const data = await res.json();
      setToken(data.token);
      return true;
    }

    const data = await res.json();
    authError.value = data.error || 'PIN incorrecto';
    return false;
  } catch {
    authError.value = 'No se pudo conectar con el servidor';
    return false;
  }
}

/**
 * Returns headers with auth token for fetch requests
 */
function getAuthHeaders(): Record<string, string> {
  if (!token.value) return {};
  return { Authorization: `Bearer ${token.value}` };
}

/**
 * Test if the server requires auth (and if current token is valid)
 * Returns: 'local' (no auth needed), 'authenticated', 'needs_auth'
 */
async function checkAuth(): Promise<'local' | 'authenticated' | 'needs_auth'> {
  try {
    const headers: Record<string, string> = { ...getAuthHeaders() };
    const res = await fetch('/api/health', { headers });

    if (res.ok) {
      return token.value ? 'authenticated' : 'local';
    }

    if (res.status === 401) {
      // Token might be stale
      if (token.value) clearToken();
      return 'needs_auth';
    }

    return 'local';
  } catch {
    return 'needs_auth';
  }
}

export function useAuth() {
  return {
    token,
    isAuthenticated,
    authError,
    handleQrAuth,
    setToken,
    clearToken,
    exchangePin,
    getAuthHeaders,
    checkAuth,
  };
}
