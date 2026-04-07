<script setup lang="ts">
import { useConfig } from '../composables/useConfig';
import { useTheme } from '../composables/useTheme';

const emit = defineEmits<{ close: [] }>();
const { config, saveConfig } = useConfig();
const { isDark, toggle: toggleTheme } = useTheme();

async function setTheme(theme: 'dark' | 'light' | 'auto'): Promise<void> {
  await saveConfig({ dashboard: { theme } });
  if (theme === 'dark') { if (!isDark.value) toggleTheme(); }
  else if (theme === 'light') { if (isDark.value) toggleTheme(); }
  else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark !== isDark.value) toggleTheme();
  }
}

async function updateSetting(key: string, value: unknown): Promise<void> {
  const parts = key.split('.');
  const update: Record<string, unknown> = {};
  let current = update;
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  await saveConfig(update);
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end" @click.self="emit('close')">
    <div class="absolute inset-0 bg-black/40" @click="emit('close')" />

    <div class="relative w-80 h-full bg-surface border-l border-border overflow-y-auto">
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-surface z-10">
        <h2 class="text-sm font-heading font-semibold text-text">Configuracion</h2>
        <button @click="emit('close')" class="text-muted hover:text-text p-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div v-if="config" class="p-4 space-y-6">
        <!-- Server -->
        <section>
          <h3 class="text-xs font-mono text-muted uppercase tracking-wider mb-3">Servidor</h3>
          <div class="space-y-3">
            <div>
              <label class="text-xs text-text block mb-1">Dominio publico (para QR)</label>
              <input
                type="text"
                :value="config.server.domain"
                @change="updateSetting('server.domain', ($event.target as HTMLInputElement).value)"
                placeholder="https://xray.tudominio.dev"
                class="w-full h-8 px-2 text-xs font-mono bg-bg border border-border rounded-md text-text placeholder:text-muted focus:border-cyan focus:outline-none"
              />
            </div>
          </div>
        </section>

        <!-- Dashboard -->
        <section>
          <h3 class="text-xs font-mono text-muted uppercase tracking-wider mb-3">Dashboard</h3>
          <div class="space-y-3">
            <div>
              <label class="text-xs text-text block mb-1">Tema</label>
              <div class="flex gap-1">
                <button
                  v-for="t in ['dark', 'light', 'auto'] as const"
                  :key="t"
                  @click="setTheme(t)"
                  class="flex-1 text-[11px] font-mono py-1.5 rounded transition-colors"
                  :class="config.dashboard.theme === t ? 'bg-cyan/15 text-cyan' : 'bg-bg text-muted hover:text-text'"
                >
                  {{ t === 'dark' ? 'Oscuro' : t === 'light' ? 'Claro' : 'Auto' }}
                </button>
              </div>
            </div>
            <label class="flex items-center justify-between text-xs">
              <span class="text-text">Modo compacto</span>
              <input
                type="checkbox"
                :checked="config.dashboard.compact"
                @change="updateSetting('dashboard.compact', ($event.target as HTMLInputElement).checked)"
                class="h-4 w-4 accent-cyan"
              />
            </label>
          </div>
        </section>

        <!-- Sessions -->
        <section>
          <h3 class="text-xs font-mono text-muted uppercase tracking-wider mb-3">Sesiones</h3>
          <div class="space-y-3">
            <div>
              <label class="text-xs text-text block mb-1">
                Timeout inactividad: {{ config.sessions.stalenessMinutes }} min
              </label>
              <input
                type="range"
                min="5" max="120"
                :value="config.sessions.stalenessMinutes"
                @input="updateSetting('sessions.staleness_minutes', parseInt(($event.target as HTMLInputElement).value))"
                class="w-full accent-cyan"
              />
            </div>
            <div>
              <label class="text-xs text-text block mb-1">
                Auto-limpiar stopped: {{ config.sessions.autoCleanupHours }}h
              </label>
              <input
                type="range"
                min="1" max="72"
                :value="config.sessions.autoCleanupHours"
                @input="updateSetting('sessions.auto_cleanup_hours', parseInt(($event.target as HTMLInputElement).value))"
                class="w-full accent-cyan"
              />
            </div>
          </div>
        </section>

        <!-- Permissions -->
        <section>
          <h3 class="text-xs font-mono text-muted uppercase tracking-wider mb-3">Permisos</h3>
          <div class="space-y-3">
            <div>
              <label class="text-xs text-text block mb-1">Modo</label>
              <div class="flex gap-1">
                <button
                  v-for="m in ['intercept', 'observe'] as const"
                  :key="m"
                  @click="updateSetting('permissions.mode', m)"
                  class="flex-1 text-[11px] font-mono py-1.5 rounded transition-colors"
                  :class="config.permissions.mode === m ? 'bg-cyan/15 text-cyan' : 'bg-bg text-muted hover:text-text'"
                >
                  {{ m === 'intercept' ? 'Interceptar' : 'Observar' }}
                </button>
              </div>
            </div>
            <label class="flex items-center justify-between text-xs">
              <span class="text-text">Sonido</span>
              <input
                type="checkbox"
                :checked="config.permissions.sound"
                @change="updateSetting('permissions.sound', ($event.target as HTMLInputElement).checked)"
                class="h-4 w-4 accent-cyan"
              />
            </label>
          </div>
        </section>

        <!-- Display -->
        <section>
          <h3 class="text-xs font-mono text-muted uppercase tracking-wider mb-3">Mostrar</h3>
          <div class="space-y-2">
            <label v-for="(label, key) in { contextBar: 'Barra de contexto', tokens: 'Tokens', mcps: 'MCPs', skills: 'Skills', agents: 'Agentes' }" :key="key" class="flex items-center justify-between text-xs">
              <span class="text-text">{{ label }}</span>
              <input
                type="checkbox"
                :checked="(config.display as Record<string, boolean>)[key]"
                @change="updateSetting(`display.${key}`, ($event.target as HTMLInputElement).checked)"
                class="h-4 w-4 accent-cyan"
              />
            </label>
          </div>
        </section>

        <!-- Avatar (Animated Views) -->
        <section>
          <h3 class="text-xs font-mono text-muted uppercase tracking-wider mb-3">Avatar</h3>
          <div class="space-y-3">
            <div>
              <label class="text-xs text-text block mb-1">Nombre del agente principal</label>
              <input
                type="text"
                :value="config.avatar?.name || 'Agent'"
                @change="updateSetting('avatar.name', ($event.target as HTMLInputElement).value)"
                placeholder="Agent"
                class="w-full h-8 px-2 text-xs font-mono bg-bg border border-border rounded-md text-text placeholder:text-muted focus:border-cyan focus:outline-none"
              />
              <p class="text-[9px] text-muted mt-1">Nombre que aparece sobre tu personaje en las vistas animadas</p>
            </div>
          </div>
        </section>

        <!-- Data -->
        <section>
          <h3 class="text-xs font-mono text-muted uppercase tracking-wider mb-3">Datos</h3>
          <div class="space-y-3">
            <div>
              <label class="text-xs text-text block mb-1">
                Retencion eventos: {{ config.data.retentionEventsDays }} dias
              </label>
              <input
                type="range"
                min="1" max="30"
                :value="config.data.retentionEventsDays"
                @input="updateSetting('data.retention_events_days', parseInt(($event.target as HTMLInputElement).value))"
                class="w-full accent-cyan"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
