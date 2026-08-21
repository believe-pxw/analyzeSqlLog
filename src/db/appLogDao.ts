import fs from 'fs';
import path from 'path';
import os from 'os';
import { DbConnection } from './connection';
import { AppLogRecord } from '../types/log';
import { LogTraceStub } from '../types/stub';
import { extractLogLines } from '../parser/logExtractor';

export class AppLogDao {
  private stubsMap = new Map<string, LogTraceStub[]>();

  constructor(private db: DbConnection) {}

  /**
   * 注册轻量 Trace 起止行号存根索引
   */
  public registerTraceStubs(stubs: LogTraceStub[]): void {
    if (!stubs || stubs.length === 0) return;
    for (const stub of stubs) {
      if (!stub.trace_id || stub.trace_id === '-') continue;
      const list = this.stubsMap.get(stub.trace_id) || [];
      list.push(stub);
      this.stubsMap.set(stub.trace_id, list);
    }
  }

  /**
   * 获取当前内存中维护的所有 Trace 存根
   */
  public getTraceStubs(): LogTraceStub[] {
    const all: LogTraceStub[] = [];
    for (const list of this.stubsMap.values()) {
      all.push(...list);
    }
    return all;
  }

  /**
   * 按需惰性装载核心：检查 DuckDB 是否已存在该 traceId 的日志，若无则切片读取文件并写入持久化缓存
   */
  public async ensureTraceLogsLoaded(traceId: string): Promise<void> {
    if (!traceId || traceId === '-') return;

    // 1. 检查 DuckDB 中是否已存在
    const checkSql = 'SELECT COUNT(*) as cnt FROM app_logs WHERE trace_id = ?';
    const checkRes = await this.db.query<any>(checkSql, [traceId]);
    if (Number(checkRes[0]?.cnt || 0) > 0) {
      // 已在 DuckDB 缓存中，直接复用
      return;
    }

    // 2. 若不存在，从存根中定位该 Trace 的起止行号与源文件
    const stubs = this.stubsMap.get(traceId);
    if (!stubs || stubs.length === 0) {
      return;
    }

    const allExtractedLogs: AppLogRecord[] = [];
    for (const stub of stubs) {
      const logs = await extractLogLines(stub.source_file, stub.start_line, stub.end_line);
      allExtractedLogs.push(...logs);
    }

    // 3. 批量装载进 DuckDB app_logs 表中
    if (allExtractedLogs.length > 0) {
      await this.insertAppLogsBatch(allExtractedLogs);
    }
  }

  public async insertAppLogsBatch(records: AppLogRecord[]): Promise<void> {
    if (!records || records.length === 0) return;
    return this.db.runSerial(async () => {
      await this._doInsertAppLogsBatch(records);
    });
  }

  private async _doInsertAppLogsBatch(records: AppLogRecord[]): Promise<void> {
    const tmpFile = path.join(os.tmpdir(), `duckdb_app_logs_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    try {
      const jsonLines = records.map(r => JSON.stringify({
        id: r.id || 0,
        log_time: r.log_time || '',
        nano_time: r.nano_time || '',
        level: r.level || 'INFO',
        service_name: r.service_name || '-',
        instance_name: r.instance_name || '-',
        ip_address: r.ip_address || '-',
        host_name: r.host_name || '-',
        trace_id: r.trace_id || '-',
        span_id: r.span_id || '-',
        parent_span_id: r.parent_span_id || '-',
        thread_name: r.thread_name || '-',
        logger_name: r.logger_name || '',
        message: r.message || '',
        stack_trace: r.stack_trace || '',
        has_stack: Boolean(r.stack_trace && r.stack_trace.length > 0),
        line_number: r.line_number || 0,
        source_file: r.source_file || ''
      })).join('\n');

      await fs.promises.writeFile(tmpFile, jsonLines, 'utf-8');
      const normPath = tmpFile.replace(/\\/g, '/');
      const sql = `
        INSERT INTO app_logs (
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          message, stack_trace, has_stack, line_number, source_file
        )
        SELECT 
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          message, stack_trace, has_stack, line_number, source_file
        FROM read_json_auto('${normPath}', format='newline_delimited');
      `;
      await this.db.exec(sql);
    } finally {
      fs.unlink(tmpFile, () => {});
    }
  }

  public async getAppLogs(
    page = 1,
    pageSize = 50,
    filters: { traceId?: string; spanId?: string; level?: string; serviceName?: string; loggerName?: string; keyword?: string } = {}
  ): Promise<{ data: any[]; total: number; spans: { span_id: string; parent_span_id: string; log_count: number }[]; hasPerfTree?: boolean }> {
    // 触发按需惰性装载
    if (filters.traceId) {
      await this.ensureTraceLogsLoaded(filters.traceId);
    }

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];

    if (filters.traceId) {
      whereClause += ' AND trace_id = ?';
      params.push(filters.traceId);
    }
    if (filters.spanId) {
      whereClause += ' AND span_id = ?';
      params.push(filters.spanId);
    }
    if (filters.level && filters.level !== 'SQL') {
      whereClause += ' AND level = ?';
      params.push(filters.level.toUpperCase());
    }
    if (filters.serviceName) {
      whereClause += ' AND service_name = ?';
      params.push(filters.serviceName);
    }
    if (filters.loggerName) {
      whereClause += ' AND logger_name ILIKE ?';
      params.push(`%${filters.loggerName}%`);
    }
    if (filters.keyword) {
      whereClause += ' AND (message ILIKE ? OR logger_name ILIKE ?)';
      params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
    }

    // 1. 查询常规应用日志
    let appLogRows: any[] = [];
    let totalAppLogs = 0;

    if (!filters.level || filters.level !== 'SQL') {
      const countSql = `SELECT COUNT(*) as total FROM app_logs ${whereClause}`;
      const countRes = await this.db.query<any>(countSql, params);
      totalAppLogs = Number(countRes[0]?.total || 0);

      const listSql = `
        SELECT * FROM app_logs
        ${whereClause}
        ORDER BY id ASC, log_time ASC
      `;
      appLogRows = await this.db.query<any>(listSql, params);
    }

    // 2. 如果指定了 TraceID，同时查出该 Trace 下的 SQL 记录进行归并
    let sqlRows: any[] = [];
    if (filters.traceId && (!filters.level || filters.level === 'SQL')) {
      let sqlWhere = 'WHERE trace_id = ?';
      const sqlParams: any[] = [filters.traceId];
      if (filters.keyword) {
        sqlWhere += ' AND (sql_template ILIKE ? OR full_sql ILIKE ?)';
        sqlParams.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
      }
      const rawSqls = await this.db.query<any>(`SELECT * FROM sqllogs ${sqlWhere} ORDER BY log_time ASC, id ASC`, sqlParams);
      sqlRows = rawSqls.map(r => ({
        id: -r.id,
        log_time: r.log_time,
        nano_time: r.nano_time || '',
        level: 'SQL',
        service_name: r.db_manager ? r.db_manager.replace(/^.*dbmanager\./, '') : 'DB',
        instance_name: '-',
        ip_address: '-',
        host_name: '-',
        trace_id: r.trace_id,
        span_id: r.span_id || '-',
        parent_span_id: '-',
        thread_name: r.thread_name || '-',
        logger_name: r.db_manager || 'PreparedStatementWithLog',
        message: r.full_sql || r.sql_template,
        stack_trace: '',
        has_stack: false,
        line_number: r.line_number || 0,
        source_file: r.source_file || '',
        is_sql: true,
        exec_time_ms: r.exec_time_ms,
        result_rows: r.result_rows
      }));
    }

    // 3. 归并两类日志流并按执行时间升序排序
    const allCombined = [...appLogRows, ...sqlRows];
    allCombined.sort((a, b) => {
      const timeComp = (a.log_time || '').localeCompare(b.log_time || '');
      if (timeComp !== 0) return timeComp;
      return (a.id || 0) - (b.id || 0);
    });

    const total = allCombined.length;
    const offset = (page - 1) * pageSize;
    const paginatedData = allCombined.slice(offset, offset + pageSize);

    // 4. 计算 Span 列表
    let spans: any[] = [];
    let hasPerfTree = false;

    if (filters.traceId) {
      const spanSql = `
        SELECT span_id, parent_span_id, COUNT(*) as log_count
        FROM app_logs
        WHERE trace_id = ? AND span_id IS NOT NULL AND span_id != '-'
        GROUP BY span_id, parent_span_id
        ORDER BY MIN(id) ASC
      `;
      spans = await this.db.query<any>(spanSql, [filters.traceId]);

      // 检测该 Trace 是否存在性能树 (ActionRecorder)
      const perfCheck = await this.db.query<any>('SELECT COUNT(*) as cnt FROM perf_traces WHERE trace_id = ?', [filters.traceId]);
      hasPerfTree = Number(perfCheck[0]?.cnt || 0) > 0;
    }

    return {
      data: paginatedData,
      total,
      spans: spans.map(s => ({
        span_id: s.span_id,
        parent_span_id: s.parent_span_id,
        log_count: Number(s.log_count)
      })),
      hasPerfTree
    };
  }

  public async getTraceSpans(traceId: string): Promise<{ span_id: string; parent_span_id: string; log_count: number; error_count: number }[]> {
    if (!traceId || traceId === '-') return [];
    await this.ensureTraceLogsLoaded(traceId);

    const sql = `
      SELECT 
        span_id, 
        parent_span_id, 
        COUNT(*) as log_count,
        SUM(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) as error_count
      FROM app_logs
      WHERE trace_id = ? AND span_id IS NOT NULL AND span_id != '-'
      GROUP BY span_id, parent_span_id
      ORDER BY MIN(id) ASC
    `;
    const rows = await this.db.query<any>(sql, [traceId]);
    return rows.map(r => ({
      span_id: r.span_id,
      parent_span_id: r.parent_span_id,
      log_count: Number(r.log_count),
      error_count: Number(r.error_count || 0)
    }));
  }
}
