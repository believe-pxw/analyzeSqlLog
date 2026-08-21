<template>
  <div class="tab-panel">
    <!-- 列表模式 -->
    <div v-if="!selectedTraceId" class="list-view">
      <div class="toolbar">
        <div class="input-group">
          <span>🔍</span>
          <input
            type="text"
            v-model="keyword"
            @input="loadList(1)"
            placeholder="过滤 Trace ID 或 Service 名称..."
            style="width: 260px;"
          />
        </div>
        <div class="input-group">
          <span>最小总耗时 >=</span>
          <input
            type="number"
            v-model.number="minCostMs"
            @input="loadList(1)"
            style="width: 70px;"
          />
          <span>ms</span>
        </div>
        <span class="toolbar-tip">💡 基于 ActionRecorder 全链路端到端剖析，一览请求业务耗时与 SQL 耗时占比</span>
      </div>

      <!-- 列表独立度量条 -->
      <ContextSummaryStrip
        title="⚡ 全链路性能剖析列表"
        :totalCount="total"
        :totalCostMs="statsTotalCost"
        :maxCostMs="statsMaxCost"
      />

      <table>
        <thead>
          <tr>
            <th class="col-nowrap" style="width: 40px;">#</th>
            <th class="col-nowrap" style="width: 170px;">Trace ID</th>
            <th>第一层核心 Service 业务动作</th>
            <th class="col-nowrap" style="width: 100px;">总耗时</th>
            <th class="col-nowrap" style="width: 90px;">根净自耗时</th>
            <th class="col-nowrap" style="width: 160px;">四维耗时分布占比</th>
            <th class="col-nowrap" style="width: 90px;">动作 / 深度</th>
            <th class="col-nowrap" style="width: 70px;">SQL 查询</th>
            <th class="col-time" style="width: 175px;">记录时间</th>
            <th class="col-nowrap" style="width: 130px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="10" class="empty-cell">正在加载性能链路列表...</td>
          </tr>
          <tr v-else-if="list.length === 0">
            <td colspan="10" class="empty-cell">未匹配到任何性能日志记录 (Performance.ActionRecorder)</td>
          </tr>
          <tr v-for="(r, idx) in list" :key="r.trace_id">
            <td class="col-nowrap">{{ (page - 1) * pageSize + idx + 1 }}</td>
            <td class="col-nowrap">
              <a href="javascript:void(0)" class="link-btn" @click="openDetail(r.trace_id)">{{ r.trace_id }}</a>
            </td>
            <td>
              <div class="service-name">{{ r.service_name }}</div>
              <div class="root-action">{{ r.root_action }}</div>
            </td>
            <td class="col-nowrap">
              <CostBadge :costMs="r.total_time_ms" />
            </td>
            <td class="col-nowrap" style="color: #64748b; font-family: monospace;">
              {{ r.self_time_ms }} ms
            </td>
            <td class="col-nowrap">
              <StackedBar
                :totalMs="r.total_time_ms"
                :bizMs="r.biz_time_ms"
                :sqlMs="r.sql_time_ms"
                :commitMs="r.commit_time_ms"
              />
            </td>
            <td class="col-nowrap">
              <span class="badge-tag">{{ r.action_count }} 节点 / 深 {{ r.max_depth }}</span>
            </td>
            <td class="col-nowrap">
              <span v-if="r.sql_count > 0" class="badge-sql">{{ r.sql_count }} 条</span>
              <span v-else style="color: #94a3b8;">-</span>
            </td>
            <td class="col-time">{{ r.log_time }}</td>
            <td class="col-nowrap">
              <button class="btn-action" @click="openDetail(r.trace_id)">⚡ 深度剖析</button>
            </td>
          </tr>
        </tbody>
      </table>

      <Pagination
        :page="page"
        :pageSize="pageSize"
        :total="total"
        @update:page="loadList($event)"
        @update:pageSize="pageSize = $event; loadList(1)"
      />
    </div>

    <!-- 深度剖析模式 -->
    <div v-else class="detail-view">
      <div class="detail-top-bar">
        <button class="btn-action" @click="closeDetail">⬅️ 返回请求列表</button>
        <div class="detail-title">⚡ 请求性能深度剖析: {{ selectedTraceId }}</div>
        <div class="action-btn-group">
          <button class="btn-action btn-primary" @click="$emit('jump-tab', 'app-logs', selectedTraceId)">📜 查看纯净日志</button>
          <button class="btn-action" @click="setAllExpand(false)">➕ 一键展开全部</button>
          <button class="btn-action" @click="setAllExpand(true)">➖ 一键收起全部</button>
          <button class="btn-action" @click="expandByThreshold(50)">⚡ 自耗时 > 50ms</button>
          <button class="btn-action" @click="expandByThreshold(10)">⚡ 自耗时 > 10ms</button>
        </div>
      </div>

      <!-- 四维正交概览卡片 -->
      <div v-if="treeData" class="perf-overview-grid">
        <div class="perf-card">
          <div class="perf-card-title">⚡ 请求端到端总耗时</div>
          <div class="perf-card-val red">{{ treeData.totalTimeMs.toLocaleString() }} ms</div>
          <div class="perf-card-sub">根动作自耗时: {{ treeData.selfTimeMs }} ms</div>
        </div>
        <div class="perf-card">
          <div class="perf-card-title">🟪 Java 业务纯耗时</div>
          <div class="perf-card-val purple">{{ treeData.bizTimeMs.toLocaleString() }} ms</div>
          <div class="perf-card-sub">占比: {{ getPct(treeData.bizTimeMs, treeData.totalTimeMs) }}%</div>
        </div>
        <div class="perf-card">
          <div class="perf-card-title">🟦 数据库 SQL 执行</div>
          <div class="perf-card-val blue">{{ treeData.sqlTimeMs.toLocaleString() }} ms</div>
          <div class="perf-card-sub">{{ treeData.sqlCount }} 次查询 | 占比 {{ getPct(treeData.sqlTimeMs, treeData.totalTimeMs) }}%</div>
        </div>
        <div class="perf-card">
          <div class="perf-card-title">🟩 事务提交阶段</div>
          <div class="perf-card-val green">{{ treeData.commitTimeMs.toLocaleString() }} ms</div>
          <div class="perf-card-sub">占比: {{ getPct(treeData.commitTimeMs, treeData.totalTimeMs) }}%</div>
        </div>
      </div>

      <!-- Top 5 自身耗时热点 -->
      <div v-if="treeData && treeData.hotspots && treeData.hotspots.length > 0" class="hotspots-panel">
        <div class="hotspots-title">🔥 耗时热点 Top 5 自身消耗方法</div>
        <div class="hotspots-grid">
          <div v-for="(h, idx) in treeData.hotspots" :key="idx" class="hotspot-item">
            <span class="hotspot-rank">#{{ idx + 1 }}</span>
            <span class="hotspot-name" :title="h.name">{{ h.name }}</span>
            <span class="hotspot-cost">{{ h.selfCostMs }} ms (总: {{ h.totalCostMs }}ms)</span>
          </div>
        </div>
      </div>

      <!-- 树形表头与搜索 -->
      <div class="toolbar" style="margin-top: 6px;">
        <div class="input-group">
          <span>⚡ 仅展开自耗时 >=</span>
          <input
            type="number"
            v-model.number="selfTimeFilter"
            @input="filterTreeBySelfTime"
            placeholder="自耗时阈值..."
            style="width: 80px;"
          />
          <span>ms 的节点</span>
        </div>
        <div class="input-group">
          <span>🔍 过滤动作/SQL:</span>
          <input
            type="text"
            v-model="actionFilter"
            @input="filterTreeByAction"
            placeholder="快速过滤动作名..."
            style="width: 200px;"
          />
        </div>
        <span class="toolbar-tip">💡 命中阈值的节点将自动展开并呈高亮背景</span>
      </div>

      <!-- 性能树表格 -->
      <table>
        <thead>
          <tr>
            <th>调用层级 & 动作名称 / SQL</th>
            <th class="col-nowrap" style="width: 95px;">总耗时</th>
            <th class="col-nowrap" style="width: 140px;">净自耗时 (占比)</th>
            <th class="col-nowrap" style="width: 85px;">间隙 (Gap)</th>
            <th class="col-nowrap" style="width: 140px;">日志源码定位</th>
          </tr>
        </thead>
        <tbody v-if="treeData && treeData.rootNode">
          <PerfTreeNode
            :node="treeData.rootNode"
            :rootTotalCost="treeData.totalTimeMs"
            @jump-applogs="$emit('jump-tab', 'app-logs', $event)"
          />
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';
import { PerfTraceRow, PerfTreeData, ActionNode } from '../types';
import ContextSummaryStrip from '../components/ContextSummaryStrip.vue';
import CostBadge from '../components/CostBadge.vue';
import StackedBar from '../components/StackedBar.vue';
import Pagination from '../components/Pagination.vue';
import PerfTreeNode from './PerfTreeNode.vue';

const emit = defineEmits<{
  (e: 'update-stats', stats: any, label: string): void;
  (e: 'jump-tab', tab: string, traceId?: string): void;
}>();

const list = ref<PerfTraceRow[]>([]);
const total = ref(0);
const statsTotalCost = ref(0);
const statsMaxCost = ref(0);
const page = ref(1);
const pageSize = ref(20);
const keyword = ref('');
const minCostMs = ref(0);
const loading = ref(false);

const selectedTraceId = ref('');
const treeData = ref<PerfTreeData | null>(null);
const selfTimeFilter = ref<number | null>(null);
const actionFilter = ref('');

async function loadList(p = 1) {
  page.value = p;
  loading.value = true;
  try {
    const res = await api.getPerfTraceList({
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value,
      minCostMs: minCostMs.value,
    });
    if (res.success) {
      list.value = res.data;
      total.value = res.total;
      statsTotalCost.value = res.totalCostMs || 0;
      statsMaxCost.value = res.maxCostMs || 0;
      emit('update-stats', res, '⚡ 当前统计: 全链路性能树');
    }
  } finally {
    loading.value = false;
  }
}

async function openDetail(traceId: string) {
  selectedTraceId.value = traceId;
  treeData.value = null;
  const res = await api.getPerfTree(traceId);
  if (res.success && res.data) {
    treeData.value = res.data;
    // 默认折叠深层节点 (Level >= 2)
    collapseDeepNodes(treeData.value.rootNode);
  }
}

function closeDetail() {
  selectedTraceId.value = '';
  treeData.value = null;
}

function collapseDeepNodes(node: ActionNode | null) {
  if (!node) return;
  node.collapsed = node.depth >= 2;
  if (node.children) {
    node.children.forEach(c => collapseDeepNodes(c));
  }
}

function setAllExpand(collapsed: boolean) {
  function traverse(n: ActionNode | null) {
    if (!n) return;
    n.collapsed = collapsed;
    if (n.children) n.children.forEach(traverse);
  }
  traverse(treeData.value?.rootNode || null);
}

function expandByThreshold(threshold: number) {
  selfTimeFilter.value = threshold;
  filterTreeBySelfTime();
}

function filterTreeBySelfTime() {
  const threshold = selfTimeFilter.value || 0;
  function traverse(n: ActionNode | null): boolean {
    if (!n) return false;
    let hit = threshold > 0 && n.selfCostMs >= threshold;
    let childHit = false;
    if (n.children) {
      for (const c of n.children) {
        if (traverse(c)) childHit = true;
      }
    }
    n.highlight = hit;
    if (hit || childHit) {
      n.collapsed = false;
      return true;
    } else {
      n.collapsed = n.depth >= 2;
      return false;
    }
  }
  traverse(treeData.value?.rootNode || null);
}

function filterTreeByAction() {
  const kw = actionFilter.value.trim().toLowerCase();
  function traverse(n: ActionNode | null): boolean {
    if (!n) return false;
    let hit = kw.length > 0 && n.name.toLowerCase().includes(kw);
    let childHit = false;
    if (n.children) {
      for (const c of n.children) {
        if (traverse(c)) childHit = true;
      }
    }
    n.highlight = hit;
    if (hit || childHit) {
      n.collapsed = false;
      return true;
    } else {
      n.collapsed = n.depth >= 2;
      return false;
    }
  }
  traverse(treeData.value?.rootNode || null);
}

function getPct(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 100);
}

onMounted(() => {
  loadList();
});

defineExpose({
  openDetail,
  loadList,
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
.input-group input, .input-group select {
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
.link-btn {
  color: #0284c7;
  font-weight: 600;
  text-decoration: none;
}
.service-name {
  font-weight: 600;
  color: #1e293b;
  word-break: break-all;
}
.root-action {
  font-size: 11px;
  color: var(--text-muted);
}
.badge-tag {
  display: inline-block;
  padding: 1px 6px;
  background: #f1f5f9;
  border: 1px solid #cbd5e1;
  border-radius: 3px;
  font-size: 11px;
}
.badge-sql {
  display: inline-block;
  padding: 1px 6px;
  background: #e0f2fe;
  color: #0284c7;
  border: 1px solid #bae6fd;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 600;
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
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.btn-action:hover {
  background: #e2e8f0;
  color: var(--accent);
}
.btn-primary {
  background: #0284c7;
  color: #ffffff;
  border-color: #0369a1;
}
.btn-primary:hover {
  background: #0369a1;
  color: #ffffff;
}
.detail-top-bar {
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.detail-title {
  font-size: 13px;
  font-weight: 700;
  color: #0284c7;
}
.action-btn-group {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
}
.perf-overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}
.perf-card {
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 12px;
  box-shadow: var(--shadow);
}
.perf-card-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.perf-card-val {
  font-size: 18px;
  font-weight: 700;
}
.perf-card-val.red { color: #dc2626; }
.perf-card-val.purple { color: #7c3aed; }
.perf-card-val.blue { color: #0284c7; }
.perf-card-val.green { color: #16a34a; }
.perf-card-sub {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}
.hotspots-panel {
  background: #fffbeb;
  border: 1px solid #fef3c7;
  border-radius: 6px;
  padding: 6px 10px;
  margin-bottom: 8px;
}
.hotspots-title {
  font-size: 11.5px;
  font-weight: 700;
  color: #b45309;
  margin-bottom: 4px;
}
.hotspots-grid {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.hotspot-item {
  background: #ffffff;
  border: 1px solid #fde68a;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.hotspot-rank {
  font-weight: 700;
  color: #d97706;
}
.hotspot-name {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hotspot-cost {
  font-weight: 600;
  color: #dc2626;
}
.col-nowrap { white-space: nowrap; }
.col-time { white-space: nowrap; font-size: 12px; font-family: monospace; }
</style>
