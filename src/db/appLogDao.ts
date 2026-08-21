import fs from 'fs';
import path from 'path';
import os from 'os';
import { DbConnection } from './connection';
import { AppLogRecord } from '../types/log';

export class AppLogDao {
  constructor(private db: DbConnection) {}

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
        line_number: r.line_number || 0,
        source_file: r.source_file || ''
      })).join('\n');

      await fs.promises.writeFile(tmpFile, jsonLines, 'utf-8');
      const normPath = tmpFile.replace(/\\/g, '/');
      const sql = `
        INSERT INTO app_logs (
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          message, line_number, source_file
        )
        SELECT 
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          message, line_number, source_file
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
  ): Promise<{ data: AppLogRecord[]; total: number; spans: { span_id: string; parent_span_id: string; log_count: number }[] }> {
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
    if (filters.level) {
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

    const countSql = `SELECT COUNT(*) as total FROM app_logs ${whereClause}`;
    const countRes = await this.db.query<any>(countSql, params);
    const total = Number(countRes[0]?.total || 0);

    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT * FROM app_logs
      ${whereClause}
      ORDER BY id ASC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query<any>(listSql, [...params, pageSize, offset]);

    let spans: any[] = [];
    if (filters.traceId) {
      const spanSql = `
        SELECT span_id, parent_span_id, COUNT(*) as log_count
        FROM app_logs
        WHERE trace_id = ? AND span_id IS NOT NULL AND span_id != '-'
        GROUP BY span_id, parent_span_id
        ORDER BY MIN(id) ASC
      `;
      spans = await this.db.query<any>(spanSql, [filters.traceId]);
    }

    return {
      data: rows,
      total,
      spans: spans.map(s => ({
        span_id: s.span_id,
        parent_span_id: s.parent_span_id,
        log_count: Number(s.log_count)
      }))
    };
  }
}
