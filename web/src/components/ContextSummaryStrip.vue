<template>
  <div class="context-summary-strip">
    <div class="strip-left">
      <span class="strip-title">{{ title }}</span>
      <span v-if="subtitle" class="strip-subtitle">{{ subtitle }}</span>
    </div>
    <div class="strip-right">
      <slot>
        <span v-if="totalCostMs !== undefined" class="strip-metric">
          总耗时: <span class="strip-val red">{{ totalCostMs.toLocaleString() }} ms</span>
        </span>
        <span v-if="totalCount !== undefined" class="strip-metric">
          总数量: <span class="strip-val">{{ totalCount.toLocaleString() }}</span>
        </span>
        <span v-if="totalTraces !== undefined" class="strip-metric">
          独立 Trace: <span class="strip-val">{{ totalTraces.toLocaleString() }}</span>
        </span>
        <span v-if="maxCostMs !== undefined" class="strip-metric">
          最高单条: <span class="strip-val red">{{ maxCostMs.toLocaleString() }} ms</span>
        </span>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  subtitle?: string;
  totalCostMs?: number;
  totalCount?: number;
  totalTraces?: number;
  maxCostMs?: number;
}>();
</script>

<style scoped>
.context-summary-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  margin-bottom: 10px;
  font-size: 11.5px;
}

.strip-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 700;
  color: #1e293b;
}

.strip-title {
  color: #0369a1;
}

.strip-subtitle {
  font-weight: 500;
  color: #64748b;
  font-size: 11px;
}

.strip-right {
  display: flex;
  align-items: center;
  gap: 14px;
}

.strip-metric {
  color: #475569;
}

.strip-val {
  font-weight: 700;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: #0f172a;
}

.strip-val.red {
  color: #dc2626;
}
</style>
