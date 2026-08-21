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
        <span>单事务内重复执行 >=</span>
        <input
          type="number"
          v-model.number="minRepeat"
          @input="loadData(1)"
          style="width: 55px;"
        />
        <span>次</span>
      </div>
      <div class="input-group">
        <span>🔍</span>
        <input
          type="text"
          v-model="keyword"
          @input="loadData(1)"
          placeholder="全局搜索 SQL 模板关键字..."
          style="width: 200px;"
        />
      </div>
      <span class="toolbar-tip">💡 自动检测同一事务 (dbManager) 内高频重复执行的 SQL 语句 (N+1 隐患)</span>
    </div>

    <!-- 专属上下文度量条 -->
    <ContextSummaryStrip
      title="🔁 事务内重复 SQL (N+1 隐患诊断)"
      :subtitle="traceId ? `Trace: ${traceId}` : undefined"
      :totalCostMs="statsTotalCost"
      :totalCount="statsTotalSqls"
      :totalTraces="statsTotalTraces"
      :maxCostMs="statsMaxCost"
    />

    <table>
      <thead>
        <tr>
          <th class="col-nowrap" style="width: 40px;">#</th>
          <th class="col-nowrap">Trace ID</th>
          <th class="col-nowrap">dbManager 事务连接</th>
          <th class="col-nowrap">循环执行次数</th>
          <th class="col-nowrap">累计耗时</th>
          <th class="col-nowrap">调优建议</th>
          <th>SQL 模板语句 (点击展开/收起)</th>
          <th class="col-nowrap">源码定位</th>
          <th class="col-nowrap" style="width: 90px;">操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="9" class="empty-cell">正在诊断事务内重复 SQL...</td>
        </tr>
        <tr v-else-if="list.length === 0">
          <td colspan="9" class="empty-cell">未检测到任何超过阈值的事务内循环 SQL</td>
        </tr>
        <tr v-for="(r, idx) in list" :key="idx">
          <td class="col-nowrap">{{ (page - 1) * pageSize + idx + 1 }}</td>
          <td class="col-nowrap col-mono">
            <a href="javascript:void(0)" class="link-btn" @click="$emit('jump-tab', 'trace', r.trace_id)">{{ r.trace_id }}</a>
          </td>
          <td class="col-nowrap col-mono">
            <span class="dbmanager-tag" :title="r.db_manager">{{ formatDbManager(r.db_manager) }}</span>
          </td>
          <td class="col-nowrap">
            <span class="repeat-badge">{{ r.repeat_count }} 次循环</span>
          </td>
          <td class="col-nowrap"><CostBadge :costMs="r.total_time_ms" /></td>
          <td class="col-nowrap">
            <span :class="['advice-tag', r.repeat_count >= 20 ? 'advice-severe' : 'advice-warn']">{{ r.advice }}</span>
          </td>
          <td>
            <SqlCodeBox :code="r.sql_template" @toast="$emit('toast', $event)" />
          </td>
          <td class="col-nowrap">
            <SourceLink :sourceFile="r.example_source_file" :lineNumber="r.example_line_number" @toast="$emit('toast', $event)" />
          </td>
          <td class="col-nowrap">
            <button class="btn-action" @click="$emit('jump-detail', r.sql_template, { traceId: r.trace_id, dbManager: r.db_manager })">📋 查看调用</button>
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
import { DiagnosticsItem } from '../types';
import { formatDbManager } from '../utils/vscode';
import ContextSummaryStrip from '../components/ContextSummaryStrip.vue';
import CostBadge from '../components/CostBadge.vue';
import Pagination from '../components/Pagination.vue';
import SqlCodeBox from '../components/SqlCodeBox.vue';
import SourceLink from '../components/SourceLink.vue';

const emit = defineEmits<{
  (e: 'update-stats', stats: any, label: string): void;
  (e: 'jump-tab', tab: string, traceId?: string): void;
  (e: 'jump-detail', template: string, filter?: { traceId?: string; dbManager?: string }): void;
  (e: 'toast', msg: string): void;
}>();

const list = ref<DiagnosticsItem[]>([]);
const total = ref(0);
const statsTotalCost = ref(0);
const statsTotalSqls = ref(0);
const statsTotalTraces = ref(0);
const statsMaxCost = ref(0);
const page = ref(1);
const pageSize = ref(20);
const traceId = ref('');
const minRepeat = ref(5);
const keyword = ref('');
const loading = ref(false);

async function loadData(p = 1) {
  page.value = p;
  loading.value = true;
  try {
    const res = await api.getDiagnostics({
      page: page.value,
      pageSize: pageSize.value,
      traceId: traceId.value,
      minRepeatCount: minRepeat.value,
      keyword: keyword.value,
    });
    if (res.success) {
      list.value = res.data;
      total.value = res.total;
      statsTotalCost.value = res.totalCostMs || 0;
      statsTotalSqls.value = res.totalSqls || 0;
      statsTotalTraces.value = res.totalTraces || 0;
      statsMaxCost.value = res.maxCostMs || 0;
      emit('update-stats', res, '🔁 事务内重复 SQL (N+1) 诊断');
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
.repeat-badge {
  background: #fee2e2;
  color: #dc2626;
  border: 1px solid #fecaca;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 700;
  font-family: var(--font-mono);
  font-size: 11.5px;
}
.advice-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
}
.advice-severe { background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; }
.advice-warn { background: #fef3c7; color: #d97706; border: 1px solid #fde68a; }
.dbmanager-tag {
  background: #f1f5f9;
  color: #334155;
  border: 1px solid #cbd5e1;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
  font-family: var(--font-mono);
  cursor: default;
}
</style>
