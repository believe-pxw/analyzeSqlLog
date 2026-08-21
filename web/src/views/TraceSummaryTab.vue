<template>
  <div class="tab-panel">
    <div class="toolbar">
      <div class="input-group">
        <span>🔍</span>
        <input
          type="text"
          v-model="keyword"
          @input="loadData(1)"
          placeholder="检索 TraceID..."
          style="width: 220px;"
        />
      </div>
      <div class="input-group">
        <span>最小总耗时 >=</span>
        <input
          type="number"
          v-model.number="minCostMs"
          @input="loadData(1)"
          style="width: 70px;"
        />
        <span>ms</span>
      </div>
      <span class="toolbar-tip">💡 按全局 Trace ID 聚合汇总，累计耗时由高到低排序，一键穿透链路</span>
    </div>

    <table>
      <thead>
        <tr>
          <th class="col-nowrap" style="width: 40px;">#</th>
          <th class="col-nowrap">Trace ID</th>
          <th class="col-nowrap">SQL 执行次数</th>
          <th class="col-nowrap">累计总耗时</th>
          <th class="col-nowrap">平均耗时</th>
          <th class="col-nowrap">最高耗时</th>
          <th class="col-nowrap">事务连接数</th>
          <th class="col-time">首条执行时间</th>
          <th class="col-nowrap">快速分析操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="9" class="empty-cell">正在聚合 Trace 大盘数据...</td>
        </tr>
        <tr v-else-if="list.length === 0">
          <td colspan="9" class="empty-cell">未匹配到任何 Trace 聚合数据</td>
        </tr>
        <tr v-for="(r, idx) in list" :key="r.trace_id">
          <td class="col-nowrap">{{ (page - 1) * pageSize + idx + 1 }}</td>
          <td class="col-nowrap font-mono font-bold" style="color: #0284c7;">{{ r.trace_id }}</td>
          <td class="col-nowrap"><strong>{{ r.sql_count }}</strong> 次</td>
          <td class="col-nowrap"><CostBadge :costMs="r.total_time_ms" /></td>
          <td class="col-nowrap" style="color: #64748b; font-family: monospace;">{{ r.avg_time_ms }} ms</td>
          <td class="col-nowrap"><CostBadge :costMs="r.max_time_ms" /></td>
          <td class="col-nowrap">{{ r.db_manager_count }} 个</td>
          <td class="col-time">{{ r.first_time }}</td>
          <td class="col-nowrap">
            <div style="display: flex; gap: 4px;">
              <button class="btn-action" @click="$emit('jump-tab', 'trace', r.trace_id)">🔗 Trace链路</button>
              <button class="btn-action" @click="$emit('jump-tab', 'app-logs', r.trace_id)">📜 纯净日志</button>
              <button class="btn-action" @click="$emit('jump-tab', 'perf-tree', r.trace_id)">⚡ 性能树</button>
            </div>
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
import { ref, onMounted } from 'vue';
import { api } from '../api';
import { TraceSummaryItem } from '../types';
import CostBadge from '../components/CostBadge.vue';
import Pagination from '../components/Pagination.vue';

const emit = defineEmits<{
  (e: 'update-stats', stats: any, label: string): void;
  (e: 'jump-tab', tab: string, traceId?: string): void;
}>();

const list = ref<TraceSummaryItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const keyword = ref('');
const minCostMs = ref(0);
const loading = ref(false);

async function loadData(p = 1) {
  page.value = p;
  loading.value = true;
  try {
    const res = await api.getTraceSummaryList({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value,
      minCostMs: minCostMs.value,
    });
    if (res.success) {
      list.value = res.data;
      total.value = res.total;
      emit('update-stats', res, '🌐 Trace 聚合大盘');
    }
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadData();
});

defineExpose({
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
.toolbar-tip {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-left: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  margin-bottom: 6px;
}
th, td {
  padding: 5px 8px;
  border-bottom: 1px solid #e2e8f0;
  text-align: left;
  vertical-align: middle;
}
th {
  background: #f8fafc;
  font-weight: 600;
  color: #475569;
  font-size: 12px;
  position: sticky;
  top: 0;
  z-index: 10;
}
tr:hover td { background: #f1f5f9; }
.empty-cell {
  text-align: center;
  color: var(--text-muted);
  padding: 20px;
}
.btn-action {
  padding: 2px 6px;
  border: 1px solid var(--border);
  background: #ffffff;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.btn-action:hover {
  background: #e2e8f0;
  color: var(--accent);
}
.col-nowrap { white-space: nowrap; }
.col-time { white-space: nowrap; font-size: 12px; font-family: monospace; }
.font-mono { font-family: monospace; }
.font-bold { font-weight: 700; }
</style>
