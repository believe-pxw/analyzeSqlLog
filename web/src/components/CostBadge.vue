<template>
  <span :class="['cost-badge', badgeClass]">{{ formattedCost }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  costMs: number;
  unit?: string;
}>(), {
  unit: 'ms'
});

const formattedCost = computed(() => {
  return `${Number(props.costMs).toLocaleString()} ${props.unit}`;
});

const badgeClass = computed(() => {
  const c = props.costMs;
  if (c >= 10000) return 'cost-red';
  if (c >= 1000) return 'cost-yellow';
  if (c >= 500) return 'cost-orange';
  if (c >= 100) return 'cost-purple';
  if (c <= 10 && c >= 0) return 'cost-green';
  return 'cost-blue';
});
</script>

<style scoped>
.cost-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11.5px;
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
.cost-red { background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; }
.cost-yellow { background: #fef3c7; color: #d97706; border: 1px solid #fde68a; }
.cost-orange { background: #ffedd5; color: #ea580c; border: 1px solid #fed7aa; }
.cost-purple { background: #ede9fe; color: #7c3aed; border: 1px solid #ddd6fe; }
.cost-blue { background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; }
.cost-green { background: #dcfce7; color: #16a34a; border: 1px solid #bbf7d0; }
</style>
