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
        <span>日志级别:</span>
        <select v-model="level" @change="loadLogs(1)">
          <option value="">全部级别 (ALL)</option>
          <option value="ERROR">仅 ERROR (错误与异常)</option>
          <option value="WARN">仅 WARN (警告)</option>
          <option value="INFO">仅 INFO (信息)</option>
          <option value="DEBUG">仅 DEBUG (调试)</option>
        </select>
      </div>
      <div class="input-group">
        <span>🔍 搜索正文:</span>
        <input
          type="text"
          v-model="keyword"
          @input="loadLogs(1)"
          placeholder="过滤正文/类名..."
          style="width: 160px;"
        />
      </div>
      <div class="toolbar-right">
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
          <th class="col-nowrap" style="width: 65px;">级别</th>
          <th class="col-nowrap" style="width: 140px;">Span ID (跨度)</th>
          <th class="col-nowrap" style="width: 110px;">节点 & 线程</th>
          <th style="width: 220px;">类全限定名 (LoggerName)</th>
          <th>日志消息正文 & 异常堆栈</th>
          <th class="col-nowrap" style="width: 110px;">源码定位</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading">
          <td colspan="8" class="empty-cell">正在提取纯净日志...</td>
        </tr>
        <tr v-else-if="logs.length === 0">
          <td colspan="8" class="empty-cell">未检索到任何符合条件的应用日志记录</td>
        </tr>
        <tr v-for="(log, idx) in logs" :key="log.id || idx">
          <td class="col-nowrap">{{ (page - 1) * pageSize + idx + 1 }}</td>
          <td class="col-time">
            <div>{{ log.log_time }}</div>
            <div v-if="log.nano_time" class="nano-time">#{{ log.nano_time }}</div>
          </td>
          <td class="col-nowrap">
            <span :class="['level-badge', getLevelClass(log.level)]">{{ log.level }}</span>
          </td>
          <td class="col-nowrap">
            <span class="span-tag" @click="spanId = log.span_id; loadLogs(1)">{{ log.span_id }}</span>
          </td>
          <td class="col-nowrap">
            <div style="font-weight: 600; font-size: 11px;">{{ log.service_name }}</div>
            <div style="font-size: 10.5px; color: var(--text-muted);">{{ log.thread_name }}</div>
          </td>
          <td style="font-family: monospace; font-size: 11.5px; word-break: break-all;">
            {{ log.logger_name }}
          </td>
          <td>
            <div class="log-msg-text">{{ formatMsg(log.message) }}</div>
          </td>
          <td class="col-nowrap" style="font-size: 11px; color: var(--text-muted);">
            {{ formatSource(log.source_file, log.line_number) }}
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
import { AppLogRecord } from '../types';
import Pagination from '../components/Pagination.vue';

const emit = defineEmits<{
  (e: 'update-stats', stats: any, label: string): void;
  (e: 'toast', msg: string): void;
}>();

const logs = ref<AppLogRecord[]>([]);
const spans = ref<{ span_id: string; parent_span_id: string; log_count: number }[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(50);
const traceId = ref('');
const spanId = ref('');
const level = ref('');
const keyword = ref('');
const loading = ref(false);

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
      emit('update-stats', { total: res.total }, `📜 纯净日志透视 (${traceId.value || '全量'})`);
    }
  } finally {
    loading.value = false;
  }
}

function getLevelClass(lvl: string) {
  const l = (lvl || '').toUpperCase();
  if (l === 'ERROR') return 'level-error';
  if (l === 'WARN') return 'level-warn';
  if (l === 'INFO') return 'level-info';
  return 'level-debug';
}

function formatMsg(msg: string) {
  return msg || '';
}

function formatSource(file: string, line: number) {
  if (!file) return '';
  const base = file.split(/[\\/]/).pop();
  return `${base}:${line}`;
}

function setTrace(tId: string, sId?: string) {
  traceId.value = tId;
  spanId.value = sId || '';
  loadLogs(1);
}

function copyLogs() {
  const text = logs.value.map(l => `${l.log_time} [${l.level}] [${l.trace_id}] [${l.span_id}] ${l.logger_name} - ${l.message}`).join('\n');
  navigator.clipboard.writeText(text);
  emit('toast', '已复制当前页日志至剪贴板');
}

function expandAllStacks(expand: boolean) {
  // 多行展示
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
.input-group input, .input-group select {
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--text);
}
.span-strip {
  background: #f8fafc;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 12px;
  margin-bottom: 8px;
  font-size: 12px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.span-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11.5px;
  background: #ffffff;
  border: 1px solid var(--border);
  cursor: pointer;
  transition: all 0.15s ease;
}
.span-pill:hover, .span-pill.active {
  background: #0284c7;
  color: #ffffff;
  border-color: #0284c7;
}
.span-count {
  font-weight: 700;
  font-size: 10.5px;
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
  transition: all 0.15s ease;
}
.btn-action:hover {
  background: #e2e8f0;
  color: var(--accent);
}
.level-badge {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
  font-family: monospace;
}
.level-info { background: #e0f2fe; color: #0284c7; border: 1px solid #bae6fd; }
.level-warn { background: #fef3c7; color: #d97706; border: 1px solid #fde68a; }
.level-error { background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; }
.level-debug { background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; }
.span-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-family: monospace;
  background: #ede9fe;
  color: #7c3aed;
  border: 1px solid #ddd6fe;
  cursor: pointer;
}
.log-msg-text {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11.5px;
  color: #1e293b;
  word-break: break-all;
  white-space: pre-wrap;
  line-height: 1.45;
  max-height: 160px;
  overflow-y: auto;
}
.nano-time {
  font-size: 10.5px;
  color: #94a3b8;
}
.col-nowrap { white-space: nowrap; }
.col-time { white-space: nowrap; font-size: 12px; font-family: monospace; }
</style>
