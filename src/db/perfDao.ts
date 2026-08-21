import fs from 'fs';
import path from 'path';
import os from 'os';
import { DbConnection } from './connection';
import { PerfTraceRow, PerfActionRow, ActionNode, HotspotItem, PerfTreeData } from '../types/perf';
import { compressSqlColumns } from '../parser/sqlParser';

export class PerfDao {
  constructor(private db: DbConnection) {}

  public async insertPerfBatch(perfTraceList: { trace: any; actions: any[] }[]): Promise<void> {
    if (!perfTraceList || perfTraceList.length === 0) return;
    return this.db.runSerial(async () => {
      await this._doInsertPerfBatch(perfTraceList);
    });
  }

  private async _doInsertPerfBatch(perfTraceList: { trace: any; actions: any[] }[]): Promise<void> {
    const traces: any[] = [];
    const actions: any[] = [];

    for (const item of perfTraceList) {
      if (item.trace) traces.push(item.trace);
      if (item.actions && item.actions.length > 0) {
        for (const a of item.actions) {
          actions.push({
            trace_id: item.trace.trace_id,
            node_id: a.node_id || 0,
            parent_id: a.parent_id !== undefined ? a.parent_id : -1,
            level: a.level || 0,
            action_name: a.action_name || '',
            time_ms: a.time_ms || 0,
            self_time_ms: a.self_time_ms || 0,
            gap_time_ms: a.gap_time_ms || 0,
            action_category: a.action_category || 'biz',
            sql_text: a.sql_text || '',
            line_number: a.line_number || 0,
            source_file: a.source_file || ''
          });
        }
      }
    }

    if (traces.length > 0) {
      const traceFile = path.join(os.tmpdir(), `duckdb_perf_traces_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
      try {
        const jsonLines = traces.map(t => JSON.stringify(t)).join('\n');
        await fs.promises.writeFile(traceFile, jsonLines, 'utf-8');
        const normPath = traceFile.replace(/\\/g, '/');
        const sql = `
          INSERT INTO perf_traces (
            trace_id, log_time, thread_name, root_action, service_name,
            total_time_ms, self_time_ms, gap_time_ms, biz_time_ms, sql_time_ms, commit_time_ms,
            action_count, sql_count, max_depth, source_file, line_number
          )
          SELECT 
            trace_id, log_time, thread_name, root_action, service_name,
            total_time_ms, self_time_ms, gap_time_ms, biz_time_ms, sql_time_ms, commit_time_ms,
            action_count, sql_count, max_depth, source_file, line_number
          FROM read_json_auto('${normPath}', format='newline_delimited');
        `;
        await this.db.exec(sql);
      } finally {
        fs.unlink(traceFile, () => {});
      }
    }

    if (actions.length > 0) {
      const actionFile = path.join(os.tmpdir(), `duckdb_perf_actions_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
      try {
        const jsonLines = actions.map(a => JSON.stringify(a)).join('\n');
        await fs.promises.writeFile(actionFile, jsonLines, 'utf-8');
        const normPath = actionFile.replace(/\\/g, '/');
        const sql = `
          INSERT INTO perf_actions (
            trace_id, node_id, parent_id, level, action_name,
            time_ms, self_time_ms, gap_time_ms, action_category, sql_text, line_number, source_file
          )
          SELECT 
            trace_id, node_id, parent_id, level, action_name,
            time_ms, self_time_ms, gap_time_ms, action_category, sql_text, line_number, source_file
          FROM read_json_auto('${normPath}', format='newline_delimited');
        `;
        await this.db.exec(sql);
      } finally {
        fs.unlink(actionFile, () => {});
      }
    }
  }

  public async getPerformanceTraceList(page = 1, pageSize = 20, keyword = '', minCostMs = 0, serviceName = ''): Promise<{ data: PerfTraceRow[]; total: number; totalCostMs: number; totalTraces: number; maxCostMs: number }> {
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    if (keyword) {
      whereClause += ' AND (trace_id ILIKE ? OR service_name ILIKE ? OR root_action ILIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (minCostMs > 0) {
      whereClause += ' AND total_time_ms >= ?';
      params.push(minCostMs);
    }
    if (serviceName) {
      whereClause += ' AND service_name = ?';
      params.push(serviceName);
    }

    const countSql = `SELECT COUNT(*) as total, COALESCE(SUM(total_time_ms), 0) as total_cost_ms, COALESCE(MAX(total_time_ms), 0) as max_cost_ms FROM perf_traces ${whereClause}`;
    const countRes = await this.db.query<any>(countSql, params);
    const total = Number(countRes[0]?.total || 0);

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT * FROM perf_traces
      ${whereClause}
      ORDER BY total_time_ms DESC, log_time DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await this.db.query<any>(listSql, [...params, pageSize, offset]);
    return {
      data: rows,
      total,
      totalCostMs: Math.round(Number(countRes[0]?.total_cost_ms || 0)),
      totalTraces: total,
      maxCostMs: Math.round(Number(countRes[0]?.max_cost_ms || 0))
    };
  }

  public async getPerformanceTree(traceId: string): Promise<PerfTreeData | null> {
    const traceRows = await this.db.query<any>('SELECT * FROM perf_traces WHERE trace_id = ?', [traceId]);
    if (!traceRows || traceRows.length === 0) return null;
    const trace = traceRows[0];

    const actionRows = await this.db.query<any>('SELECT * FROM perf_actions WHERE trace_id = ? ORDER BY node_id ASC', [traceId]);

    const nodeMap = new Map<number, ActionNode>();
    const hotspots: HotspotItem[] = [];

    for (const a of actionRows) {
      const sqlDetails: any[] = [];
      if (a.sql_text) {
        sqlDetails.push({
          sql: compressSqlColumns(a.sql_text),
          costMs: a.time_ms,
          time: '',
          sourceFile: a.source_file,
          lineNumber: a.line_number
        });
      }

      const node: ActionNode = {
        id: `${traceId}_${a.node_id}`,
        name: a.action_name,
        depth: a.level,
        totalCostMs: a.time_ms,
        selfCostMs: a.self_time_ms,
        gapCostMs: a.gap_time_ms,
        sourceFile: a.source_file,
        lineNumber: a.line_number,
        sqlCount: sqlDetails.length,
        sqlDetails,
        children: []
      };

      nodeMap.set(a.node_id, node);

      if (a.self_time_ms > 0) {
        hotspots.push({
          name: a.action_name,
          selfCostMs: a.self_time_ms,
          totalCostMs: a.time_ms,
          depth: a.level,
          sourceFile: a.source_file,
          lineNumber: a.line_number
        });
      }
    }

    let rootNode: ActionNode | null = null;
    for (const a of actionRows) {
      const node = nodeMap.get(a.node_id)!;
      if (a.parent_id === -1 || a.level === 0 || !nodeMap.has(a.parent_id)) {
        if (!rootNode) rootNode = node;
      } else {
        const parentNode = nodeMap.get(a.parent_id);
        if (parentNode) {
          parentNode.children.push(node);
        }
      }
    }

    hotspots.sort((x, y) => y.selfCostMs - x.selfCostMs);
    const topHotspots = hotspots.slice(0, 5);
    const topSelfHotspots = topHotspots.map(h => ({
      action_name: h.name,
      name: h.name,
      self_time_ms: h.selfCostMs,
      selfCostMs: h.selfCostMs,
      total_time_ms: h.totalCostMs,
      totalCostMs: h.totalCostMs,
      depth: h.depth,
      source_file: h.sourceFile,
      sourceFile: h.sourceFile,
      line_number: h.lineNumber,
      lineNumber: h.lineNumber
    }));

    return {
      traceId: trace.trace_id,
      serviceName: trace.service_name,
      rootAction: trace.root_action,
      totalTimeMs: trace.total_time_ms,
      selfTimeMs: trace.self_time_ms,
      bizTimeMs: trace.biz_time_ms,
      sqlTimeMs: trace.sql_time_ms,
      commitTimeMs: trace.commit_time_ms,
      actionCount: trace.action_count,
      maxDepth: trace.max_depth,
      sqlCount: trace.sql_count,
      logTime: trace.log_time,
      sourceFile: trace.source_file,
      lineNumber: trace.line_number,
      rootNode: rootNode || (nodeMap.size > 0 ? Array.from(nodeMap.values())[0] : null),
      hotspots: topHotspots,
      topSelfHotspots
    } as any;
  }
}
