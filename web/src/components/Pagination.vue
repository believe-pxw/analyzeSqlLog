<template>
  <div class="pagination" v-if="total > 0">
    <div class="page-info">
      共 <strong>{{ total.toLocaleString() }}</strong> 条记录，当前第 <strong>{{ page }} / {{ totalPages }}</strong> 页
    </div>
    <div class="page-ctrls">
      <button class="page-btn" :disabled="page <= 1" @click="emit('update:page', 1)">首页</button>
      <button class="page-btn" :disabled="page <= 1" @click="emit('update:page', page - 1)">上一页</button>
      <button class="page-btn" :disabled="page >= totalPages" @click="emit('update:page', page + 1)">下一页</button>
      <button class="page-btn" :disabled="page >= totalPages" @click="emit('update:page', totalPages)">末页</button>
      <select class="page-select" :value="pageSize" @change="onPageSizeChange($event)">
        <option :value="10">10 条/页</option>
        <option :value="20">20 条/页</option>
        <option :value="50">50 条/页</option>
        <option :value="100">100 条/页</option>
        <option :value="200">200 条/页</option>
      </select>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  page: number;
  pageSize: number;
  total: number;
}>();

const emit = defineEmits<{
  (e: 'update:page', page: number): void;
  (e: 'update:pageSize', pageSize: number): void;
}>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));

function onPageSizeChange(e: Event) {
  const target = e.target as HTMLSelectElement;
  const newSize = parseInt(target.value, 10);
  emit('update:pageSize', newSize);
  emit('update:page', 1);
}
</script>

<style scoped>
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0;
  font-size: 12px;
  color: var(--text-muted);
}
.page-ctrls {
  display: flex;
  gap: 4px;
  align-items: center;
}
.page-btn {
  padding: 2px 8px;
  border: 1px solid var(--border);
  background: #ffffff;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11.5px;
  transition: all 0.15s ease;
}
.page-btn:hover:not(:disabled) {
  background: #f1f5f9;
  color: var(--accent);
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.page-select {
  border: 1px solid var(--border);
  background: #ffffff;
  padding: 2px 4px;
  border-radius: 3px;
  font-size: 11.5px;
  outline: none;
}
</style>
