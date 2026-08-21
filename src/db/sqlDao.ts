import fs from 'fs';
import path from 'path';
import os from 'os';
import { DbConnection } from './connection';
import { SqlRecord, SqlSummary, DiagnosticsItem, TraceSummaryItem } from '../types/sql';
import { compressSqlColumns } from '../parser/sqlParser';

export class SqlDao {
  constructor(private db: DbConnection) {}

  public async insertBatch(records: SqlRecord[]): Promise<void> {
    if (!records || records.length === 0) return;
    return this.db.runSerial(async () => {
      await this._doInsertBatch(records);
    });
  }

  private async _doInsertBatch(records: SqlRecord[]): Promise<void> {
    if (!records || records.length === 0) return;

    const tmpFile = path.join(os.tmpdir(), `duckdb_sqllogs_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    try {
      const jsonLines = records.map(r => JSON.stringify({
        id: r.id || 0,
        log_time: r.log_time || '',
        nano_time: (r as any).nano_time || '',
        level: (r as any).level || 'INFO',
        service_name: (r as any).service_name || '-',
        instance_name: (r as any).instance_name || '-',
        ip_address: (r as any).ip_address || '-',
        host_name: (r as any).host_name || '-',
        trace_id: r.trace_id || '-',
        span_id: r.span_id || '-',
        parent_span_id: (r as any).parent_span_id || '-',
        thread_name: r.thread_name || '-',
        logger_name: (r as any).logger_name || '',
        exec_time_ms: r.exec_time_ms || 0,
        result_rows: (r as any).result_rows || 0,
        db_manager: r.db_manager || '',
        sql_template: r.sql_template || '',
        sql_params: (r as any).sql_params || '',
        full_sql: r.full_sql || '',
        line_number: r.line_number || 0,
        source_file: r.source_file || ''
      })).join('\n');

      await fs.promises.writeFile(tmpFile, jsonLines, 'utf-8');
      const normalizedPath = tmpFile.replace(/\\/g, '/');

      const sql = `
        INSERT INTO sqllogs (
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          exec_time_ms, result_rows, db_manager, sql_template, sql_params, full_sql, line_number, source_file
        )
        SELECT 
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          exec_time_ms, result_rows, db_manager, sql_template, sql_params, full_sql, line_number, source_file
        FROM read_json_auto('${normalizedPath}', format='newline_delimited');
      `;
      await this.db.exec(sql);
    } catch (err) {
      // Fallback
      await this._insertFallback(records);
    } finally {
      fs.unlink(tmpFile, () => {});
    }
  }

  private async _insertFallback(records: SqlRecord[]): Promise<void> {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const values = chunk.map(r => `(
        ${r.id || 0},
        '${(r.log_time || '').replace(/'/g, "''")}',
        '${((r as any).nano_time || '').replace(/'/g, "''")}',
        '${((r as any).level || 'INFO').replace(/'/g, "''")}',
        '${((r as any).service_name || '-').replace(/'/g, "''")}',
        '${((r as any).instance_name || '-').replace(/'/g, "''")}',
        '${((r as any).ip_address || '-').replace(/'/g, "''")}',
        '${((r as any).host_name || '-').replace(/'/g, "''")}',
        '${(r.trace_id || '-').replace(/'/g, "''")}',
        '${(r.span_id || '-').replace(/'/g, "''")}',
        '${((r as any).parent_span_id || '-').replace(/'/g, "''")}',
        '${(r.thread_name || '-').replace(/'/g, "''")}',
        '${((r as any).logger_name || '').replace(/'/g, "''")}',
        ${r.exec_time_ms || 0},
        ${(r as any).result_rows || 0},
        '${(r.db_manager || '').replace(/'/g, "''")}',
        '${(r.sql_template || '').replace(/'/g, "''")}',
        '${((r as any).sql_params || '').replace(/'/g, "''")}',
        '${(r.full_sql || '').replace(/'/g, "''")}',
        ${r.line_number || 0},
        '${(r.source_file || '').replace(/'/g, "''")}'
      )`).join(',');

      await this.db.exec(`INSERT INTO sqllogs VALUES ${values}`);
    }
  }

  public async getTotalSummary(): Promise<any> {
    const sql = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT trace_id) as total_traces,
        COUNT(DISTINCT sql_template) as total_templates,
        COALESCE(SUM(exec_time_ms), 0) as total_time_ms,
        COALESCE(MAX(exec_time_ms), 0) as max_time_ms,
        COALESCE(AVG(exec_time_ms), 0) as avg_time_ms
      FROM sqllogs
    `;
    const res = await this.db.query<any>(sql);
    const row = res[0] || {};
    return {
      totalRecords: Number(row.total_records || 0),
      totalTraces: Number(row.total_traces || 0),
      totalTemplates: Number(row.total_templates || 0),
      totalTimeMs: Math.round(Number(row.total_time_ms || 0)),
      maxTimeMs: Math.round(Number(row.max_time_ms || 0)),
      avgTimeMs: Math.round(Number(row.avg_time_ms || 0) * 100) / 100
    };
  }

  public async getTopRepeated(page = 1, pageSize = 20, keyword = ''): Promise<{ data: SqlSummary[]; total: number; totalSqls: number; totalCostMs: number; maxCostMs: number }> {
    let whereClause = "WHERE sql_template IS NOT NULL AND sql_template != ''";
    const params: any[] = [];
    if (keyword) {
      whereClause += ' AND sql_template ILIKE ?';
      params.push(`%${keyword}%`);
    }

    const countSql = `SELECT COUNT(DISTINCT sql_template) as total FROM sqllogs ${whereClause}`;
    const countRes = await this.db.query<any>(countSql, params);
    const total = Number(countRes[0]?.total || 0);

    const statSql = `
      SELECT 
        COALESCE(SUM(exec_time_ms), 0) as total_cost_ms,
        COUNT(*) as total_sqls,
        COALESCE(MAX(exec_time_ms), 0) as max_cost_ms
      FROM sqllogs ${whereClause}
    `;
    const statRes = await this.db.query<any>(statSql, params);
    const statRow = statRes[0] || {};

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT 
        sql_template,
        COUNT(*) as repeat_count,
        SUM(exec_time_ms) as total_time_ms,
        AVG(exec_time_ms) as avg_time_ms,
        MAX(exec_time_ms) as max_time_ms,
        MIN(exec_time_ms) as min_time_ms,
        COUNT(DISTINCT trace_id) as trace_count,
        FIRST(full_sql) as example_sql,
        FIRST(trace_id) as example_trace_id,
        FIRST(source_file) as example_source_file,
        FIRST(line_number) as example_line_number
      FROM sqllogs
      ${whereClause}
      GROUP BY sql_template
      ORDER BY repeat_count DESC, total_time_ms DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await this.db.query<any>(listSql, [...params, pageSize, offset]);
    const data: SqlSummary[] = rows.map(r => ({
      sql_template: r.sql_template,
      repeat_count: Number(r.repeat_count),
      total_time_ms: Math.round(Number(r.total_time_ms)),
      avg_time_ms: Math.round(Number(r.avg_time_ms) * 100) / 100,
      max_time_ms: Math.round(Number(r.max_time_ms)),
      min_time_ms: Math.round(Number(r.min_time_ms)),
      trace_count: Number(r.trace_count),
      example_sql: compressSqlColumns(r.example_sql || r.sql_template),
      example_trace_id: r.example_trace_id,
      example_source_file: r.example_source_file,
      example_line_number: Number(r.example_line_number)
    }));

    return {
      data,
      total,
      totalSqls: Number(statRow.total_sqls || 0),
      totalCostMs: Math.round(Number(statRow.total_cost_ms || 0)),
      maxCostMs: Math.round(Number(statRow.max_cost_ms || 0))
    };
  }

  public async getTopSlow(page = 1, pageSize = 20, traceId = '', minCostMs = 0, keyword = ''): Promise<{ data: SqlRecord[]; total: number; totalCostMs: number; maxCostMs: number; totalTraces: number }> {
    let whereClause = "WHERE 1=1";
    const params: any[] = [];
    if (traceId) {
      whereClause += ' AND trace_id = ?';
      params.push(traceId);
    }
    if (minCostMs > 0) {
      whereClause += ' AND exec_time_ms >= ?';
      params.push(minCostMs);
    }
    if (keyword) {
      whereClause += ' AND (sql_template ILIKE ? OR full_sql ILIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const countSql = `SELECT COUNT(*) as total FROM sqllogs ${whereClause}`;
    const countRes = await this.db.query<any>(countSql, params);
    const total = Number(countRes[0]?.total || 0);

    const statSql = `
      SELECT 
        COALESCE(SUM(exec_time_ms), 0) as total_cost_ms,
        COALESCE(MAX(exec_time_ms), 0) as max_cost_ms,
        COUNT(DISTINCT trace_id) as total_traces
      FROM sqllogs ${whereClause}
    `;
    const statRes = await this.db.query<any>(statSql, params);
    const statRow = statRes[0] || {};

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT * FROM sqllogs
      ${whereClause}
      ORDER BY exec_time_ms DESC, log_time ASC
      LIMIT ? OFFSET ?
    `;

    const rows = await this.db.query<any>(listSql, [...params, pageSize, offset]);
    const data: SqlRecord[] = rows.map(r => ({
      ...r,
      full_sql: compressSqlColumns(r.full_sql || r.sql_template)
    }));

    return {
      data,
      total,
      totalCostMs: Math.round(Number(statRow.total_cost_ms || 0)),
      maxCostMs: Math.round(Number(statRow.max_cost_ms || 0)),
      totalTraces: Number(statRow.total_traces || 0)
    };
  }

  public async getDiagnostics(traceId = '', page = 1, pageSize = 20, minRepeatCount = 5, keyword = ''): Promise<{ data: DiagnosticsItem[]; total: number; totalCostMs: number; totalSqls: number; totalTraces: number; maxCostMs: number }> {
    let whereClause = "WHERE db_manager IS NOT NULL AND db_manager != '' AND sql_template IS NOT NULL AND sql_template != '' AND sql_template NOT ILIKE 'update %' AND sql_template NOT ILIKE 'delete %' AND sql_template NOT ILIKE 'insert %'";
    const params: any[] = [];
    if (traceId) {
      whereClause += ' AND trace_id = ?';
      params.push(traceId);
    }
    if (keyword) {
      whereClause += ' AND (sql_template ILIKE ? OR full_sql ILIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }

    const havingClause = 'HAVING COUNT(*) >= ?';
    const havingParams = [minRepeatCount];

    const groupSql = `
      SELECT 
        trace_id,
        db_manager,
        sql_template,
        COUNT(*) as repeat_count,
        SUM(exec_time_ms) as total_time_ms,
        AVG(exec_time_ms) as avg_time_ms,
        MAX(exec_time_ms) as max_time_ms,
        FIRST(full_sql) as example_sql,
        FIRST(source_file) as example_source_file,
        FIRST(line_number) as example_line_number
      FROM sqllogs
      ${whereClause}
      GROUP BY trace_id, db_manager, sql_template
      ${havingClause}
    `;

    const countSql = `SELECT COUNT(*) as total, COALESCE(SUM(total_time_ms), 0) as total_cost_ms, COALESCE(SUM(repeat_count), 0) as total_sqls, COUNT(DISTINCT trace_id) as total_traces, COALESCE(MAX(max_time_ms), 0) as max_cost_ms FROM (${groupSql}) t`;
    const countRes = await this.db.query<any>(countSql, [...params, ...havingParams]);
    const total = Number(countRes[0]?.total || 0);
    const totalCostMs = Math.round(Number(countRes[0]?.total_cost_ms || 0));
    const totalSqls = Number(countRes[0]?.total_sqls || 0);
    const totalTraces = Number(countRes[0]?.total_traces || 0);
    const maxCostMs = Math.round(Number(countRes[0]?.max_cost_ms || 0));

    const offset = (page - 1) * pageSize;
    const listSql = `
      ${groupSql}
      ORDER BY repeat_count DESC, total_time_ms DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await this.db.query<any>(listSql, [...params, ...havingParams, pageSize, offset]);
    const data: DiagnosticsItem[] = rows.map(r => ({
      trace_id: r.trace_id,
      db_manager: r.db_manager,
      sql_template: r.sql_template,
      repeat_count: Number(r.repeat_count),
      total_time_ms: Math.round(Number(r.total_time_ms)),
      avg_time_ms: Math.round(Number(r.avg_time_ms) * 100) / 100,
      max_time_ms: Math.round(Number(r.max_time_ms)),
      example_sql: compressSqlColumns(r.example_sql || r.sql_template),
      example_source_file: r.example_source_file,
      example_line_number: Number(r.example_line_number),
      advice: Number(r.repeat_count) >= 20 ? '🔥 严重循环: 强烈建议改用批量 IN 查询或加缓存' : '⚠️ 重复执行: 建议评估循环调用'
    }));

    return { data, total, totalCostMs, totalSqls, totalTraces, maxCostMs };
  }

  public async getTraceSummaryList(page = 1, pageSize = 20, keyword = '', minCostMs = 0): Promise<{ data: TraceSummaryItem[]; total: number; totalCostMs: number; totalSqls: number; totalTraces: number; maxCostMs: number }> {
    let whereClause = "WHERE trace_id IS NOT NULL AND trace_id != '-'";
    const params: any[] = [];
    if (keyword) {
      whereClause += ' AND trace_id ILIKE ?';
      params.push(`%${keyword}%`);
    }

    const groupSql = `
      SELECT 
        trace_id,
        COUNT(*) as sql_count,
        SUM(exec_time_ms) as total_time_ms,
        AVG(exec_time_ms) as avg_time_ms,
        MAX(exec_time_ms) as max_time_ms,
        COUNT(DISTINCT db_manager) as db_manager_count,
        MIN(log_time) as first_time,
        MAX(log_time) as last_time
      FROM sqllogs
      ${whereClause}
      GROUP BY trace_id
      ${minCostMs > 0 ? 'HAVING SUM(exec_time_ms) >= ' + Number(minCostMs) : ''}
    `;

    const countSql = `
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(total_time_ms), 0) as total_cost_ms,
        COALESCE(SUM(sql_count), 0) as total_sqls,
        COALESCE(MAX(max_time_ms), 0) as max_cost_ms
      FROM (${groupSql}) t
    `;
    const countRes = await this.db.query<any>(countSql, params);
    const total = Number(countRes[0]?.total || 0);

    const offset = (page - 1) * pageSize;
    const listSql = `
      ${groupSql}
      ORDER BY total_time_ms DESC, sql_count DESC
      LIMIT ? OFFSET ?
    `;

    const rows = await this.db.query<any>(listSql, [...params, pageSize, offset]);
    const data: TraceSummaryItem[] = rows.map(r => ({
      trace_id: r.trace_id,
      sql_count: Number(r.sql_count),
      total_time_ms: Math.round(Number(r.total_time_ms)),
      avg_time_ms: Math.round(Number(r.avg_time_ms) * 100) / 100,
      max_time_ms: Math.round(Number(r.max_time_ms)),
      db_manager_count: Number(r.db_manager_count),
      first_time: r.first_time || '',
      last_time: r.last_time || ''
    }));

    return {
      data,
      total,
      totalCostMs: Math.round(Number(countRes[0]?.total_cost_ms || 0)),
      totalSqls: Number(countRes[0]?.total_sqls || 0),
      totalTraces: total,
      maxCostMs: Math.round(Number(countRes[0]?.max_cost_ms || 0))
    };
  }

  public async getTrace(traceId: string, page = 1, pageSize = 50): Promise<{ data: SqlRecord[]; total: number; totalCostMs: number; maxCostMs: number; avgCostMs: number; page: number; pageSize: number }> {
    const countSql = 'SELECT COUNT(*) as total, COALESCE(SUM(exec_time_ms), 0) as total_cost_ms, COALESCE(MAX(exec_time_ms), 0) as max_cost_ms, COALESCE(AVG(exec_time_ms), 0) as avg_cost_ms FROM sqllogs WHERE trace_id = ?';
    const countRes = await this.db.query<any>(countSql, [traceId]);
    const total = Number(countRes[0]?.total || 0);
    const totalCostMs = Math.round(Number(countRes[0]?.total_cost_ms || 0));
    const maxCostMs = Math.round(Number(countRes[0]?.max_cost_ms || 0));
    const avgCostMs = Math.round(Number(countRes[0]?.avg_cost_ms || 0) * 100) / 100;

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT * FROM sqllogs
      WHERE trace_id = ?
      ORDER BY log_time ASC, id ASC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query<any>(listSql, [traceId, pageSize, offset]);
    const data: SqlRecord[] = rows.map(r => ({
      ...r,
      full_sql: compressSqlColumns(r.full_sql || r.sql_template)
    }));

    return {
      data,
      total,
      totalCostMs,
      maxCostMs,
      avgCostMs,
      page,
      pageSize
    };
  }

  public async getByTemplate(sqlTemplate: string, page = 1, pageSize = 50, traceId = '', dbManager = ''): Promise<{ data: SqlRecord[]; total: number; totalCostMs: number; maxCostMs: number; avgCostMs: number; page: number; pageSize: number }> {
    let whereClause = 'WHERE sql_template = ?';
    const params: any[] = [sqlTemplate];
    if (traceId) {
      whereClause += ' AND trace_id = ?';
      params.push(traceId);
    }
    if (dbManager) {
      whereClause += ' AND db_manager = ?';
      params.push(dbManager);
    }

    const countSql = `SELECT COUNT(*) as total, COALESCE(SUM(exec_time_ms), 0) as total_cost_ms, COALESCE(MAX(exec_time_ms), 0) as max_cost_ms, COALESCE(AVG(exec_time_ms), 0) as avg_cost_ms FROM sqllogs ${whereClause}`;
    const countRes = await this.db.query<any>(countSql, params);
    const total = Number(countRes[0]?.total || 0);
    const totalCostMs = Math.round(Number(countRes[0]?.total_cost_ms || 0));
    const maxCostMs = Math.round(Number(countRes[0]?.max_cost_ms || 0));
    const avgCostMs = Math.round(Number(countRes[0]?.avg_cost_ms || 0) * 100) / 100;

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT * FROM sqllogs
      ${whereClause}
      ORDER BY exec_time_ms DESC, log_time ASC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query<any>(listSql, [...params, pageSize, offset]);
    const data: SqlRecord[] = rows.map(r => ({
      ...r,
      full_sql: compressSqlColumns(r.full_sql || r.sql_template)
    }));

    return {
      data,
      total,
      totalCostMs,
      maxCostMs,
      avgCostMs,
      page,
      pageSize
    };
  }
}
