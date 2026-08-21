<template>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="title">
        <h1>⚡ SQL 与全链路性能分析器</h1>
        <span class="badge">DuckDB 内存引擎</span>
      </div>
      <div class="header-stat">{{ summaryText }}</div>
    </header>

    <!-- Tab 导航 -->
    <div class="tabs">
      <button
        v-for="t in tabList"
        :key="t.key"
        :class="['tab-btn', { active: currentTab === t.key }]"
        @click="switchTab(t.key)"
      >
        {{ t.name }}
      </button>
    </div>

    <!-- 8 大 Tab 视图 (各自独立拥有专属的 ContextSummaryStrip) -->
    <keep-alive>
      <component
        :is="activeTabComponent"
        ref="currentTabRef"
        @jump-tab="onJumpTab"
        @jump-detail="onJumpDetail"
        @toast="showToast"
      />
    </keep-alive>

    <Toast ref="toastRef" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import { api } from './api';
import Toast from './components/Toast.vue';
import PerfTreeTab from './views/PerfTreeTab.vue';
import AppLogsTab from './views/AppLogsTab.vue';
import TraceSummaryTab from './views/TraceSummaryTab.vue';
import DiagnosticsTab from './views/DiagnosticsTab.vue';
import RepeatedSqlTab from './views/RepeatedSqlTab.vue';
import SlowSqlTab from './views/SlowSqlTab.vue';
import TraceDetailTab from './views/TraceDetailTab.vue';
import SqlDetailTab from './views/SqlDetailTab.vue';

const tabList = [
  { key: 'perf-tree', name: '⚡ 性能链路树' },
  { key: 'app-logs', name: '📜 纯净日志透视' },
  { key: 'trace-summary', name: '🌐 Trace 聚合大盘' },
  { key: 'diagnose', name: '🔁 事务内重复 SQL (N+1)' },
  { key: 'repeated', name: '📊 SQL 频次榜' },
  { key: 'slow', name: '🐢 慢 SQL 排行' },
  { key: 'trace', name: '🔗 Trace 链路分析' },
  { key: 'detail', name: '📋 SQL 调用明细' },
];

const currentTab = ref('perf-tree');
const summaryText = ref('正在加载数据...');
const currentStatsLabel = ref('⚡ 当前统计: 全链路性能树');
const contextStats = ref<any>({});
const toastRef = ref<any>(null);
const currentTabRef = ref<any>(null);

const activeTabComponent = computed(() => {
  switch (currentTab.value) {
    case 'perf-tree': return PerfTreeTab;
    case 'app-logs': return AppLogsTab;
    case 'trace-summary': return TraceSummaryTab;
    case 'diagnose': return DiagnosticsTab;
    case 'repeated': return RepeatedSqlTab;
    case 'slow': return SlowSqlTab;
    case 'trace': return TraceDetailTab;
    case 'detail': return SqlDetailTab;
    default: return PerfTreeTab;
  }
});

function switchTab(key: string) {
  currentTab.value = key;
}

function onUpdateStats(stats: any, label: string) {
  contextStats.value = stats;
  if (label) currentStatsLabel.value = label;
}

async function onJumpTab(tab: string, traceId?: string) {
  currentTab.value = tab;
  await nextTick();
  if (tab === 'perf-tree' && traceId && currentTabRef.value?.openDetail) {
    currentTabRef.value.openDetail(traceId);
  } else if (tab === 'app-logs' && traceId && currentTabRef.value?.setTrace) {
    currentTabRef.value.setTrace(traceId);
  } else if (tab === 'trace' && traceId && currentTabRef.value?.setTrace) {
    currentTabRef.value.setTrace(traceId);
  }
}

async function onJumpDetail(template: string, meta?: any) {
  currentTab.value = 'detail';
  await nextTick();
  if (currentTabRef.value?.setTemplate) {
    currentTabRef.value.setTemplate(template, meta || {});
  }
}

function showToast(msg: string) {
  if (toastRef.value) toastRef.value.show(msg);
}

onMounted(async () => {
  try {
    const res = await api.getSummary();
    if (res.success && res.data) {
      const d = res.data;
      if (d.parseStats) {
        let text = `扫描 ${d.parseStats.totalFiles} 个文件, ${(d.parseStats.totalLines || 0).toLocaleString()} 行日志, 提取 ${(d.parseStats.totalRecords || 0).toLocaleString()} 条 SQL`;
        if (d.parseStats.totalPerfTraces > 0) {
          text += ` | ${d.parseStats.totalPerfTraces} 笔性能分析树`;
        }
        text += ` (耗时 ${d.parseStats.costMs} ms)`;
        summaryText.value = text;
      }
    }
  } catch (e) {
    summaryText.value = '数据装载完成';
  }
});
</script>

<style scoped>
.container {
  max-width: 1600px;
  margin: 0 auto;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 14px;
  background: var(--panel-bg);
  box-shadow: var(--shadow);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 6px;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title h1 {
  font-size: 17px;
  font-weight: 700;
  color: #0284c7;
}
.badge {
  background: #e0f2fe;
  color: #0369a1;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid #bae6fd;
}
.header-stat {
  font-size: 12px;
  color: var(--text-muted);
}
.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
  border-bottom: 2px solid var(--border);
  padding-bottom: 4px;
  flex-wrap: wrap;
}
.tab-btn {
  padding: 5px 12px;
  background: #f1f5f9;
  border: 1px solid var(--border);
  border-radius: 5px 5px 0 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.tab-btn:hover {
  background: #e2e8f0;
  color: var(--text);
}
.tab-btn.active {
  background: var(--panel-bg);
  color: var(--accent);
  border-bottom: 2px solid var(--accent);
  margin-bottom: -6px;
  padding-bottom: 7px;
  font-weight: 700;
}
.context-summary-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: 5px;
  margin-bottom: 6px;
  font-size: 12px;
  box-shadow: var(--shadow);
}
.strip-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #0369a1;
}
.strip-right {
  display: flex;
  align-items: center;
  gap: 14px;
  color: #475569;
}
.strip-metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.strip-val {
  font-weight: 700;
  color: #0f172a;
}
.strip-val.red {
  color: #dc2626;
}
</style>
