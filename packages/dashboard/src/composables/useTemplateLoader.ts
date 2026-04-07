import { ref } from 'vue';
import type { TemplateConfig } from '../engine/types';
import { preloadAll } from '../engine/spriteLoader';

const loading = ref(false);
const error = ref<string | null>(null);
const progress = ref(0);

const cache = new Map<string, { config: TemplateConfig; images: Map<string, HTMLImageElement> }>();

async function load(name: string): Promise<{ config: TemplateConfig; images: Map<string, HTMLImageElement> }> {
  // Disable cache during development — always reload
  // const cached = cache.get(name);
  // if (cached) return cached;

  loading.value = true;
  error.value = null;
  progress.value = 0;

  try {
    // Fetch template.json
    const res = await fetch(`/templates/${name}/template.json`);
    if (!res.ok) {
      throw new Error(`Template "${name}" no encontrado (${res.status})`);
    }

    const json = await res.json();
    const config = validate(json);

    // Preload all sprite PNGs
    const basePath = `/templates/${name}`;
    const images = await preloadAll(config, basePath, (p) => {
      progress.value = p;
    });

    const result = { config, images };
    cache.set(name, result);

    loading.value = false;
    progress.value = 100;
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido cargando template';
    error.value = msg;
    loading.value = false;
    throw err;
  }
}

function validate(json: unknown): TemplateConfig {
  if (!json || typeof json !== 'object') {
    throw new Error('template.json invalido: no es un objeto');
  }

  const obj = json as Record<string, unknown>;
  const required: Array<[string, string]> = [
    ['name', 'string'],
    ['tileSize', 'number'],
    ['maps', 'object'],
    ['sprites', 'object'],
    ['stateMap', 'object'],
    ['agentTypes', 'object'],
    ['equipmentMap', 'object'],
    ['environmentMap', 'object'],
  ];

  for (const [field, type] of required) {
    if (!(field in obj)) {
      throw new Error(`Campo requerido faltante: ${field}`);
    }
    if (typeof obj[field] !== type) {
      throw new Error(`Campo "${field}" debe ser ${type}, recibido ${typeof obj[field]}`);
    }
  }

  // Validate maps has at least one size
  const maps = obj.maps as Record<string, unknown>;
  if (!maps.small && !maps.medium && !maps.large) {
    throw new Error('maps debe tener al menos un tamano: small, medium, o large');
  }

  // Validate each map has required fields
  for (const size of ['small', 'medium', 'large'] as const) {
    if (maps[size]) {
      const mapDef = maps[size] as Record<string, unknown>;
      if (!mapDef.mapSize || !mapDef.map || !mapDef.walkable || !mapDef.zones) {
        throw new Error(`maps.${size} debe tener: mapSize, map, walkable, zones`);
      }
    }
  }

  return json as TemplateConfig;
}

export function useTemplateLoader() {
  return {
    loading,
    error,
    progress,
    load,
  };
}
