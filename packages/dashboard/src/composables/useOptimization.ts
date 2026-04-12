import { ref } from 'vue';
import type { OptimizationData, ServerWSEvent } from '../types';
import { useAuth } from './useAuth';

const optimizationCache = ref<Map<string, OptimizationData>>(new Map());
const loading = ref(false);

export function useOptimization() {
  const { getAuthHeaders } = useAuth();

  async function fetchOptimizationData(sessionId: string): Promise<OptimizationData | null> {
    loading.value = true;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/optimization`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as OptimizationData;
      optimizationCache.value = new Map(optimizationCache.value).set(sessionId, data);
      return data;
    } catch {
      return null;
    } finally {
      loading.value = false;
    }
  }

  function getOptimizationData(sessionId: string): OptimizationData | null {
    return optimizationCache.value.get(sessionId) ?? null;
  }

  function handleWSEvent(event: ServerWSEvent): void {
    if (event.type === 'optimization:event') {
      const { sessionId, source, tokens } = event.data;
      const cached = optimizationCache.value.get(sessionId);
      if (cached) {
        // Update realtime breakdown in-place
        const existing = cached.realtimeBreakdown.find((b) => b.source === source);
        if (existing) {
          existing.count++;
          existing.tokens += tokens;
        } else {
          cached.realtimeBreakdown.push({ source, count: 1, tokens });
        }
        cached.eventCount++;
        // Trigger reactivity
        optimizationCache.value = new Map(optimizationCache.value);
      }
    } else if (event.type === 'optimization:summary') {
      // Summary arrived — re-fetch full data
      const { sessionId } = event.data;
      void fetchOptimizationData(sessionId);
    }
  }

  return {
    loading,
    fetchOptimizationData,
    getOptimizationData,
    handleWSEvent,
  };
}
