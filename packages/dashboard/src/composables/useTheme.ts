import { ref } from 'vue';

const STORAGE_KEY = 'xray-theme';

const isDark = ref(
  localStorage.getItem(STORAGE_KEY) !== 'light'
);

function toggle(): void {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('dark', isDark.value);
  localStorage.setItem(STORAGE_KEY, isDark.value ? 'dark' : 'light');
}

export function useTheme() {
  return { isDark, toggle };
}
