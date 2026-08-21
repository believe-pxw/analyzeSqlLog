import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { SqlLogDatabase } from '../../src/db';
import { parseLogs } from '../../src/parser';

describe('Range Stub & Lazy On-Demand Loading Specs (起止行存根与按需切片装载)', () => {
  let db: SqlLogDatabase;
  const tempDir = path.join(__dirname, 'test_stub_lazy_dir');

  const sampleLogs = [
    '2026-08-20 09:59:15.894 8722201732575698 INFO [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-lazy-1] [span-1] [-] [http-1] com.bokesoft.service.AuthService 用户登录',
    '2026-08-20 09:59:16.100 8722201732579999 ERROR [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-lazy-1] [span-2] [span-1] [http-1] com.bokesoft.service.OrderService 处理发生严重异常',
    '>java.lang.NullPointerException: Order item cannot be null',
    '>\tat com.bokesoft.service.OrderService.process(OrderService.java:45)',
    '2026-08-20 09:59:17.000 8722201732588888 INFO [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-lazy-2] [span-3] [-] [http-2] com.bokesoft.service.DictService 加载字典完成'
  ].join('\n');

  beforeEach(async () => {
    db = new SqlLogDatabase(':memory:');
    await db.initSchema();
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await db.close();
    try {
      const files = fs.readdirSync(tempDir);
      for (const f of files) fs.unlinkSync(path.join(tempDir, f));
      fs.rmdirSync(tempDir);
    } catch (e) {}
  });

  it('1. 启动时仅收集起止行存根，DuckDB 初始为空；首次查询按需装载并写入缓存；二次查询直接命中缓存', async () => {
    const logFile = path.join(tempDir, 'server-info.log');
    fs.writeFileSync(logFile, sampleLogs, 'utf-8');

    // 启动解析（不传 onAppLog 回调）
    const parseResult = await parseLogs(tempDir);
    expect(parseResult.traceStubs).toBeDefined();
    expect(parseResult.traceStubs!.length).toBe(2);

    const stub1 = parseResult.traceStubs!.find(s => s.trace_id === 'trace-lazy-1');
    expect(stub1).toBeDefined();
    expect(stub1!.start_line).toBe(1);
    expect(stub1!.end_line).toBe(2);
    expect(stub1!.spans['span-1']).toBeDefined();
    expect(stub1!.spans['span-2']).toBeDefined();

    // 注册存根到数据库
    db.registerTraceStubs(parseResult.traceStubs!);

    // 断言此时 DuckDB 中还没有任何 app_logs 记录
    const initialCheck = await db.query<any>('SELECT COUNT(*) as total FROM app_logs');
    expect(Number(initialCheck[0].total)).toBe(0);

    // 首次查询 trace-lazy-1：触发自动按需切片加载并入库缓存
    const res1 = await db.getAppLogs(1, 10, { traceId: 'trace-lazy-1' });
    expect(res1.total).toBe(2);
    expect(res1.data.length).toBe(2);
    expect(res1.data[0].trace_id).toBe('trace-lazy-1');
    expect(res1.data[0].message).toBe('用户登录');
    expect(res1.data[1].level).toBe('ERROR');
    expect(res1.data[1].stack_trace).toContain('NullPointerException');

    // 断言此时 DuckDB 中已持久化缓存了 trace-lazy-1 的 2 条记录
    const cachedCheck = await db.query<any>('SELECT COUNT(*) as total FROM app_logs WHERE trace_id = ?', ['trace-lazy-1']);
    expect(Number(cachedCheck[0].total)).toBe(2);

    // 二次查询 trace-lazy-1：直接走 DuckDB 缓存
    const res2 = await db.getAppLogs(1, 10, { traceId: 'trace-lazy-1' });
    expect(res2.total).toBe(2);

    // 获取 Trace Spans 统计
    const spansRes = await db.getTraceSpans('trace-lazy-1');
    expect(spansRes.length).toBe(2);
    const errSpan = spansRes.find(s => s.span_id === 'span-2');
    expect(errSpan).toBeDefined();
    expect(errSpan!.error_count).toBe(1);
  });

  it('2. 真实日志切片提取时，SQL 日志保持单条 INFO 记录，消息正文直接提取完整 SQL，无假堆栈', async () => {
    const rawSqlLogs = [
      '2026-08-20 10:00:00.100 8722201732575698 INFO [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-combo-1] [span-1] [-] [http-1] com.bokesoft.Auth 用户发起查询请求',
      '2026-08-20 10:00:00.200 8722201732575699 INFO [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-combo-1] [span-1] [-] [http-1] com.bokesoft.yes.mid.connection.dbmanager.GeneralDBManager SQL执行信息:',
      '> 耗时: 15 ms',
      '> SQL语句: select * from sys_user where id = 1',
      '> 参数: #0:1',
      '2026-08-20 10:00:00.300 8722201732575700 INFO [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-combo-1] [span-1] [-] [http-1] com.bokesoft.Auth 用户查询请求完成'
    ].join('\n');

    const logFile = path.join(tempDir, 'combo-server-info.log');
    fs.writeFileSync(logFile, rawSqlLogs, 'utf-8');

    // 扫描存根并注册
    const parseResult = await parseLogs(tempDir);
    db.registerTraceStubs(parseResult.traceStubs!);

    // 查询该 TraceID 的纯净日志流
    const res = await db.getAppLogs(1, 10, { traceId: 'trace-combo-1' });
    expect(res.total).toBe(3);
    expect(res.data.length).toBe(3);

    // 第 1 条是普通 INFO 日志
    expect(res.data[0].level).toBe('INFO');
    expect(res.data[0].message).toBe('用户发起查询请求');
    expect(res.data[0].has_stack).toBeFalsy();

    // 第 2 条是 SQL 执行日志：保持原本真实的 INFO 级别，正文直接为 SQL 语句，无假堆栈
    expect(res.data[1].level).toBe('INFO');
    expect(res.data[1].is_sql).toBe(true);
    expect(res.data[1].message).toBe('select * from sys_user where id = 1');
    expect(res.data[1].exec_time_ms).toBe(15);
    expect(res.data[1].has_stack).toBeFalsy();
    expect(res.data[1].stack_trace).toBeFalsy();

    // 第 3 条是后续 INFO 日志
    expect(res.data[2].level).toBe('INFO');
    expect(res.data[2].message).toBe('用户查询请求完成');
    expect(res.data[2].has_stack).toBeFalsy();
  });
});
