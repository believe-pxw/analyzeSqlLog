<template>
  <span
    v-if="sourceFile"
    class="source-link"
    :title="fullTitle"
    @click.stop="handleClick"
  >
    <span class="source-icon">📍</span>
    <span class="source-text">{{ label }}</span>
  </span>
  <span v-else style="color: #94a3b8; font-size: 11px;">-</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { openInVsCode, formatSourceLabel } from '../utils/vscode';

const props = defineProps<{
  sourceFile?: string;
  lineNumber?: number;
}>();

const emit = defineEmits<{
  (e: 'toast', msg: string): void;
}>();

const label = computed(() => formatSourceLabel(props.sourceFile || '', props.lineNumber || 1));
const fullTitle = computed(() => `点击在 VSCode 中定位打开:\n${props.sourceFile}:${props.lineNumber || 1}`);

function handleClick() {
  if (props.sourceFile) {
    openInVsCode(props.sourceFile, props.lineNumber || 1, (msg) => emit('toast', msg));
  }
}
</script>

<style scoped>
.source-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: #0284c7;
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  text-decoration: none;
  transition: all 0.15s ease;
  white-space: nowrap;
}
.source-link:hover {
  color: #0369a1;
  text-decoration: underline;
}
.source-icon {
  font-size: 11px;
}
.source-text {
  font-weight: 500;
}
</style>
