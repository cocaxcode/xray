import { ref, onUnmounted } from 'vue';
import type { ServerWSEvent, ClientWSEvent } from '../types';

type MessageHandler = (event: ServerWSEvent) => void;

const connected = ref(false);
const reconnecting = ref(false);

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let messageHandlers: MessageHandler[] = [];

const MAX_BACKOFF = 30_000;
const BASE_BACKOFF = 1_000;

function getWsUrl(token: string | null): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  let url = `${protocol}//${host}/ws`;
  if (token) url += `?token=${encodeURIComponent(token)}`;
  return url;
}

function connect(token: string | null): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const url = getWsUrl(token);
  ws = new WebSocket(url);

  ws.onopen = () => {
    connected.value = true;
    reconnecting.value = false;
    reconnectAttempt = 0;
  };

  ws.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data) as ServerWSEvent;
      for (const handler of messageHandlers) {
        handler(parsed);
      }
    } catch {
      // Invalid JSON — ignore
    }
  };

  ws.onclose = () => {
    connected.value = false;
    scheduleReconnect(token);
  };

  ws.onerror = () => {
    // onclose will fire after this
  };
}

function scheduleReconnect(token: string | null): void {
  if (reconnectTimer) return;

  reconnecting.value = true;
  const delay = Math.min(BASE_BACKOFF * Math.pow(2, reconnectAttempt), MAX_BACKOFF);
  reconnectAttempt++;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(token);
  }, delay);
}

function send(event: ClientWSEvent): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

function onMessage(handler: MessageHandler): () => void {
  messageHandlers.push(handler);
  // Return cleanup function
  return () => {
    const idx = messageHandlers.indexOf(handler);
    if (idx >= 0) messageHandlers.splice(idx, 1);
  };
}

function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null; // Prevent reconnect
    ws.close();
    ws = null;
  }
  connected.value = false;
  reconnecting.value = false;
}

export function useWebSocket() {
  onUnmounted(() => {
    // Clean up handlers registered by this component
    // In practice, the app lives for the whole session so this rarely fires
  });

  return {
    connected,
    reconnecting,
    connect,
    disconnect,
    send,
    onMessage,
  };
}
