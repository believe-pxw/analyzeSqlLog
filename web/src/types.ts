export interface SummaryData {
  totalRecords: number;
  totalFiles: number;
  totalLines: number;
  totalTraces: number;
  totalCostMs: number;
  maxCostMs: number;
  avgCostMs: number;
  totalTemplates: number;
  totalPerfTraces?: number;
  totalAppLogs?: number;
  parseStats?: {
    totalFiles: number;
    totalLines: number;
    totalRecords: number;
    totalPerfTraces: number;
    totalAppLogs: number;
    costMs: number;
  };
}

export interface SqlSummary {
  sql_template: string;
  repeat_count: number;
  total_time_ms: number;
  avg_time_ms: number;
  max_time_ms: number;
  min_time_ms: number;
  trace_count: number;
  example_sql: string;
  example_trace_id: string;
  example_source_file: string;
  example_line_number: number;
}

export interface SqlRecord {
  id?: number;
  log_time: string;
  nano_time?: string;
  level?: string;
  service_name?: string;
  instance_name?: string;
  ip_address?: string;
  host_name?: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  thread_name: string;
  logger_name?: string;
  exec_time_ms: number;
  result_rows?: number;
  db_manager: string;
  sql_template: string;
  sql_params?: string;
  full_sql: string;
  source_file: string;
  line_number: number;
}

export interface DiagnosticsItem {
  trace_id: string;
  db_manager: string;
  sql_template: string;
  repeat_count: number;
  total_time_ms: number;
  avg_time_ms: number;
  max_time_ms: number;
  example_sql: string;
  example_source_file: string;
  example_line_number: number;
  advice: string;
}

export interface TraceSummaryItem {
  trace_id: string;
  sql_count: number;
  total_time_ms: number;
  avg_time_ms: number;
  max_time_ms: number;
  db_manager_count: number;
  first_time: string;
  last_time: string;
}

export interface PerfTraceRow {
  trace_id: string;
  service_name: string;
  root_action: string;
  total_time_ms: number;
  self_time_ms: number;
  gap_time_ms: number;
  biz_time_ms: number;
  sql_time_ms: number;
  commit_time_ms: number;
  action_count: number;
  sql_count: number;
  max_depth: number;
  log_time: string;
  source_file: string;
  line_number: number;
}

export interface ActionSqlDetail {
  sql: string;
  costMs: number;
  time: string;
  sourceFile: string;
  lineNumber: number;
}

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
  // 前端状态
  collapsed?: boolean;
  highlight?: boolean;
}

export interface HotspotItem {
  name: string;
  selfCostMs: number;
  totalCostMs: number;
  depth: number;
  sourceFile: string;
  lineNumber: number;
}

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

export interface AppLogRecord {
  id: number;
  log_time: string;
  nano_time: string;
  level: string;
  service_name: string;
  instance_name: string;
  ip_address: string;
  host_name: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  thread_name: string;
  logger_name: string;
  message: string;
  line_number: number;
  source_file: string;
}
