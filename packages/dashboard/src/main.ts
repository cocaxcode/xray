import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

// Apply stored theme
const stored = localStorage.getItem('xray-theme');
if (stored === 'light') {
  document.documentElement.classList.remove('dark');
} else {
  document.documentElement.classList.add('dark');
}

createApp(App).mount('#app');
