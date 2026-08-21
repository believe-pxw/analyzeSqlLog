<template>
  <div class="tab-panel">
    <div class="detail-header">
      <div class="detail-title">
        <span>🔍 SQL 模板调用明细</span>
        <button class="btn-action" @click="copyTemplate">📋 复制模板</button>
      </div>
      <div class="detail-tags">
        <span v-if="filterTraceId" class="tag">Trace: {{ filterTraceId }}</span>
        <span v-if="filterDbManager" class="tag">dbManager: {{ filterDbManager }}</span>
        <span class="tag">总调用: {{ total }} 次</span>
      </div>
      <div class="sql-preview-box">{{ template }}</div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="col-nowrap" style="width: 40px;">#</th>
          <th class="col-time">执行时刻</th>
          <th class="col-nowrap">Trace ID</th>
          <th class="col-nowrap">耗时</th>
          <th class="col-nowrap">影响行数</th>
          <th class="col-nowrap">源码定位</th>
          <th>完整实例化 SQL (点击展开/复制)</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="7" class="empty-cell">正在查询模板调用明细...</td>
        </tr>
        <tr v-else-if="list.length === 0">
          <td colspan="7" class="empty-cell">未匹配到该 SQL 模板的具体调用记录</td>
        </tr>
        <tr v-for="(r, idx) in list" :key="r.id || idx">
          <td class="col-nowrap">{{ (page - 1) * pageSize + idx + 1 }}</td>
          <td class="col-time">{{ r.log_time }}</td>
          <td class="col-nowrap font-mono">
            <a href="javascript:void(0)" @click="$emit('jump-tab', 'trace', r.trace_id)" style="color: #0284c7; text-decoration: none; font-weight: 600;">{{ r.trace_id }}</a>
          </td>
          <td class="col-nowrap"><CostBadge :costMs="r.exec_time_ms" /></td>
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
import { ref } from 'vue';
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
const pageSize = ref(50);
const template = ref('');
const filterTraceId = ref('');
const filterDbManager = ref('');
const loading = ref(false);

async function loadData(p = 1) {
  if (!template.value) return;
  page.value = p;
  loading.value = true;
  try {
    const res = await api.getByTemplate({
      page: page.value,
      pageSize: pageSize.value,
      sqlTemplate: template.value,
      traceId: filterTraceId.value,
      dbManager: filterDbManager.value,
    });
    if (res.success) {
      list.value = res.data;
      total.value = res.total;
      emit('update-stats', res, '📋 SQL 模板调用明细');
    }
  } finally {
    loading.value = false;
  }
}

function setTemplate(tpl: string, filters: { traceId?: string; dbManager?: string } = {}) {
  template.value = tpl;
  filterTraceId.value = filters.traceId || '';
  filterDbManager.value = filters.dbManager || '';
  loadData(1);
}

function copyTemplate() {
  navigator.clipboard.writeText(template.value);
  emit('toast', '已复制 SQL 模板至剪贴板');
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

defineExpose({
  setTemplate,
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
.detail-header {
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 8px;
}
.detail-title {
  font-size: 13px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 4px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.detail-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
  font-size: 11.5px;
}
.tag {
  background: #e0f2fe;
  color: #0369a1;
  padding: 1px 6px;
  border-radius: 3px;
  border: 1px solid #bae6fd;
}
.sql-preview-box {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
  color: #1e293b;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 4px 8px;
  max-height: 90px;
  overflow-y: auto;
  word-break: break-all;
  white-space: pre-wrap;
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
  padding: 2px 7px;
  border: 1px solid var(--border);
  background: #ffffff;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
}
.btn-action:hover {
  background: #e2e8f0;
  color: var(--accent);
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
