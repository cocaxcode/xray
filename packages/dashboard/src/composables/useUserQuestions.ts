import { ref, computed } from 'vue';
import type { UserQuestionNotification } from '../types';

const items = ref<UserQuestionNotification[]>([]);

function add(notif: UserQuestionNotification): void {
  // dedup por id
  if (items.value.some((n) => n.id === notif.id)) return;
  items.value = [...items.value, notif];

  if ('Notification' in window && Notification.permission === 'granted') {
    const title = notif.questionType === 'ExitPlanMode'
      ? 'xray: Claude pide aprobar un plan'
      : 'xray: Claude te hace una pregunta';
    const body = notif.questionType === 'ExitPlanMode'
      ? (notif.projectName ?? notif.sessionId.slice(0, 8))
      : (notif.questions?.[0]?.question ?? '');
    new Notification(title, {
      body,
      icon: '/favicon.svg',
      tag: `question-${notif.id}`,
    });
  }
}

function dismiss(id: string): void {
  items.value = items.value.filter((n) => n.id !== id);
}

const count = computed(() => items.value.length);

export function useUserQuestions() {
  return { items, count, add, dismiss };
}
