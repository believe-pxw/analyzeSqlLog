<template>
  <tr :class="['tree-row', { 'row-highlight': node.highlight }]" :style="{ backgroundColor: rowBgColor }">
    <!-- 动作名称与缩进 -->
    <td :style="{ paddingLeft: (node.depth * 20 + 8) + 'px' }">
      <span
        v-if="hasChildren"
        class="tree-toggle"
        @click.stop="toggleCollapse"
      >
        {{ node.collapsed ? '+' : '−' }}
      </span>
      <span v-else class="tree-toggle-empty"></span>

      <span class="tree-node-name" :title="node.name">{{ node.name }}</span>

      <!-- 关联 SQL 徽章 -->
      <span
        v-if="node.sqlCount > 0"
        class="sql-badge"
        @click.stop="showSql = !showSql"
        title="点击查看关联 SQL"
      >
        🔍 {{ node.sqlCount }} 条 SQL
      </span>

      <!-- 关联 SQL 内容展示 -->
      <div v-if="showSql && node.sqlDetails && node.sqlDetails.length > 0" class="sql-preview-box">
        <div v-for="(s, idx) in node.sqlDetails" :key="idx" class="sql-item">
          <SqlCodeBox :code="s.sql" @toast="$emit('toast', $event)" />
          <div class="sql-meta">
            <span>耗时: {{ s.costMs }} ms</span>
            <SourceLink :sourceFile="s.sourceFile" :lineNumber="s.lineNumber" @toast="$emit('toast', $event)" />
          </div>
        </div>
      </div>
    </td>

    <!-- 总耗时 -->
    <td class="col-nowrap">
      <CostBadge :costMs="node.totalCostMs" />
    </td>

    <!-- 净自耗时 -->
    <td class="col-nowrap">
      <CostBadge :costMs="node.selfCostMs" />
      <span v-if="selfPercent > 0" class="self-pct">({{ selfPercent }}%)</span>
      <span class="tree-bar-bg">
        <span class="tree-bar-fill" :style="{ width: Math.min(100, selfPercent) + '%' }"></span>
      </span>
    </td>

    <!-- 间隙 (Gap) -->
    <td class="col-nowrap col-mono" style="color: #64748b;">
      {{ node.gapCostMs }} ms
    </td>

    <!-- 日志源码定位 -->
    <td class="col-nowrap">
      <SourceLink :sourceFile="node.sourceFile" :lineNumber="node.lineNumber" @toast="$emit('toast', $event)" />
    </td>
  </tr>

  <!-- 递归渲染子节点 -->
  <template v-if="!node.collapsed && hasChildren">
    <PerfTreeNode
      v-for="child in node.children"
      :key="child.id"
      :node="child"
      :rootTotalCost="rootTotalCost"
      @jump-applogs="$emit('jump-applogs', $event)"
      @toast="$emit('toast', $event)"
    />
  </template>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ActionNode } from '../types';
import CostBadge from '../components/CostBadge.vue';
import SqlCodeBox from '../components/SqlCodeBox.vue';
import SourceLink from '../components/SourceLink.vue';

const props = defineProps<{
  node: ActionNode;
  rootTotalCost: number;
}>();

defineEmits<{
  (e: 'jump-applogs', traceId: string): void;
  (e: 'toast', msg: string): void;
}>();

const showSql = ref(false);

const hasChildren = computed(() => props.node.children && props.node.children.length > 0);

const selfPercent = computed(() => {
  if (props.rootTotalCost <= 0) return 0;
  return Math.round((props.node.selfCostMs / props.rootTotalCost) * 100);
});

const rowBgColor = computed(() => {
  if (props.node.highlight) return '#fef08a';
  if (props.node.selfCostMs >= 500) return '#fff1f2';
  if (props.node.selfCostMs >= 100) return '#fef3c7';
  return 'transparent';
});

function toggleCollapse() {
  props.node.collapsed = !props.node.collapsed;
}
</script>

<style scoped>
.tree-row {
  transition: background-color 0.15s ease;
}
.tree-row:hover {
  background-color: #f1f5f9;
}
.tree-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
  margin-right: 5px;
  user-select: none;
  line-height: 1;
}
.tree-toggle:hover {
  background: #e2e8f0;
  color: #0284c7;
  border-color: #94a3b8;
}
.tree-toggle-empty {
  display: inline-block;
  width: 16px;
  height: 16px;
  margin-right: 5px;
}
.tree-node-name {
  font-weight: 600;
  color: #1e293b;
  word-break: break-all;
  font-size: 12px;
}
.sql-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 5px;
  background: #e0f2fe;
  color: #0284c7;
  border: 1px solid #bae6fd;
  border-radius: 3px;
  font-size: 11px;
  cursor: pointer;
  font-weight: 600;
}
.sql-preview-box {
  margin-top: 4px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 11.5px;
}
.sql-item {
  margin-bottom: 6px;
}
.sql-meta {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 2px;
}
.self-pct {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: 3px;
}
.tree-bar-bg {
  width: 50px;
  height: 6px;
  background: #e2e8f0;
  border-radius: 3px;
  overflow: hidden;
  display: inline-block;
  vertical-align: middle;
  margin-left: 4px;
}
.tree-bar-fill {
  height: 100%;
  background: #ef4444;
}
</style>
