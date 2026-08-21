/**
 * ActionRecorder 单行解析结果
 */
export interface ActionRecord {
  depth: number;
  actionName: string;
  totalTimeMs: number;
  selfTimeMs: number;
  gapTimeMs: number;
  isAsync: boolean;
  rawLine: string;
}

/**
 * 数据库落库的性能动作节点
 */
export interface PerfActionRow {
  trace_id: string;
  action_id: string;
  parent_action_id: string;
  depth: number;
  action_name: string;
  total_time_ms: number;
  self_time_ms: number;
  gap_time_ms: number;
  source_file: string;
  line_number: number;
  sql_count: number;
  sql_details_json: string;
}

/**
 * 数据库落库的性能主记录
 */
export interface PerfTraceRow {
  trace_id: string;
  service_name: string;
  root_action: string;
  total_time_ms: number;
  self_time_ms: number;
  biz_time_ms: number;
  sql_time_ms: number;
  commit_time_ms: number;
  action_count: number;
  max_depth: number;
  sql_count: number;
  log_time: string;
  source_file: string;
  line_number: number;
}

/**
 * 关联的 SQL 明细
 */
export interface ActionSqlDetail {
  sql: string;
  costMs: number;
  time: string;
  sourceFile: string;
  lineNumber: number;
}

/**
 * 组装后的树形调用节点
 */
export interface ActionNode {
  id: string;
  name: string;
  depth: number;
  totalCostMs: number;
  selfCostMs: number;
  gapCostMs: number;
  sourceFile: string;
  lineNumber: number;
  sqlCount: number;
  sqlDetails: ActionSqlDetail[];
  children: ActionNode[];
}

/**
 * Top 5 自身耗时热点
 */
export interface HotspotItem {
  name: string;
  selfCostMs: number;
  totalCostMs: number;
  depth: number;
  sourceFile: string;
  lineNumber: number;
}

/**
 * 单笔请求性能树完整分析结构
 */
export interface PerfTreeData {
  traceId: string;
  serviceName: string;
  rootAction: string;
  totalTimeMs: number;
  selfTimeMs: number;
  bizTimeMs: number;
  sqlTimeMs: number;
  commitTimeMs: number;
  actionCount: number;
  maxDepth: number;
  sqlCount: number;
  logTime: string;
  sourceFile: string;
  lineNumber: number;
  rootNode: ActionNode | null;
  hotspots: HotspotItem[];
}
