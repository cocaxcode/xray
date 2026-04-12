import { ref } from 'vue';
import type { TemplateMeta } from '../types';
import { useAuth } from './useAuth';

export type ViewMode = 'panel' | 'optimization' | string;

const STORAGE_KEY = 'xray-view-mode';

const current = ref<ViewMode>(localStorage.getItem(STORAGE_KEY) || 'panel');
const availableTemplates = ref<TemplateMeta[]>([]);

function setView(mode: ViewMode): void {
  if (mode !== 'panel' && mode !== 'optimization') {
    // Verify template exists
    const exists = availableTemplates.value.some(t => t.name.toLowerCase().replace(/\s+/g, '-') === mode);
    if (!exists) {
      mode = 'panel';
    }
  }

  current.value = mode;
  localStorage.setItem(STORAGE_KEY, mode);
}

async function loadAvailableTemplates(): Promise<void> {
  const { getAuthHeaders } = useAuth();
  try {
    const res = await fetch('/api/templates', { headers: getAuthHeaders() });
    if (res.ok) {
      availableTemplates.value = await res.json();
    }
  } catch {
    // Server not reachable
  }

  // Note: don't reset current view here — if user stored "warriors" in localStorage
  // and the template exists on disk, the SceneView will load it directly.
  // Only reset if user explicitly tries to switch to a non-existent template.
}

/**
 * Get template folder name from ViewMode string.
 * Templates are referenced by their folder name (lowercase, kebab-case).
 */
function getTemplateFolderName(mode: ViewMode): string {
  return mode;
}

export function useViewMode() {
  return {
    current,
    availableTemplates,
    setView,
    loadAvailableTemplates,
    getTemplateFolderName,
  };
}
