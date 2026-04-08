import { ref } from 'vue';
import { useAuth } from './useAuth';

const autoApprove = ref(false);

async function fetchState(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch('/api/permissions/auto-approve', { headers: getAuthHeaders() });
    if (res.ok) {
      const data = await res.json();
      autoApprove.value = data.enabled;
    }
  } catch { /* server not reachable */ }
}

async function toggle(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch('/api/permissions/auto-approve', {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !autoApprove.value }),
    });
    if (res.ok) {
      const data = await res.json();
      autoApprove.value = data.enabled;
    }
  } catch { /* server not reachable */ }
}

function setFromWS(enabled: boolean): void {
  autoApprove.value = enabled;
}

export function useAutoApprove() {
  return { autoApprove, fetchState, toggle, setFromWS };
}
