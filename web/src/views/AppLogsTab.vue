<template>
  <div class="tab-panel">
    <div class="toolbar">
      <div class="input-group">
        <span style="font-weight: 700; color: #0284c7;">Trace ID:</span>
        <input
          type="text"
          v-model="traceId"
          @input="loadLogs(1)"
          placeholder="输入 Trace ID 提取纯净日志流..."
          style="width: 240px;"
        />
      </div>
      <div class="input-group">
        <span>Span 跨度:</span>
        <select v-model="spanId" @change="loadLogs(1)">
          <option value="">全部 Span</option>
          <option v-for="s in spans" :key="s.span_id" :value="s.span_id">
            {{ s.span_id }} ({{ s.log_count }} 条)
          </option>
        </select>
      </div>
      <div class="input-group">
        <span>日志类型/级别:</span>
        <select v-model="level" @change="loadLogs(1)">
          <option value="">全部类型 (ALL)</option>
          <option value="SQL">🟢 仅 SQL 语句</option>
          <option value="ERROR">🔴 仅 ERROR (错误与异常)</option>
          <option value="WARN">🟠 仅 WARN (警告)</option>
          <option value="INFO">🔵 仅 INFO (信息)</option>
          <option value="DEBUG">⚪ 仅 DEBUG (调试)</option>
        </select>
      </div>
      <div class="input-group">
        <span>🔍 搜索正文:</span>
        <input
          type="text"
          v-model="keyword"
          @input="loadLogs(1)"
          placeholder="过滤正文/SQL/类名..."
          style="width: 160px;"
        />
      </div>
      <div class="toolbar-right">
        <button
          v-if="hasPerfTree && traceId"
          class="btn-action btn-perf"
          @click="$emit('jump-tab', 'perf-tree', traceId)"
          title="穿透至该 Trace 的全链路性能树"
        >
          ⚡ 穿透至性能树
        </button>
        <button class="btn-action" @click="expandAllStacks(true)">➕ 展开堆栈</button>
        <button class="btn-action" @click="expandAllStacks(false)">➖ 折叠堆栈</button>
        <button class="btn-action" @click="copyLogs">📋 复制日志</button>
      </div>
    </div>

    <!-- Span 概览导航条 -->
    <div v-if="spans.length > 0" class="span-strip">
      <span style="font-weight: 600; color: #475569; margin-right: 6px;">🌐 链路 Span 树:</span>
      <span
        :class="['span-pill', { active: spanId === '' }]"
        @click="spanId = ''; loadLogs(1)"
      >
        全部 ({{ total }})
      </span>
      <span
        v-for="s in spans"
        :key="s.span_id"
        :class="['span-pill', { active: spanId === s.span_id }]"
        @click="spanId = s.span_id; loadLogs(1)"
      >
        {{ s.span_id }} <span class="span-count">{{ s.log_count }}</span>
      </span>
    </div>

    <table>
      <thead>
        <tr>
          <th class="col-nowrap" style="width: 35px;">#</th>
          <th class="col-time" style="width: 175px;">日志时刻 (NanoTime)</th>
          <th class="col-nowrap" style="width: 65px;">类型</th>
          <th class="col-nowrap" style="width: 140px;">Span ID (跨度)</th>
          <th class="col-nowrap" style="width: 110px;">节点 & 线程</th>
          <th style="width: 200px;">类名 / dbManager</th>
          <th>日志消息正文 & SQL 语句 & 异常堆栈</th>
          <th class="col-nowrap" style="width: 110px;">源码定位</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="8" class="empty-cell">正在提取纯净日志与 SQL 执行流...</td>
        </tr>
        <tr v-else-if="logs.length === 0">
          <td colspan="8" class="empty-cell">未检索到任何符合条件的日志或 SQL 记录</td>
        </tr>
        <tr v-for="(log, idx) in logs" :key="log.id || idx" :class="{ 'row-sql': log.is_sql }">
          <td class="col-nowrap">{{ (page - 1) * pageSize + idx + 1 }}</td>
          <td class="col-time">
            <div>{{ log.log_time }}</div>
            <div v-if="log.nano_time" class="nano-time">#{{ log.nano_time }}</div>
          </td>
          <td class="col-nowrap">
            <span :class="['level-badge', getLevelClass(log.level)]">{{ log.level }}</span>
          </td>
          <td class="col-nowrap">
            <span v-if="log.span_id && log.span_id !== '-'" class="span-tag" @click="spanId = log.span_id; loadLogs(1)">{{ log.span_id }}</span>
            <span v-else style="color: #94a3b8;">-</span>
          </td>
          <td class="col-nowrap">
            <div style="font-weight: 600; font-size: 11px;">{{ log.service_name }}</div>
            <div style="font-size: 10.5px; color: var(--text-muted);">{{ log.thread_name }}</div>
          </td>
          <td style="font-family: monospace; font-size: 11px; word-break: break-all;">
            {{ log.logger_name }}
          </td>
          <td>
            <!-- SQL 语句渲染 -->
            <div v-if="log.is_sql || log.level === 'SQL'" class="sql-log-item">
              <div class="sql-meta-header">
                <CostBadge :costMs="log.exec_time_ms || 0" />
                <span v-if="log.result_rows !== undefined" class="rows-tag">影响 {{ log.result_rows }} 行</span>
              </div>
              <SqlCodeBox :code="log.message" @toast="$emit('toast', $event)" />
            </div>

            <!-- 普通日志正文 & 异常堆栈渲染 -->
            <div v-else class="log-msg-text">
              <div>{{ log.message }}</div>
              <div v-if="log.has_stack && log.stack_trace" class="stack-box">
                <div class="stack-toggle" @click="toggleStack(idx)">
                  {{ expandedStacks[idx] ? '▼ 折叠堆栈' : '▶ 展开堆栈 (' + countStackLines(log.stack_trace) + ' 行)' }}
                </div>
                <pre v-if="expandedStacks[idx]" class="stack-trace">{{ log.stack_trace }}</pre>
              </div>
            </div>
          </td>
          <td class="col-nowrap">
            <SourceLink :sourceFile="log.source_file" :lineNumber="log.line_number" @toast="$emit('toast', $event)" />
          </td>
        </tr>
      </tbody>
    </table>

    <Pagination
      :page="page"
      :pageSize="pageSize"
      :total="total"
      @update:page="loadLogs($event)"
      @update:pageSize="pageSize = $event; loadLogs(1)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';
import Pagination from '../components/Pagination.vue';
import SourceLink from '../components/SourceLink.vue';
import CostBadge from '../components/CostBadge.vue';
import SqlCodeBox from '../components/SqlCodeBox.vue';

const emit = defineEmits<{
  (e: 'update-stats', stats: any, label: string): void;
  (e: 'jump-tab', tab: string, traceId?: string): void;
  (e: 'toast', msg: string): void;
}>();

const logs = ref<any[]>([]);
const spans = ref<{ span_id: string; parent_span_id: string; log_count: number }[]>([]);
const hasPerfTree = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const traceId = ref('');
const spanId = ref('');
const level = ref('');
const keyword = ref('');
const loading = ref(false);
const expandedStacks = ref<{ [key: number]: boolean }>({});

async function loadLogs(p = 1) {
  page.value = p;
  loading.value = true;
  try {
    const res = await api.getAppLogs({
      page: page.value,
      pageSize: pageSize.value,
      traceId: traceId.value,
      spanId: spanId.value,
      level: level.value,
      keyword: keyword.value,
    });
    if (res.success) {
      logs.value = res.data;
      total.value = res.total;
      spans.value = res.spans || [];
      hasPerfTree.value = Boolean(res.hasPerfTree);
      emit('update-stats', { total: res.total }, `📜 纯净日志透视 (${traceId.value || '全量'})`);
    }
  } finally {
    loading.value = false;
  }
}

function getLevelClass(lvl: string) {
  const l = (lvl || '').toUpperCase();
  if (l === 'SQL') return 'level-sql';
  if (l === 'ERROR') return 'level-error';
  if (l === 'WARN') return 'level-warn';
  if (l === 'INFO') return 'level-info';
  return 'level-debug';
}

function countStackLines(stack: string) {
  if (!stack) return 0;
  return stack.split('\n').length;
}

function toggleStack(idx: number) {
  expandedStacks.value[idx] = !expandedStacks.value[idx];
}

function expandAllStacks(expand: boolean) {
  const next: { [key: number]: boolean } = {};
  logs.value.forEach((log, idx) => {
    if (log.has_stack) next[idx] = expand;
  });
  expandedStacks.value = next;
}

function setTrace(tId: string, sId?: string) {
  traceId.value = tId;
  spanId.value = sId || '';
  loadLogs(1);
}

function copyLogs() {
  const text = logs.value
    .map(l => `${l.log_time} [${l.level}] [${l.trace_id}] [${l.span_id}] ${l.logger_name} - ${l.message}`)
    .join('\n');
  navigator.clipboard.writeText(text);
  emit('toast', '已复制当前筛选日志至剪贴板');
}

onMounted(() => {
  loadLogs();
});

defineExpose({
  setTrace,
  loadLogs,
});
</script>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.input-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.input-group input,
.input-group select {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: #ffffff;
}
.toolbar-right {
  margin-left: auto;
  display: flex;
  gap: 6px;
}
.btn-action {
  height: 28px;
  padding: 0 10px;
  font-size: 11.5px;
  font-weight: 500;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.btn-action:hover {
  background: #f1f5f9;
  border-color: #94a3b8;
}
.btn-perf {
  background: #f0fdf4;
  border-color: #86efac;
  color: #166534;
  font-weight: 600;
}
.btn-perf:hover {
  background: #dcfce7;
  border-color: #4ade80;
}

.span-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #f8fafc;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  margin-bottom: 12px;
}
.span-pill {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 12px;
  background: #ffffff;
  border: 1px solid #cbd5e1;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s ease;
}
.span-pill:hover {
  border-color: #0284c7;
  color: #0284c7;
}
.span-pill.active {
  background: #0284c7;
  color: #ffffff;
  border-color: #0284c7;
}
.span-count {
  font-weight: 700;
  opacity: 0.85;
}

.nano-time {
  font-size: 10px;
  color: #94a3b8;
  font-family: monospace;
}

.level-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10.5px;
  font-weight: 700;
  text-transform: uppercase;
}
.level-sql {
  background: #ecfdf5;
  color: #059669;
  border: 1px solid #a7f3d0;
}
.level-error {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}
.level-warn {
  background: #fffbeb;
  color: #d97706;
  border: 1px solid #fde68a;
}
.level-info {
  background: #f0f9ff;
  color: #0284c7;
  border: 1px solid #bae6fd;
}
.level-debug {
  background: #f8fafc;
  color: #64748b;
  border: 1px solid #e2e8f0;
}

.span-tag {
  font-family: monospace;
  font-size: 11px;
  color: #0284c7;
  cursor: pointer;
  text-decoration: underline;
}
.span-tag:hover {
  color: #0369a1;
}

.sql-log-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.sql-meta-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rows-tag {
  font-size: 10.5px;
  color: #64748b;
  background: #f1f5f9;
  padding: 1px 5px;
  border-radius: 3px;
}

.row-sql {
  background: #fcfdfd;
}

.log-msg-text {
  font-size: 11.5px;
  line-height: 1.45;
  word-break: break-all;
  white-space: pre-wrap;
}

.stack-box {
  margin-top: 4px;
}
.stack-toggle {
  font-size: 11px;
  color: #dc2626;
  font-weight: 600;
  cursor: pointer;
}
.stack-toggle:hover {
  text-decoration: underline;
}
.stack-trace {
  margin-top: 4px;
  padding: 6px 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 4px;
  color: #991b1b;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 260px;
  overflow-y: auto;
}
</style>
