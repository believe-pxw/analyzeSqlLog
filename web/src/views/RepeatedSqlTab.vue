<template>
  <div class="tab-panel">
    <div class="toolbar">
      <div class="input-group">
        <span>🔍</span>
        <input
          type="text"
          v-model="keyword"
          @input="loadData(1)"
          placeholder="全局搜索 SQL 模板关键字..."
          style="width: 260px;"
        />
      </div>
      <span class="toolbar-tip">💡 参数化 SQL 模板聚合统计，识别调用最频繁、累计耗时最高的 SQL</span>
    </div>

    <!-- 专属上下文度量条 -->
    <ContextSummaryStrip
      title="📊 SQL 模板执行频次榜"
      :totalCostMs="statsTotalCost"
      :totalCount="statsTotalSqls"
      :totalTraces="statsTotalTraces"
      :maxCostMs="statsMaxCost"
    />

    <table>
      <thead>
        <tr>
          <th class="col-nowrap" style="width: 40px;">#</th>
          <th class="col-nowrap">执行频次</th>
          <th class="col-nowrap">总耗时</th>
          <th class="col-nowrap">平均耗时</th>
          <th class="col-nowrap">最高耗时</th>
          <th class="col-nowrap">涉及 Trace 数</th>
          <th>SQL 模板语句 (点击展开/收起)</th>
          <th class="col-nowrap" style="width: 90px;">调用明细</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="8" class="empty-cell">正在聚合 SQL 频次数据...</td>
        </tr>
        <tr v-else-if="list.length === 0">
          <td colspan="8" class="empty-cell">未匹配到任何 SQL 模板记录</td>
        </tr>
        <tr v-for="(r, idx) in list" :key="idx">
          <td class="col-nowrap">{{ (page - 1) * pageSize + idx + 1 }}</td>
          <td class="col-nowrap">
            <span class="freq-badge">{{ r.repeat_count.toLocaleString() }} 次</span>
          </td>
          <td class="col-nowrap"><CostBadge :costMs="r.total_time_ms" /></td>
          <td class="col-nowrap col-mono" style="color: #64748b;">{{ r.avg_time_ms }} ms</td>
          <td class="col-nowrap"><CostBadge :costMs="r.max_time_ms" /></td>
          <td class="col-nowrap col-mono">{{ r.trace_count }} 个</td>
          <td>
            <SqlCodeBox :code="r.sql_template" @toast="$emit('toast', $event)" />
          </td>
          <td class="col-nowrap">
            <button class="btn-action" @click="$emit('jump-detail', r.sql_template, { source: 'repeated', count: r.repeat_count })">📋 查看调用</button>
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
import { SqlSummary } from '../types';
import ContextSummaryStrip from '../components/ContextSummaryStrip.vue';
import CostBadge from '../components/CostBadge.vue';
import Pagination from '../components/Pagination.vue';
import SqlCodeBox from '../components/SqlCodeBox.vue';

const emit = defineEmits<{
  (e: 'update-stats', stats: any, label: string): void;
  (e: 'jump-detail', template: string, meta?: any): void;
  (e: 'toast', msg: string): void;
}>();

const list = ref<SqlSummary[]>([]);
const total = ref(0);
const statsTotalCost = ref(0);
const statsTotalSqls = ref(0);
const statsTotalTraces = ref(0);
const statsMaxCost = ref(0);
const page = ref(1);
const pageSize = ref(20);
const keyword = ref('');
const loading = ref(false);

async function loadData(p = 1) {
  page.value = p;
  loading.value = true;
  try {
    const res = await api.getTopRepeated({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value,
    });
    if (res.success) {
      list.value = res.data;
      total.value = res.total;
      statsTotalCost.value = res.totalCostMs || 0;
      statsTotalSqls.value = res.totalSqls || 0;
      statsTotalTraces.value = res.totalTraces || 0;
      statsMaxCost.value = res.maxCostMs || 0;
      emit('update-stats', res, '📊 SQL 频次榜');
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
.freq-badge {
  background: #f1f5f9;
  color: #0f172a;
  border: 1px solid #cbd5e1;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 700;
  font-family: var(--font-mono);
  font-size: 11.5px;
}
</style>
