<template>
  <div
    :class="['sql-code-box', { expanded: isExpanded }]"
    @click="toggleExpand"
    @contextmenu.prevent="handleContextMenuCopy"
    :title="hoverTitle"
    data-test="sql-code-box"
  >
    {{ displayText }}
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { compressSqlColumns } from '../utils/sql';

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

const briefCode = computed(() => compressSqlColumns(props.code || ''));

const displayText = computed(() => {
  if (isExpanded.value) {
    return props.code || '';
  }
  return briefCode.value;
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
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(props.code);
    }
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
  padding: 3px 6px;
  cursor: pointer;
  user-select: text;
  transition: all 0.15s ease;
  
  /* 默认折叠：最多展示 2 行，超出平滑截断 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.sql-code-box:hover {
  border-color: #94a3b8;
  background: #f1f5f9;
}

/* 展开状态：无高度限制，完整呈现换行与格式 */
.sql-code-box.expanded {
  display: block;
  overflow: visible;
  max-height: none !important;
  -webkit-line-clamp: unset;
  background: #ffffff;
  border-color: #0284c7;
  white-space: pre-wrap;
  box-shadow: 0 1px 3px rgba(2, 132, 199, 0.1);
}
</style>
