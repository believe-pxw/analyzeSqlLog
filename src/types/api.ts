import { SqlSummary, SqlRecord, DiagnosticsItem, TraceSummaryItem } from './sql';
import { PerfTraceRow, PerfTreeData } from './perf';
import { AppLogRecord } from './log';

export interface ApiResponse<T = any> {
  success: boolean;
  data: T;
  total?: number;
  error?: string;
  totalCostMs?: number;
  totalSqls?: number;
  totalTraces?: number;
  maxCostMs?: number;
}

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

export interface PageParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  minCostMs?: number;
  traceId?: string;
  dbManager?: string;
  sqlTemplate?: string;
  level?: string;
  spanId?: string;
  serviceName?: string;
}
