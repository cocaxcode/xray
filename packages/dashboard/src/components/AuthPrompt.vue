<script setup lang="ts">
import { ref } from 'vue';
import { useAuth } from '../composables/useAuth';

const emit = defineEmits<{ authenticated: [] }>();

const { exchangePin, authError } = useAuth();
const digits = ref(['', '', '', '', '', '']);
const inputs = ref<HTMLInputElement[]>([]);
const loading = ref(false);

function handleInput(index: number, event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = input.value.replace(/\D/g, '');
  digits.value[index] = value.slice(-1);

  if (value && index < 5) {
    inputs.value[index + 1]?.focus();
  }

  // Auto-submit when all 6 digits filled
  if (digits.value.every(d => d !== '')) {
    submit();
  }
}

function handleKeydown(index: number, event: KeyboardEvent): void {
  if (event.key === 'Backspace' && !digits.value[index] && index > 0) {
    inputs.value[index - 1]?.focus();
  }
}

function handlePaste(event: ClipboardEvent): void {
  event.preventDefault();
  const pasted = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 6);
  if (!pasted) return;

  for (let i = 0; i < 6; i++) {
    digits.value[i] = pasted[i] || '';
  }

  if (pasted.length === 6) submit();
}

async function submit(): Promise<void> {
  const pin = digits.value.join('');
  if (pin.length !== 6) return;

  loading.value = true;
  const ok = await exchangePin(pin);
  loading.value = false;

  if (ok) {
    emit('authenticated');
  } else {
    // Clear and refocus
    digits.value = ['', '', '', '', '', ''];
    inputs.value[0]?.focus();
  }
}

function setRef(el: unknown, index: number): void {
  if (el) inputs.value[index] = el as HTMLInputElement;
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-bg">
    <div class="flex flex-col items-center gap-6 p-8">
      <span class="text-4xl">🔮</span>
      <h1 class="text-2xl font-heading font-bold text-text">xray</h1>
      <p class="text-muted text-sm text-center max-w-xs">
        Introduce el PIN de 6 digitos que aparece en la terminal de tu PC
      </p>

      <!-- PIN Input -->
      <div class="flex gap-2" @paste="handlePaste">
        <input
          v-for="(_, i) in 6"
          :key="i"
          :ref="(el) => setRef(el, i)"
          type="text"
          inputmode="numeric"
          maxlength="1"
          :value="digits[i]"
          @input="handleInput(i, $event)"
          @keydown="handleKeydown(i, $event)"
          :disabled="loading"
          class="w-12 h-14 text-center text-2xl font-mono font-bold bg-surface border-2 border-border rounded-lg text-text focus:border-cyan focus:outline-none transition-colors"
        />
      </div>

      <!-- Error -->
      <p v-if="authError" class="text-red text-sm">{{ authError }}</p>

      <!-- Loading -->
      <p v-if="loading" class="text-muted text-sm">Verificando...</p>
    </div>
  </div>
</template>
