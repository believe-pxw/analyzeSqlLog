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
});
