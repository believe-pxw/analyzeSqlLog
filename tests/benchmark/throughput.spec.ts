import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlLogDatabase } from '../../src/db';
import { parseLogFile } from '../../src/parser';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Performance Benchmark Specs', () => {
  let db: SqlLogDatabase;

  beforeEach(async () => {
    db = new SqlLogDatabase(':memory:');
    await db.initSchema();
  });

  afterEach(async () => {
    await db.close();
  });

  it('🚀 性能基准测试 1：10 万条结构化 SQL 记录 DuckDB Multi-row Chunk 内存装载吞吐率', async () => {
    const TOTAL_RECORDS = 100000;
    const records: any[] = [];

    for (let i = 0; i < TOTAL_RECORDS; i++) {
      records.push({
        id: i + 1,
        log_time: '2026-08-20 10:00:00.000',
        nano_time: '8722201732575698',
        level: 'INFO',
        service_name: 'DevNode',
        instance_name: 'inst-1',
        ip_address: '10.233.107.109',
        host_name: 'host-1',
        trace_id: `trace_${i % 1000}`,
        span_id: `span_${i}`,
        parent_span_id: 'span_0',
        thread_name: `Thread-${i % 16}`,
        logger_name: 'com.boke.service.UserService',
        exec_time_ms: Math.floor(Math.random() * 500),
        result_rows: 1,
        db_manager: `conn_${i % 50}`,
        sql_template: `SELECT * FROM table_${i % 200} WHERE id = ?`,
        sql_params: '123',
        full_sql: `SELECT * FROM table_${i % 200} WHERE id = 123`,
        line_number: i + 1,
        source_file: 'app.log',
      });
    }

    const t0 = Date.now();
    await db.insertBatch(records);
    const costMs = Date.now() - t0;

    console.log(`\n    ⚡ 10 万条结构化 SQL 记录 DuckDB 内存装载耗时: ${costMs} ms (吞吐率: ~${Math.round(TOTAL_RECORDS / (costMs / 1000)).toLocaleString()} 条/秒)`);
    expect(costMs).toBeLessThan(3000);
  });

  it('🚀 性能基准测试 2：10 万条在库 SQL 的 DuckDB GROUP BY 高维内存聚合与 Top-N 查询耗时', async () => {
    const records: any[] = [];
    for (let i = 0; i < 50000; i++) {
      records.push({
        id: i + 1,
        log_time: '2026-08-20 10:00:00.000',
        trace_id: `trace_${i % 500}`,
        span_id: `span_${i}`,
        thread_name: 'Thread-1',
        exec_time_ms: Math.floor(Math.random() * 500),
        db_manager: `conn_${i % 20}`,
        sql_template: `SELECT * FROM orders WHERE user_id = ? AND status = ${i % 3}`,
        full_sql: `SELECT * FROM orders WHERE user_id = 123 AND status = ${i % 3}`,
        source_file: 'app.log',
        line_number: i + 1,
      });
    }
    await db.insertBatch(records);

    const t0 = Date.now();
    const repeated = await db.getTopRepeated(1, 20);
    const slow = await db.getTopSlow(1, 20);
    const diag = await db.getDiagnostics('', 1, 20, 5);
    const costMs = Date.now() - t0;

    console.log(`    ⚡ 5 万条记录 3 组复杂高维 GROUP BY / ORDER BY 聚合总耗时: ${costMs} ms`);
    expect(costMs).toBeLessThan(1000);
    expect(repeated.data.length).toBeGreaterThan(0);
    expect(slow.data.length).toBeGreaterThan(0);
    expect(diag.data.length).toBeGreaterThan(0);
  });
});
