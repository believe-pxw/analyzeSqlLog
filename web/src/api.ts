import {
  SummaryData,
  SqlSummary,
  SqlRecord,
  DiagnosticsItem,
  TraceSummaryItem,
  PerfTraceRow,
  PerfTreeData,
  AppLogRecord,
} from './types';

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  getSummary: () => fetchJson<{ success: boolean; data: SummaryData }>('/api/summary'),

  getPerfTraceList: (params: { page?: number; pageSize?: number; keyword?: string; minCostMs?: number }) => {
    const q = new URLSearchParams({
      page: String(params.page || 1),
      pageSize: String(params.pageSize || 20),
      keyword: params.keyword || '',
      minCostMs: String(params.minCostMs || 0),
    });
    return fetchJson<{
      success: boolean;
      data: PerfTraceRow[];
      total: number;
      totalCostMs: number;
      totalTraces: number;
      maxCostMs: number;
    }>(`/api/perf-trace-list?${q}`);
  },

  getPerfTree: (traceId: string) => {
    return fetchJson<{ success: boolean; data: PerfTreeData }>(`/api/perf-tree?traceId=${encodeURIComponent(traceId)}`);
  },

  getAppLogs: (params: {
    page?: number;
    pageSize?: number;
    traceId?: string;
    spanId?: string;
    level?: string;
    keyword?: string;
  }) => {
    const q = new URLSearchParams({
      page: String(params.page || 1),
      pageSize: String(params.pageSize || 50),
      traceId: params.traceId || '',
      spanId: params.spanId || '',
      level: params.level || '',
      keyword: params.keyword || '',
    });
    return fetchJson<{
      success: boolean;
      data: AppLogRecord[];
      total: number;
      spans: { span_id: string; parent_span_id: string; log_count: number }[];
    }>(`/api/app-logs?${q}`);
  },

  getTraceSummaryList: (params: { page?: number; pageSize?: number; keyword?: string; minCostMs?: number }) => {
    const q = new URLSearchParams({
      page: String(params.page || 1),
      pageSize: String(params.pageSize || 20),
      keyword: params.keyword || '',
      minCostMs: String(params.minCostMs || 0),
    });
    return fetchJson<{
      success: boolean;
      data: TraceSummaryItem[];
      total: number;
      totalCostMs: number;
      totalSqls: number;
      totalTraces: number;
      maxCostMs: number;
    }>(`/api/trace-summary-list?${q}`);
  },

  getDiagnostics: (params: {
    page?: number;
    pageSize?: number;
    traceId?: string;
    minRepeatCount?: number;
    keyword?: string;
  }) => {
    const q = new URLSearchParams({
      page: String(params.page || 1),
      pageSize: String(params.pageSize || 20),
      traceId: params.traceId || '',
      minRepeatCount: String(params.minRepeatCount || 5),
      keyword: params.keyword || '',
    });
    return fetchJson<{
      success: boolean;
      data: DiagnosticsItem[];
      total: number;
      totalCostMs: number;
      totalSqls: number;
      totalTraces: number;
    }>(`/api/diagnostics?${q}`);
  },

  getTopRepeated: (params: { page?: number; pageSize?: number; keyword?: string }) => {
    const q = new URLSearchParams({
      page: String(params.page || 1),
      pageSize: String(params.pageSize || 20),
      keyword: params.keyword || '',
    });
    return fetchJson<{
      success: boolean;
      data: SqlSummary[];
      total: number;
      totalSqls: number;
      totalCostMs: number;
      maxCostMs: number;
    }>(`/api/top-repeated?${q}`);
  },

  getTopSlow: (params: {
    page?: number;
    pageSize?: number;
    traceId?: string;
    minCostMs?: number;
    keyword?: string;
  }) => {
    const q = new URLSearchParams({
      page: String(params.page || 1),
      pageSize: String(params.pageSize || 20),
      traceId: params.traceId || '',
      minCostMs: String(params.minCostMs || 0),
      keyword: params.keyword || '',
    });
    return fetchJson<{
      success: boolean;
      data: SqlRecord[];
      total: number;
      totalCostMs: number;
      maxCostMs: number;
      totalTraces: number;
    }>(`/api/top-slow?${q}`);
  },

  getTrace: (params: { page?: number; pageSize?: number; traceId: string }) => {
    const q = new URLSearchParams({
      page: String(params.page || 1),
      pageSize: String(params.pageSize || 50),
      traceId: params.traceId,
    });
    return fetchJson<{
      success: boolean;
      data: SqlRecord[];
      total: number;
      totalCostMs: number;
      maxCostMs: number;
    }>(`/api/trace?${q}`);
  },

  getByTemplate: (params: {
    page?: number;
    pageSize?: number;
    sqlTemplate: string;
    traceId?: string;
    dbManager?: string;
  }) => {
    const q = new URLSearchParams({
      page: String(params.page || 1),
      pageSize: String(params.pageSize || 50),
      sqlTemplate: params.sqlTemplate,
      traceId: params.traceId || '',
      dbManager: params.dbManager || '',
    });
    return fetchJson<{
      success: boolean;
      data: SqlRecord[];
      total: number;
      totalCostMs: number;
      maxCostMs: number;
    }>(`/api/by-template?${q}`);
  },
};
