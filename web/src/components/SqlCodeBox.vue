<template>
  <div
    :class="['sql-code-box', { expanded: isExpanded, 'has-more': isLong }]"
    @click="toggleExpand"
    @contextmenu.prevent="handleContextMenuCopy"
    :title="hoverTitle"
  >
    <div class="sql-content">{{ codeText }}</div>
    <div v-if="!isExpanded && isLong" class="expand-hint">▼ 点击展开全部 (右键复制)</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = withDefaults(defineProps<{
  code: string;
  defaultExpanded?: boolean;
}>(), {
  defaultExpanded: false,
});

const emit = defineEmits<{
  (e: 'toast', msg: string): void;
}>();

const isExpanded = ref(props.defaultExpanded);

const codeText = computed(() => props.code || '');
const isLong = computed(() => {
  if (!props.code) return false;
  return props.code.length > 70 || props.code.includes('\n');
});

const hoverTitle = computed(() => {
  if (isExpanded.value) return '左键点击折叠 | 右键复制完整 SQL';
  return '左键点击展开完整 SQL | 右键复制完整 SQL';
});

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
}

function handleContextMenuCopy() {
  if (props.code) {
    navigator.clipboard.writeText(props.code);
    emit('toast', '已复制完整 SQL 语句至剪贴板');
  }
}
</script>

<style scoped>
.sql-code-box {
  position: relative;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 11.5px;
  line-height: 1.45;
  color: #1e293b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 4px 6px;
  max-height: 40px;
  overflow: hidden;
  word-break: break-all;
  white-space: pre-wrap;
  cursor: pointer;
  user-select: text;
  transition: border-color 0.15s ease, background-color 0.15s ease;
}
.sql-code-box:hover {
  border-color: #94a3b8;
  background: #f1f5f9;
}
.sql-code-box.expanded {
  max-height: none !important;
  overflow: visible;
  background: #ffffff;
  border-color: #0284c7;
}
.sql-content {
  pointer-events: auto;
}
.expand-hint {
  font-size: 10px;
  color: #0284c7;
  font-weight: 600;
  margin-top: 2px;
  text-align: right;
  opacity: 0.85;
}
.sql-code-box:hover .expand-hint {
  opacity: 1;
}
</style>
