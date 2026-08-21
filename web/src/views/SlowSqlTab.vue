<template>
  <div class="tab-panel">
    <div class="toolbar">
      <div class="input-group">
        <span>🔍</span>
        <input
          type="text"
          v-model="traceId"
          @input="loadData(1)"
          placeholder="过滤特定 Trace ID..."
          style="width: 180px;"
        />
      </div>
      <div class="input-group">
        <span>最小耗时 >=</span>
        <input
          type="number"
          v-model.number="minCost"
          @input="loadData(1)"
          style="width: 60px;"
        />
        <span>ms</span>
      </div>
      <div class="input-group">
        <span>🔍</span>
        <input
          type="text"
          v-model="keyword"
          @input="loadData(1)"
          placeholder="全局搜索 SQL 关键字..."
          style="width: 200px;"
        />
      </div>
      <span class="toolbar-tip">💡 全库 SQL 单次执行耗时严格降序排行</span>
    </div>

    <table>
      <thead>
        <tr>
          <th class="col-nowrap" style="width: 40px;">#</th>
          <th class="col-nowrap">执行耗时</th>
          <th class="col-nowrap">Trace ID</th>
          <th class="col-time">记录时间</th>
          <th class="col-nowrap">影响行数</th>
          <th class="col-nowrap">源码定位</th>
          <th>完整实例化 SQL 语句 (点击展开/复制)</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="7" class="empty-cell">正在查询慢 SQL 排行...</td>
        </tr>
        <tr v-else-if="list.length === 0">
          <td colspan="7" class="empty-cell">未匹配到任何符合耗时阈值的慢 SQL 记录</td>
        </tr>
        <tr v-for="(r, idx) in list" :key="r.id || idx">
          <td class="col-nowrap">{{ (page - 1) * pageSize + idx + 1 }}</td>
          <td class="col-nowrap"><CostBadge :costMs="r.exec_time_ms" /></td>
          <td class="col-nowrap font-mono" style="color: #0284c7;">
            <a href="javascript:void(0)" @click="$emit('jump-tab', 'trace', r.trace_id)" style="color: #0284c7; text-decoration: none; font-weight: 600;">{{ r.trace_id }}</a>
          </td>
          <td class="col-time">{{ r.log_time }}</td>
          <td class="col-nowrap">{{ r.result_rows !== undefined ? r.result_rows + ' rows' : '-' }}</td>
          <td class="col-nowrap" style="font-size: 11px; color: var(--text-muted);">
            {{ formatSource(r.source_file, r.line_number) }}
          </td>
          <td>
            <div class="sql-code" @click="copySql(r.full_sql || r.sql_template)">{{ r.full_sql || r.sql_template }}</div>
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
import { SqlRecord } from '../types';
import CostBadge from '../components/CostBadge.vue';
import Pagination from '../components/Pagination.vue';

const emit = defineEmits<{
  (e: 'update-stats', stats: any, label: string): void;
  (e: 'jump-tab', tab: string, traceId?: string): void;
  (e: 'toast', msg: string): void;
}>();

const list = ref<SqlRecord[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const traceId = ref('');
const minCost = ref(0);
const keyword = ref('');
const loading = ref(false);

async function loadData(p = 1) {
  page.value = p;
  loading.value = true;
  try {
    const res = await api.getTopSlow({
      page: page.value,
      pageSize: pageSize.value,
      traceId: traceId.value,
      minCostMs: minCost.value,
      keyword: keyword.value,
    });
    if (res.success) {
      list.value = res.data;
      total.value = res.total;
      emit('update-stats', res, '🐢 慢 SQL 排行');
    }
  } finally {
    loading.value = false;
  }
}

function copySql(sql: string) {
  navigator.clipboard.writeText(sql);
  emit('toast', '已复制完整 SQL 至剪贴板');
}

function formatSource(file: string, line: number) {
  if (!file) return '';
  const base = file.split(/[\\/]/).pop();
  return `${base}:${line}`;
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
.sql-code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
  color: #1e293b;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 3px 6px;
  max-height: 80px;
  overflow-y: auto;
  word-break: break-all;
  white-space: pre-wrap;
  cursor: pointer;
}
.sql-code:hover {
  border-color: #cbd5e1;
  background: #f1f5f9;
}
.col-nowrap { white-space: nowrap; }
.col-time { white-space: nowrap; font-size: 12px; font-family: monospace; }
.font-mono { font-family: monospace; }
</style>
