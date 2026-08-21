/**
 * 日志 Trace 与 Span 起止行号轻量存根定义
 */
export interface LogTraceStub {
  trace_id: string;
  source_file: string;
  start_line: number;
  end_line: number;
  log_time: string;
  spans: Record<string, { start_line: number; end_line: number }>;
}
