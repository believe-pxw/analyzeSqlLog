<template>
  <div class="tab-panel">
    <div class="toolbar">
      <div class="input-group">
        <span style="font-weight: 700; color: #0284c7;">Trace ID:</span>
        <input
          type="text"
          v-model="traceId"
          @input="loadData(1)"
          placeholder="输入 Trace ID 分析单次链路..."
          style="width: 260px;"
        />
      </div>
      <div class="toolbar-right">
        <button class="btn-action btn-primary" @click="$emit('jump-tab', 'app-logs', traceId)">📜 纯净日志透视</button>
        <button class="btn-action" @click="$emit('jump-tab', 'perf-tree', traceId)">⚡ 性能树剖析</button>
      </div>
    </div>

    <!-- 专属上下文度量条 -->
    <ContextSummaryStrip
      title="🔗 Trace 链路 SQL 时序回放"
      :subtitle="traceId ? `Trace: ${traceId}` : '未指定 TraceID'"
      :totalCount="total"
      :totalCostMs="statsTotalCost"
      :maxCostMs="statsMaxCost"
    />

    <table>
      <thead>
        <tr>
          <th class="col-nowrap" style="width: 40px;">#</th>
          <th class="col-time">执行时刻</th>
          <th class="col-nowrap">耗时</th>
          <th class="col-nowrap">影响行数</th>
          <th class="col-nowrap">源码定位</th>
          <th>执行 SQL 语句 (点击展开/收起)</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="6" class="empty-cell">正在提取链路 SQL 序列...</td>
        </tr>
        <tr v-else-if="list.length === 0">
          <td colspan="6" class="empty-cell">请输入有效 Trace ID 查看该链路下的 SQL 调用时间线</td>
        </tr>
        <tr v-for="(r, idx) in list" :key="r.id || idx">
          <td class="col-nowrap">{{ (page - 1) * pageSize + idx + 1 }}</td>
          <td class="col-time">{{ r.log_time }}</td>
          <td class="col-nowrap"><CostBadge :costMs="r.exec_time_ms" /></td>
          <td class="col-nowrap">{{ r.result_rows !== undefined ? r.result_rows + ' rows' : '-' }}</td>
          <td class="col-nowrap">
            <SourceLink :sourceFile="r.source_file" :lineNumber="r.line_number" @toast="$emit('toast', $event)" />
          </td>
          <td>
            <SqlCodeBox :code="r.full_sql || r.sql_template" @toast="$emit('toast', $event)" />
          </td>
        </tr>
      </tbody>
    </table>

    <Pagination
      :page="page"
      :pageSize="pageSize"
      :total="total"
      @update:page="loadData($event)"
      @update:pageSize="pageSize = $event; loadData(1)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import { SqlRecord } from '../types';
import ContextSummaryStrip from '../components/ContextSummaryStrip.vue';
import CostBadge from '../components/CostBadge.vue';
import Pagination from '../components/Pagination.vue';
import SqlCodeBox from '../components/SqlCodeBox.vue';
import SourceLink from '../components/SourceLink.vue';

const emit = defineEmits<{
  (e: 'update-stats', stats: any, label: string): void;
  (e: 'jump-tab', tab: string, traceId?: string): void;
  (e: 'toast', msg: string): void;
}>();

const list = ref<SqlRecord[]>([]);
const total = ref(0);
const statsTotalCost = ref(0);
const statsMaxCost = ref(0);
const page = ref(1);
const pageSize = ref(50);
const traceId = ref('');
const loading = ref(false);

async function loadData(p = 1) {
  if (!traceId.value) {
    list.value = [];
    total.value = 0;
    statsTotalCost.value = 0;
    statsMaxCost.value = 0;
    return;
  }
  page.value = p;
  loading.value = true;
  try {
    const res = await api.getTrace({
      page: page.value,
      pageSize: pageSize.value,
      traceId: traceId.value,
    });
    if (res.success) {
      list.value = res.data;
      total.value = res.total;
      statsTotalCost.value = res.totalCostMs || 0;
      statsMaxCost.value = res.maxCostMs || 0;
      emit('update-stats', res, `🔗 Trace 链路分析: ${traceId.value}`);
    }
  } finally {
    loading.value = false;
  }
}

function setTrace(tId: string) {
  traceId.value = tId;
  loadData(1);
}

defineExpose({
  setTrace,
  loadData,
});
</script>

<style scoped>
.tab-panel {
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  box-shadow: var(--shadow);
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 4px;
  align-items: center;
}
.input-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #f8fafc;
  border: 1px solid var(--border);
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 12px;
}
.input-group input {
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--text);
}
</style>
