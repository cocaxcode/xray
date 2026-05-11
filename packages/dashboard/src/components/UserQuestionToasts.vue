<script setup lang="ts">
import { useUserQuestions } from '../composables/useUserQuestions';

const { items, dismiss } = useUserQuestions();
</script>

<template>
  <div class="fixed top-16 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
    <transition-group name="toast">
      <div
        v-for="notif in items"
        :key="notif.id"
        class="pointer-events-auto bg-surface border border-purple/40 rounded-lg shadow-lg p-3 text-xs"
      >
        <!-- Header -->
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-purple animate-pulse" />
            <span class="font-mono text-purple uppercase tracking-wider text-[10px]">
              {{ notif.questionType === 'ExitPlanMode' ? 'Aprobar plan' : 'Pregunta' }}
            </span>
            <span v-if="notif.projectName" class="text-muted text-[10px]">
              {{ notif.projectName }}
            </span>
          </div>
          <button
            @click="dismiss(notif.id)"
            class="text-muted hover:text-text"
            title="Cerrar"
          >
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- ExitPlanMode -->
        <div v-if="notif.questionType === 'ExitPlanMode'" class="space-y-1">
          <p class="text-text">Claude propone un plan y espera tu aprobacion en el terminal.</p>
          <pre v-if="notif.plan" class="text-[10px] text-muted bg-bg p-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap font-mono">{{ notif.plan.slice(0, 400) }}{{ notif.plan.length > 400 ? '...' : '' }}</pre>
        </div>

        <!-- AskUserQuestion -->
        <div v-else class="space-y-2">
          <div v-for="(q, qi) in notif.questions" :key="qi" class="space-y-1">
            <p class="text-text font-medium">{{ q.question }}</p>
            <ul class="space-y-0.5">
              <li
                v-for="(opt, oi) in q.options"
                :key="oi"
                class="text-muted text-[11px] pl-3 border-l border-border"
              >
                <span class="text-text">{{ opt.label }}</span>
                <span v-if="opt.description"> — {{ opt.description }}</span>
              </li>
            </ul>
          </div>
          <p class="text-[10px] text-muted italic mt-2">Responde en el terminal de Claude.</p>
        </div>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from { opacity: 0; transform: translateX(20px); }
.toast-leave-to { opacity: 0; transform: translateX(20px); }
</style>
