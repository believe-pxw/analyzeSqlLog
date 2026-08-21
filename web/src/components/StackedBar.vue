<template>
  <div class="stacked-bar" :title="tooltipText">
    <div class="bar-slice bar-biz" :style="{ width: bizPct + '%' }"></div>
    <div class="bar-slice bar-sql" :style="{ width: sqlPct + '%' }"></div>
    <div class="bar-slice bar-commit" :style="{ width: commitPct + '%' }"></div>
    <div class="bar-slice bar-gap" :style="{ width: gapPct + '%' }"></div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  totalMs: number;
  bizMs: number;
  sqlMs: number;
  commitMs: number;
}>();

const bizPct = computed(() => (props.totalMs > 0 ? Math.round((props.bizMs / props.totalMs) * 100) : 0));
const sqlPct = computed(() => (props.totalMs > 0 ? Math.round((props.sqlMs / props.totalMs) * 100) : 0));
const commitPct = computed(() => (props.totalMs > 0 ? Math.round((props.commitMs / props.totalMs) * 100) : 0));
const gapPct = computed(() => (props.totalMs > 0 ? Math.max(0, 100 - bizPct.value - sqlPct.value - commitPct.value) : 0));

const tooltipText = computed(() => {
  return `业务纯耗时: ${bizPct.value}% | SQL: ${sqlPct.value}% | 事务提交: ${commitPct.value}% | 间隙: ${gapPct.value}%`;
});
</script>

<style scoped>
.stacked-bar {
  display: flex;
  height: 14px;
  border-radius: 3px;
  overflow: hidden;
  background: #e2e8f0;
  min-width: 140px;
}
.bar-slice {
  height: 100%;
  transition: width 0.3s ease;
}
.bar-biz { background: #8b5cf6; }
.bar-sql { background: #0ea5e9; }
.bar-commit { background: #22c55e; }
.bar-gap { background: #cbd5e1; }
</style>
