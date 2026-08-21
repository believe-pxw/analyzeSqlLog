import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlLogDatabase } from './index';

describe('DuckDB Database Layer Specs', () => {
  let db: SqlLogDatabase;

  beforeEach(async () => {
    db = new SqlLogDatabase(':memory:');
    await db.initSchema();
  });

  afterEach(async () => {
    await db.close();
  });

  it('应当正确插入 SQL 记录并支持频次榜与慢 SQL 查询', async () => {
    await db.insertBatch([
      {
        id: 1,
        log_time: '2026-08-20 10:00:00.000',
        trace_id: 'trace-1',
        span_id: 'span-1',
        thread_name: 'T-1',
        exec_time_ms: 120,
        time_cost_level: 'HIGH',
        db_manager: 'conn-1',
        table_names: 'orders',
        sql_template: 'SELECT * FROM orders WHERE id = ?',
        params: '1',
        full_sql: 'SELECT * FROM orders WHERE id = 1',
        source_file: 'app.log',
        line_number: 10,
      },
      {
        id: 2,
        log_time: '2026-08-20 10:00:01.000',
        trace_id: 'trace-1',
        span_id: 'span-2',
        thread_name: 'T-1',
        exec_time_ms: 300,
        time_cost_level: 'HIGH',
        db_manager: 'conn-1',
        table_names: 'orders',
        sql_template: 'SELECT * FROM orders WHERE id = ?',
        params: '2',
        full_sql: 'SELECT * FROM orders WHERE id = 2',
        source_file: 'app.log',
        line_number: 20,
      },
    ]);

    const summary = await db.getTotalSummary();
    expect(summary.totalRecords).toBe(2);
    expect(summary.totalTimeMs).toBe(420);
    expect(summary.maxTimeMs).toBe(300);

    const repeated = await db.getTopRepeated(1, 10);
    expect(repeated.total).toBe(1);
    expect(repeated.data[0].repeat_count).toBe(2);
    expect(repeated.data[0].total_time_ms).toBe(420);

    const slow = await db.getTopSlow(1, 10);
    expect(slow.total).toBe(2);
    expect(slow.data[0].exec_time_ms).toBe(300);
  });

  it('应当正确插入与组装性能树数据', async () => {
    await db.insertPerfBatch([
      {
        trace: {
          trace_id: 'perf-trace-1',
          log_time: '2026-08-20 10:00:00.000',
          thread_name: 'T-1',
          root_action: 'MidVEFilter.doFilter',
          service_name: 'OrderService',
          total_time_ms: 100,
          self_time_ms: 10,
          gap_time_ms: 0,
          biz_time_ms: 70,
          sql_time_ms: 20,
          commit_time_ms: 10,
          action_count: 2,
          sql_count: 1,
          max_depth: 1,
          source_file: 'perf.log',
          line_number: 1,
        },
        actions: [
          {
            node_id: 0,
            parent_id: -1,
            level: 0,
            action_name: 'MidVEFilter.doFilter',
            time_ms: 100,
            self_time_ms: 10,
            gap_time_ms: 0,
            action_category: 'biz',
            sql_text: '',
            line_number: 1,
            source_file: 'perf.log',
          },
          {
            node_id: 1,
            parent_id: 0,
            level: 1,
            action_name: 'OrderService',
            time_ms: 90,
            self_time_ms: 70,
            gap_time_ms: 0,
            action_category: 'biz',
            sql_text: '',
            line_number: 2,
            source_file: 'perf.log',
          },
        ],
      },
    ]);

    const list = await db.getPerformanceTraceList(1, 10);
    expect(list.total).toBe(1);
    expect(list.data[0].trace_id).toBe('perf-trace-1');

    const tree = await db.getPerformanceTree('perf-trace-1');
    expect(tree).not.toBeNull();
    expect(tree?.rootNode?.name).toBe('MidVEFilter.doFilter');
    expect(tree?.rootNode?.children.length).toBe(1);
    expect(tree?.rootNode?.children[0].name).toBe('OrderService');
  });
});
