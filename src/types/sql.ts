/**
 * 单条 SQL 结构化执行记录
 */
export interface SqlRecord {
  id?: number;
  log_time: string;
  trace_id: string;
  span_id: string;
  thread_name: string;
  exec_time_ms: number;
  time_cost_level: string;
  db_manager: string;
  table_names: string;
  sql_template: string;
  params: string;
  full_sql: string;
  source_file: string;
  line_number: number;
  affected_rows?: number;
}

/**
 * SQL 模板聚合统计
 */
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

/**
 * 事务内 N+1 重复 SQL 诊断项
 */
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

/**
 * Trace 聚合大盘模型
 */
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
