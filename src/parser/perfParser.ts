import { ActionRecord, PerfTraceRow, PerfActionRow } from '../types/perf';

export interface ParsedActionItem {
  level: number;
  time_us: number;
  self_time_us: number;
  gap_time_us: number;
  time_ms: number;
  self_time_ms: number;
  gap_time_ms: number;
  action_name: string;
  sql_text: string;
  line_number?: number;
  source_file?: string;
  node_id?: number;
  parent_id?: number;
  action_category?: 'biz' | 'sql' | 'commit';
}

/**
 * 解析 ActionRecorder 格式单行
 * 格式: Level \t Time(us) \t SelfTime(us) \t GapTime(us) \t ActionName
 */
export function parseActionLine(line: string): ParsedActionItem | null {
  const cleanLine = line.startsWith('>') ? line.substring(1) : line;
  const parts = cleanLine.split('\t');
  if (parts.length < 5) return null;

  const rawLevel = parts[0];
  const level = parseInt(rawLevel.trim(), 10);
  if (isNaN(level)) return null;

  const timeUs = parseFloat(parts[1]) || 0;
  const selfTimeUs = parseFloat(parts[2]) || 0;
  const gapTimeUs = parseFloat(parts[3]) || 0;
  const actionName = parts.slice(4).join('\t').trim();

  return {
    level,
    time_us: timeUs,
    self_time_us: selfTimeUs,
    gap_time_us: gapTimeUs,
    time_ms: Math.round(timeUs / 10) / 100,
    self_time_ms: Math.round(selfTimeUs / 10) / 100,
    gap_time_ms: Math.round(gapTimeUs / 10) / 100,
    action_name: actionName,
    sql_text: '',
  };
}

/**
 * 组装与计算 Performance Trace 摘要与结构树指标
 */
export function calculatePerfTraceMetrics(
  traceId: string,
  logTime: string,
  threadName: string,
  sourceFile: string,
  lineNumber: number,
  actions: ParsedActionItem[]
): { trace: any; actions: ParsedActionItem[] } {
  const levelStack: number[] = [];
  let totalSqlCount = 0;
  let totalSqlTimeMs = 0;
  let totalCommitTimeMs = 0;
  let totalGapTimeMs = 0;
  let maxDepth = 0;

  actions.forEach((a, idx) => {
    a.node_id = idx;
    if (a.level > maxDepth) maxDepth = a.level;

    levelStack[a.level] = idx;
    a.parent_id = a.level > 0 ? (levelStack[a.level - 1] ?? -1) : -1;

    totalGapTimeMs += a.gap_time_ms;

    if (a.action_name.startsWith('QueryDatabase/')) {
      totalSqlCount++;
      totalSqlTimeMs += a.time_ms;
      a.action_category = 'sql';
    } else if (a.action_name === 'DB commit' || a.action_name === 'submit') {
      totalCommitTimeMs += a.time_ms;
      a.action_category = 'commit';
    } else {
      a.action_category = 'biz';
    }
  });

  const rootAction = actions.find(a => a.level === 0) || actions[0];
  const firstService = actions.find(a => a.level === 1) || { action_name: '-' };

  const totalTimeMs = rootAction ? rootAction.time_ms : 0;
  const selfTimeMs = rootAction ? rootAction.self_time_ms : 0;
  const bizTimeMs = Math.max(0, Math.round((totalTimeMs - totalSqlTimeMs - totalCommitTimeMs) * 100) / 100);

  const traceSummary = {
    id: 0,
    trace_id: traceId,
    log_time: logTime,
    thread_name: threadName,
    root_action: rootAction ? rootAction.action_name : 'MidVEFilter.doFilter',
    service_name: firstService ? firstService.action_name : '-',
    total_time_ms: totalTimeMs,
    self_time_ms: selfTimeMs,
    gap_time_ms: Math.round(totalGapTimeMs * 100) / 100,
    biz_time_ms: bizTimeMs,
    sql_time_ms: Math.round(totalSqlTimeMs * 100) / 100,
    commit_time_ms: Math.round(totalCommitTimeMs * 100) / 100,
    action_count: actions.length,
    sql_count: totalSqlCount,
    max_depth: maxDepth,
    source_file: sourceFile,
    line_number: lineNumber,
  };

  return { trace: traceSummary, actions };
}
