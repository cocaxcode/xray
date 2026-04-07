<script setup lang="ts">
defineProps<{
  topic: string;
}>();
</script>

<template>
  <div
    class="absolute top-4 right-4 max-w-[250px] z-20
           bg-surface/80 backdrop-blur-sm border border-border
           rounded-lg px-3 py-2 transition-opacity duration-300"
  >
    <div class="flex items-start gap-1.5">
      <span class="text-[11px] mt-0.5 shrink-0">&#x1F4AC;</span>
      <p class="text-[11px] font-mono text-text line-clamp-3 leading-relaxed">
        {{ topic }}
      </p>
    </div>
  </div>
</template>
