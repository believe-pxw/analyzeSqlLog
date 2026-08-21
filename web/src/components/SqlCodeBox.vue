<template>
  <div class="sql-box-container">
    <div
      :class="['sql-code-box', { expanded: isExpanded }]"
      @click="toggleExpand"
      :title="isExpanded ? '点击折叠 SQL' : '点击展开完整 SQL'"
    >
      <div class="sql-content">{{ codeText }}</div>
      <div v-if="!isExpanded && isLong" class="fade-overlay"></div>
    </div>
    <div class="sql-action-bar">
      <button v-if="isLong" class="sql-toggle-btn" @click.stop="toggleExpand">
        {{ isExpanded ? '▲ 收起' : '▼ 展开' }}
      </button>
      <button class="sql-copy-btn" @click.stop="handleCopy" title="复制完整 SQL">
        📋 复制
      </button>
    </div>
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
  return props.code.length > 80 || props.code.includes('\n');
});

function toggleExpand() {
  isExpanded.value = !isExpanded.value;
}

function handleCopy() {
  if (props.code) {
    navigator.clipboard.writeText(props.code);
    emit('toast', '已复制 SQL 至剪贴板');
  }
}
</script>

<style scoped>
.sql-box-container {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sql-code-box {
  position: relative;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.45;
  color: #1e293b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 4px 6px;
  max-height: 42px;
  overflow: hidden;
  word-break: break-all;
  white-space: pre-wrap;
  cursor: pointer;
  transition: max-height 0.2s ease, border-color 0.15s ease;
}
.sql-code-box:hover {
  border-color: #cbd5e1;
  background: #f1f5f9;
}
.sql-code-box.expanded {
  max-height: 400px;
  overflow-y: auto;
  background: #ffffff;
  border-color: #94a3b8;
}
.sql-content {
  user-select: text;
}
.fade-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 16px;
  background: linear-gradient(rgba(248, 250, 252, 0), rgba(248, 250, 252, 0.95));
  pointer-events: none;
}
.sql-action-bar {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 1px;
}
.sql-toggle-btn, .sql-copy-btn {
  background: transparent;
  border: none;
  font-size: 10.5px;
  color: #0284c7;
  cursor: pointer;
  padding: 0 4px;
  border-radius: 2px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.sql-toggle-btn:hover, .sql-copy-btn:hover {
  background: #e0f2fe;
  color: #0369a1;
}
</style>
