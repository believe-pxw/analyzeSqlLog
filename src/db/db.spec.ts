import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlLogDatabase } from './index';
import { parseLogs, parseLogFile } from '../parser';
import path from 'path';
import fs from 'fs';

describe('DuckDB DAO & Business Analytics Specs', () => {
  let db: SqlLogDatabase;

  beforeEach(async () => {
    db = new SqlLogDatabase(':memory:');
    await db.initSchema();
  });

  afterEach(async () => {
    await db.close();
  });

  it('用例 4: DuckDB 内存聚合与后端分页测试', async () => {
    await db.insertBatch([
      { id: 1, log_time: '2026-08-12 10:00:00.000', trace_id: 't-1', thread_name: 'th-1', exec_time_ms: 10, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT * FROM test WHERE id = ?', sql_params: '#0:1', full_sql: 'SELECT * FROM test WHERE id = 1' },
      { id: 2, log_time: '2026-08-12 10:00:01.000', trace_id: 't-1', thread_name: 'th-1', exec_time_ms: 50, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT * FROM test WHERE id = ?', sql_params: '#0:2', full_sql: 'SELECT * FROM test WHERE id = 2' },
      { id: 3, log_time: '2026-08-12 10:00:02.000', trace_id: 't-2', thread_name: 'th-2', exec_time_ms: 100, result_rows: 5, db_manager: 'mysql', sql_template: 'UPDATE test SET name = ?', sql_params: '#0:a', full_sql: 'UPDATE test SET name = a' },
      { id: 4, log_time: '2026-08-12 10:00:03.000', trace_id: '-', thread_name: 'th-3', exec_time_ms: 5, result_rows: 1, db_manager: 'mysql', sql_template: 'update `SYS_Lock` set Slock=1 where UniqueKey=?', sql_params: '#0:a', full_sql: 'update `SYS_Lock` set Slock=1' }
    ]);

    const page1 = await db.getTopRepeated(1, 2, '');
    expect(page1.total).toBe(3);
    expect(page1.data.length).toBe(2);
    expect(page1.data[0].repeat_count).toBe(2);

    const page2 = await db.getTopRepeated(2, 2, '');
    expect(page2.total).toBe(3);
    expect(page2.data.length).toBe(1);

    const slowPage1 = await db.getTopSlow(1, 2, '', 0);
    expect(slowPage1.total).toBe(4);
    expect(slowPage1.data[0].exec_time_ms).toBe(100);
  });

  it('用例 7: 针对 test/fixtures 真实日志文件的 SQL 频次与最大耗时精确核验比对测试', async () => {
    const fixturesDir = path.resolve(__dirname, '../../test/fixtures');
    if (!fs.existsSync(fixturesDir)) return;

    const records: any[] = [];
    await parseLogs(fixturesDir, (r) => records.push(r));
    await db.insertBatch(records);

    const summary = await db.getTotalSummary();
    const topRepeated = await db.getTopRepeated(1, 10, '');
    const topSlow = await db.getTopSlow(1, 10, '', 0);

    expect(Number(summary.totalRecords)).toBe(2749);
    expect(Number(summary.totalTraces)).toBe(205);
    expect(summary.maxTimeMs).toBe(3165);

    expect(topRepeated.data[0].sql_template).toBe('update `SYS_Lock` set Slock=1 where UniqueKey=?');
    expect(Number(topRepeated.data[0].repeat_count)).toBe(540);

    expect(topRepeated.data[1].sql_template).toBe('SELECT Role FROM SYS_OperatorRole Where SOID= ?');
    expect(Number(topRepeated.data[1].repeat_count)).toBe(133);

    expect(topSlow.data[0].exec_time_ms).toBe(3165);
  });

  it('用例 11, 12, 13: Trace 链路数据排序与恢复时间顺序逻辑校验', async () => {
    await db.insertBatch([
      { id: 1, log_time: '2026-08-12 10:00:00.000', trace_id: 't-sort', thread_name: 'th-1', exec_time_ms: 10, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT 1', sql_params: '', full_sql: 'SELECT 1' },
      { id: 2, log_time: '2026-08-12 10:00:01.000', trace_id: 't-sort', thread_name: 'th-1', exec_time_ms: 300, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT 2', sql_params: '', full_sql: 'SELECT 2' },
      { id: 3, log_time: '2026-08-12 10:00:02.000', trace_id: 't-sort', thread_name: 'th-1', exec_time_ms: 50, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT 3', sql_params: '', full_sql: 'SELECT 3' }
    ]);

    const traceRes = await db.getTrace('t-sort', 1, 10);
    expect(traceRes.data.length).toBe(3);
    expect(traceRes.data[0].exec_time_ms).toBe(10);

    const descSorted = [...traceRes.data].sort((a, b) => b.exec_time_ms - a.exec_time_ms);
    expect(descSorted[0].exec_time_ms).toBe(300);
    expect(descSorted[1].exec_time_ms).toBe(50);
    expect(descSorted[2].exec_time_ms).toBe(10);
  });

  it('用例 18: Trace 链路后端大页面分页与单接口向下兼容断言测试', async () => {
    const sampleRecords: any[] = [];
    for (let i = 1; i <= 350; i++) {
      sampleRecords.push({
        id: i,
        log_time: `2026-08-12 10:00:${String(i % 60).padStart(2, '0')}.000`,
        trace_id: 't-page-test',
        thread_name: 'th-1',
        exec_time_ms: i * 2,
        result_rows: 1,
        db_manager: 'mysql',
        sql_template: `SELECT * FROM table_${i}`,
        sql_params: '',
        full_sql: `SELECT * FROM table_${i}`
      });
    }
    await db.insertBatch(sampleRecords);

    const p1 = await db.getTrace('t-page-test', 1, 200);
    expect(p1.total).toBe(350);
    expect(p1.data.length).toBe(200);
    expect(p1.page).toBe(1);

    const p2 = await db.getTrace('t-page-test', 2, 200);
    expect(p2.total).toBe(350);
    expect(p2.data.length).toBe(150);
    expect(p2.page).toBe(2);
  });

  it('用例 21: getDiagnostics 自动过滤 UPDATE 语句断言测试 (只诊断 SELECT 重复)', async () => {
    const testRecords: any[] = [];
    for (let i = 0; i < 6; i++) {
      testRecords.push({
        id: i + 1,
        log_time: '2026-08-12 10:00:00.000',
        trace_id: 't-diag-test',
        thread_name: 'th-1',
        exec_time_ms: 10,
        result_rows: 1,
        db_manager: 'MySqlDBManager@123',
        sql_template: 'SELECT * FROM user_table WHERE id = ?',
        sql_params: '1',
        full_sql: 'SELECT * FROM user_table WHERE id = 1'
      });
    }
    for (let i = 0; i < 10; i++) {
      testRecords.push({
        id: i + 7,
        log_time: '2026-08-12 10:00:00.000',
        trace_id: 't-diag-test',
        thread_name: 'th-1',
        exec_time_ms: 20,
        result_rows: 1,
        db_manager: 'MySqlDBManager@123',
        sql_template: 'UPDATE summary_table SET money = money + ? WHERE group_id = ?',
        sql_params: '100, 1',
        full_sql: 'UPDATE summary_table SET money = money + 100 WHERE group_id = 1'
      });
    }

    await db.insertBatch(testRecords);

    const diagResult = await db.getDiagnostics('t-diag-test', 1, 10, 5);
    expect(diagResult.total).toBe(1);
    expect(diagResult.data.length).toBe(1);
    expect(diagResult.data[0].sql_template).toBe('SELECT * FROM user_table WHERE id = ?');
    expect(Number(diagResult.data[0].repeat_count)).toBe(6);
  });

  it('用例 23: DuckDB 存储和查询 line_number 与 source_file 字段断言', async () => {
    const testRecords: any[] = [];
    for (let i = 1; i <= 5; i++) {
      testRecords.push({
        id: i,
        log_time: `2026-08-12 10:00:0${i}.000`,
        trace_id: i <= 3 ? 'trace-X' : 'trace-Y',
        thread_name: 'thread-1',
        exec_time_ms: i * 10,
        result_rows: i,
        db_manager: 'TestDB',
        sql_template: 'SELECT * FROM test_table WHERE id = ?',
        sql_params: String(i),
        full_sql: `SELECT * FROM test_table WHERE id = ${i}`,
        line_number: i * 100,
        source_file: 'D:/logs/server-info.log'
      });
    }

    await db.insertBatch(testRecords);

    const slowResult = await db.getTopSlow(1, 5, '', 0);
    expect(slowResult.data.length).toBeGreaterThan(0);
    expect(slowResult.data[0].source_file).toBe('D:/logs/server-info.log');
    expect(slowResult.data[0].line_number).toBeGreaterThan(0);

    const traceResult = await db.getTrace('trace-X', 1, 10);
    expect(traceResult.data.length).toBe(3);
    for (const r of traceResult.data) {
      expect(r.source_file).toBe('D:/logs/server-info.log');
      expect(r.line_number).toBeGreaterThan(0);
    }
  });

  it('用例 27: getByTemplate 支持 traceId + dbManager 精准联合过滤及总耗时统计', async () => {
    const records = [
      { log_time: '2026-08-13 10:00:00.000', trace_id: 'Trace_A', db_manager: 'MySqlDBManager@11111111', exec_time_ms: 10, result_rows: 1, sql_template: 'SELECT * FROM users WHERE id = ?', full_sql: 'SELECT * FROM users WHERE id = 1', source_file: 's.log', line_number: 100 },
      { log_time: '2026-08-13 10:00:01.000', trace_id: 'Trace_A', db_manager: 'MySqlDBManager@11111111', exec_time_ms: 20, result_rows: 1, sql_template: 'SELECT * FROM users WHERE id = ?', full_sql: 'SELECT * FROM users WHERE id = 2', source_file: 's.log', line_number: 110 },
      { log_time: '2026-08-13 10:00:02.000', trace_id: 'Trace_A', db_manager: 'MySqlDBManager@22222222', exec_time_ms: 30, result_rows: 1, sql_template: 'SELECT * FROM users WHERE id = ?', full_sql: 'SELECT * FROM users WHERE id = 3', source_file: 's.log', line_number: 120 },
      { log_time: '2026-08-13 10:00:03.000', trace_id: 'Trace_B', db_manager: 'MySqlDBManager@11111111', exec_time_ms: 40, result_rows: 1, sql_template: 'SELECT * FROM users WHERE id = ?', full_sql: 'SELECT * FROM users WHERE id = 4', source_file: 's.log', line_number: 130 }
    ];

    await db.insertBatch(records);

    const allRes = await db.getByTemplate('SELECT * FROM users WHERE id = ?', 1, 50);
    expect(allRes.total).toBe(4);
    expect(allRes.totalCostMs).toBe(100);
    expect(allRes.avgCostMs).toBe(25);

    const filteredRes = await db.getByTemplate('SELECT * FROM users WHERE id = ?', 1, 50, 'Trace_A', 'MySqlDBManager@11111111');
    expect(filteredRes.total).toBe(2);
    expect(filteredRes.data.length).toBe(2);
    expect(filteredRes.totalCostMs).toBe(30);
    expect(filteredRes.avgCostMs).toBe(15);
  });

  it('用例 28: getTraceSummaryList 按 TraceID 聚合分组大盘与多维过滤', async () => {
    const records = [
      { log_time: '2026-08-13 12:00:00.000', trace_id: 'Trace_Alpha', db_manager: 'DBMgr@A1', exec_time_ms: 50, result_rows: 1, sql_template: 'SELECT 1', full_sql: 'SELECT 1', source_file: 'f.log', line_number: 1 },
      { log_time: '2026-08-13 12:00:01.000', trace_id: 'Trace_Alpha', db_manager: 'DBMgr@A1', exec_time_ms: 30, result_rows: 1, sql_template: 'SELECT 2', full_sql: 'SELECT 2', source_file: 'f.log', line_number: 2 },
      { log_time: '2026-08-13 12:00:02.000', trace_id: 'Trace_Alpha', db_manager: 'DBMgr@A2', exec_time_ms: 70, result_rows: 1, sql_template: 'SELECT 3', full_sql: 'SELECT 3', source_file: 'f.log', line_number: 3 },
      { log_time: '2026-08-13 13:00:00.000', trace_id: 'Trace_Beta', db_manager: 'DBMgr@B1', exec_time_ms: 20, result_rows: 1, sql_template: 'SELECT 4', full_sql: 'SELECT 4', source_file: 'f.log', line_number: 4 },
      { log_time: '2026-08-13 14:00:00.000', trace_id: '-', db_manager: 'DBMgr@None', exec_time_ms: 10, result_rows: 1, sql_template: 'SELECT 5', full_sql: 'SELECT 5', source_file: 'f.log', line_number: 5 }
    ];

    await db.insertBatch(records);

    const sumList = await db.getTraceSummaryList(1, 20);
    expect(sumList.total).toBe(2);
    expect(sumList.data.length).toBe(2);

    const alpha = sumList.data[0];
    expect(alpha.trace_id).toBe('Trace_Alpha');
    expect(alpha.sql_count).toBe(3);
    expect(alpha.total_time_ms).toBe(150);
    expect(alpha.avg_time_ms).toBe(50);
    expect(alpha.max_time_ms).toBe(70);
    expect(alpha.db_manager_count).toBe(2);
  });

  it('用例 30: N+1 诊断在过滤 TraceID / 循环次数 / 关键词等条件下的动态上下文统计准确性', async () => {
    const records: any[] = [];
    for (let i = 0; i < 6; i++) {
      records.push({
        log_time: `2026-08-13 10:00:0${i}.000`,
        trace_id: 'Trace_Diag_1',
        db_manager: 'DBMgr@Conn1',
        exec_time_ms: 10,
        result_rows: 1,
        sql_template: 'SELECT * FROM tab_a WHERE id = ?',
        full_sql: `SELECT * FROM tab_a WHERE id = ${i}`,
        source_file: 'a.log',
        line_number: i + 1
      });
    }
    for (let i = 0; i < 8; i++) {
      records.push({
        log_time: `2026-08-13 10:01:0${i}.000`,
        trace_id: 'Trace_Diag_2',
        db_manager: 'DBMgr@Conn2',
        exec_time_ms: 20,
        result_rows: 1,
        sql_template: 'SELECT * FROM tab_b WHERE id = ?',
        full_sql: `SELECT * FROM tab_b WHERE id = ${i}`,
        source_file: 'b.log',
        line_number: i + 1
      });
    }

    await db.insertBatch(records);

    const diagAll = await db.getDiagnostics('', 1, 20, 5, '');
    expect(diagAll.total).toBe(2);
    expect(diagAll.totalSqls).toBe(14);
    expect(diagAll.totalCostMs).toBe(220);
    expect(diagAll.maxCostMs).toBe(20);
    expect(diagAll.totalTraces).toBe(2);

    const diagTrace1 = await db.getDiagnostics('Trace_Diag_1', 1, 20, 5, '');
    expect(diagTrace1.total).toBe(1);
    expect(diagTrace1.totalSqls).toBe(6);
    expect(diagTrace1.totalCostMs).toBe(60);
    expect(diagTrace1.maxCostMs).toBe(10);
    expect(diagTrace1.totalTraces).toBe(1);
  });

  it('用例 33 & 34: 性能树存储、检索与 Top 5 自耗时热点排序断言', async () => {
    const samplePerfLog = path.resolve(__dirname, '../../test/fixtures/perf/sample-perf.log');
    if (!fs.existsSync(samplePerfLog)) return;

    const collectedTraces: any[] = [];
    await parseLogFile(samplePerfLog, () => {}, 0, (perfTrace) => {
      collectedTraces.push(perfTrace);
    });

    await db.insertPerfBatch(collectedTraces);

    const listAll = await db.getPerformanceTraceList(1, 20);
    expect(listAll.total).toBe(1);
    expect(listAll.data[0].trace_id).toBe('43tv9pop1703907v2p9dss1-40');

    const treeData = await db.getPerformanceTree('43tv9pop1703907v2p9dss1-40');
    expect(treeData).not.toBeNull();
    if (treeData) {
      expect(treeData.traceId).toBe('43tv9pop1703907v2p9dss1-40');
      expect(treeData.topSelfHotspots.length).toBe(5);
      expect(treeData.topSelfHotspots[0].self_time_ms).toBeGreaterThanOrEqual(treeData.topSelfHotspots[1].self_time_ms);
    }
  });

  it('用例 42: DuckDB app_logs 批量导入与按 TraceID/SpanID/Level/Keyword 多维过滤检索断言', async () => {
    await db.insertAppLogsBatch([
      { id: 1, log_time: '2026-08-20 09:00:00.000', nano_time: '1000001', level: 'INFO', service_name: 'DevNode', instance_name: 'pod-1:8089', ip_address: '10.0.0.1', host_name: 'host-1', trace_id: 't-target-1', span_id: 's-root', parent_span_id: '-', thread_name: 'th-1', logger_name: 'com.bokesoft.Start', message: '开始处理', line_number: 1, source_file: 'app.log' },
      { id: 2, log_time: '2026-08-20 09:00:01.000', nano_time: '1000002', level: 'ERROR', service_name: 'DevNode', instance_name: 'pod-1:8089', ip_address: '10.0.0.1', host_name: 'host-1', trace_id: 't-target-1', span_id: 's-sub-1', parent_span_id: 's-root', thread_name: 'th-1', logger_name: 'com.bokesoft.Worker', message: '处理过程中发生严重数据库超时异常', line_number: 2, source_file: 'app.log' },
      { id: 3, log_time: '2026-08-20 09:00:02.000', nano_time: '1000003', level: 'INFO', service_name: 'DevNode', instance_name: 'pod-2:8089', ip_address: '10.0.0.2', host_name: 'host-2', trace_id: 't-other', span_id: 's-other', parent_span_id: '-', thread_name: 'th-2', logger_name: 'com.bokesoft.Heartbeat', message: '心跳正常', line_number: 10, source_file: 'app.log' }
    ]);

    const traceLogs = await db.getAppLogs(1, 50, { traceId: 't-target-1' });
    expect(traceLogs.total).toBe(2);
    expect(traceLogs.data.length).toBe(2);

    const spanLogs = await db.getAppLogs(1, 50, { spanId: 's-sub-1' });
    expect(spanLogs.total).toBe(1);
    expect(spanLogs.data[0].level).toBe('ERROR');

    const errorLogs = await db.getAppLogs(1, 50, { level: 'ERROR' });
    expect(errorLogs.total).toBe(1);

    const kwLogs = await db.getAppLogs(1, 50, { keyword: '超时异常' });
    expect(kwLogs.total).toBe(1);
  });
});
