import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import http from 'http';
import fs from 'fs';
import zlib from 'zlib';
import { SqlLogDatabase } from '../../src/db';
import { parseLogs, parseLogFile } from '../../src/parser';
import { createServer } from '../../src/server';

describe('End-to-End Full Flow Integration Specs', () => {
  const fixturesDir = path.resolve(__dirname, '../../test/fixtures');
  let db: SqlLogDatabase;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    let batch: any[] = [];
    let perfBatch: any[] = [];
    let appLogBatch: any[] = [];

    // 高效批量缓冲装载
    const parseResult = await parseLogs(
      fixturesDir,
      record => {
        batch.push(record);
        if (batch.length >= 5000) {
          const toInsert = batch;
          batch = [];
          return db.insertBatch(toInsert);
        }
      },
      perfData => {
        perfBatch.push(perfData);
        if (perfBatch.length >= 50) {
          const toInsert = perfBatch;
          perfBatch = [];
          return db.insertPerfBatch(toInsert);
        }
      },
      appLog => {
        appLogBatch.push(appLog);
        if (appLogBatch.length >= 5000) {
          const toInsert = appLogBatch;
          appLogBatch = [];
          return db.insertAppLogsBatch(toInsert);
        }
      }
    );

    if (batch.length > 0) await db.insertBatch(batch);
    if (perfBatch.length > 0) await db.insertPerfBatch(perfBatch);
    if (appLogBatch.length > 0) await db.insertAppLogsBatch(appLogBatch);

    port = 30000 + Math.floor(Math.random() * 10000);
    server = createServer(db, parseResult, port);
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    if (db) {
      await db.close();
    }
  });

  function fetchApi(endpoint: string): Promise<any> {
    return new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}${endpoint}`, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(data);
          }
        });
      }).on('error', reject);
    });
  }

  it('用例 5 & 6: parseLogs 自动扫描指定目录并仅读取 server-info / server-error 文件', async () => {
    const tempDir = path.join(__dirname, 'test_logs_filter_dir');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const f1 = path.join(tempDir, 'DevNode-server-info.log');
    const f2 = path.join(tempDir, 'DevNode-server-error.log');
    const f3 = path.join(tempDir, 'other-file.txt');

    fs.writeFileSync(f1, '2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-1] [] [] [w-1] com.bokesoft.Test\n>SQL执行信息:影响行数:[1 rows] 执行时间:[1ms]\n>SQL语句:[select 1]', 'utf-8');
    fs.writeFileSync(f2, '2026-08-12 10:00:01.000 ERROR [DevNode] [] [] [] [t-2] [] [] [w-1] com.bokesoft.Test\n>SQL执行信息:影响行数:[1 rows] 执行时间:[2ms]\n>SQL语句:[select 2]', 'utf-8');
    fs.writeFileSync(f3, 'ignored text', 'utf-8');

    const res = await parseLogs(tempDir, () => {});
    expect(res.totalFiles).toBe(2);

    fs.unlinkSync(f1);
    fs.unlinkSync(f2);
    fs.unlinkSync(f3);
    fs.rmdirSync(tempDir);
  });

  it('用例 14: parseLogs 递归深度扫描多层级子目录日志文件', async () => {
    const tempDir = path.join(__dirname, 'test_recursive_dir');
    const subDir = path.join(tempDir, '2026-08');
    fs.mkdirSync(subDir, { recursive: true });

    const f1 = path.join(tempDir, 'root-server-info.log');
    const f2 = path.join(subDir, 'sub-server-error.log');

    fs.writeFileSync(f1, '2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-r1] [] [] [w-1] com.bokesoft.Test\n>SQL执行信息:影响行数:[1 rows] 执行时间:[1ms]\n>SQL语句:[select 100]', 'utf-8');
    fs.writeFileSync(f2, '2026-08-12 10:00:01.000 ERROR [DevNode] [] [] [] [t-r2] [] [] [w-1] com.bokesoft.Test\n>SQL执行信息:影响行数:[1 rows] 执行时间:[2ms]\n>SQL语句:[select 200]', 'utf-8');

    const records: any[] = [];
    const res = await parseLogs(tempDir, r => records.push(r));

    expect(res.totalFiles).toBe(2);
    expect(records.length).toBe(2);

    fs.unlinkSync(f1);
    fs.unlinkSync(f2);
    fs.rmdirSync(subDir);
    fs.rmdirSync(tempDir);
  });

  it('用例 15: onRecord 异步背压回调等待机制断言测试', async () => {
    const tempFile = path.join(__dirname, 'test_backpressure.log');
    fs.writeFileSync(tempFile, `2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-bp1] [] [] [w-1] com.bokesoft.Test\n>SQL执行信息:影响行数:[1 rows] 执行时间:[1ms]\n>SQL语句:[select 1]\n2026-08-12 10:00:01.000 INFO [DevNode] [] [] [] [t-bp2] [] [] [w-1] com.bokesoft.Test\n>SQL执行信息:影响行数:[1 rows] 执行时间:[2ms]\n>SQL语句:[select 2]`, 'utf-8');

    let isProcessing = false;
    let maxConcurrent = 0;

    await parseLogFile(tempFile, async () => {
      if (isProcessing) maxConcurrent++;
      isProcessing = true;
      await new Promise(r => setTimeout(r, 5));
      isProcessing = false;
    });

    fs.unlinkSync(tempFile);
    expect(maxConcurrent).toBe(0);
  });

  it('用例 20: parseLogs 与 parseLogFile 兼容支持 .gz 压缩日志解压与 SQL 提取', async () => {
    const tempDir = path.join(__dirname, 'test_gz_dir');
    fs.mkdirSync(tempDir, { recursive: true });

    const gzFile = path.join(tempDir, 'DevNode-server-info-01.log.gz');
    const logContent = '2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-gz-1] [] [] [w-1] com.bokesoft.Test\n>SQL执行信息:影响行数:[3 rows] 执行时间:[15ms]\n>SQL语句:[select * from gz_table]';

    const buffer = zlib.gzipSync(Buffer.from(logContent, 'utf-8'));
    fs.writeFileSync(gzFile, buffer);

    const records: any[] = [];
    const res = await parseLogs(tempDir, r => records.push(r));

    expect(res.totalFiles).toBe(1);
    expect(records.length).toBe(1);
    expect(records[0].trace_id).toBe('t-gz-1');
    expect(records[0].exec_time_ms).toBe(15);
    expect(records[0].sql_template).toBe('select * from gz_table');

    fs.unlinkSync(gzFile);
    fs.rmdirSync(tempDir);
  });

  it('用例 41: parseLogFile 配合 onAppLog 流式解析全量应用日志与多行堆栈断言', async () => {
    const sampleLogs = [
      '2026-08-20 09:59:15.894 8722201732575698 INFO [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-app-1] [span-1] [-] [http-1] com.bokesoft.service.AuthService 用户登录成功 user=admin',
      '2026-08-20 09:59:16.100 8722201732579999 ERROR [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-app-1] [span-2] [span-1] [http-1] com.bokesoft.service.OrderService 处理订单发生异常 orderId=1001',
      '>java.lang.NullPointerException: Order item cannot be null',
      '>\tat com.bokesoft.service.OrderService.process(OrderService.java:45)',
      '2026-08-20 09:59:17.000 8722201732588888 INFO [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-app-2] [span-3] [-] [http-2] com.bokesoft.service.DictService 加载字典完成'
    ].join('\n');

    const tempFile = path.join(__dirname, 'test_app_logs_temp.log');
    fs.writeFileSync(tempFile, sampleLogs, 'utf-8');

    const appLogs: any[] = [];
    const parseResult = await parseLogFile(tempFile, () => {}, 0, null, log => {
      appLogs.push(log);
    });

    fs.unlinkSync(tempFile);

    expect(parseResult.totalAppLogs).toBe(3);
    expect(appLogs.length).toBe(3);
    expect(appLogs[0].message).toBe('用户登录成功 user=admin');
    expect(appLogs[1].message).toContain('NullPointerException');
    expect(appLogs[1].message).toContain('OrderService.java:45');
  });

  it('用例 19 & 35 & 44: createServer HTTP 服务各 Tab API 路由响应断言', async () => {
    // 1. GET /api/summary
    const resSummary = await fetchApi('/api/summary');
    expect(resSummary.success).toBe(true);
    expect(resSummary.data.totalRecords).toBeGreaterThan(0);
    expect(resSummary.data.totalTraces).toBeGreaterThan(0);

    // 2. GET /api/perf-trace-list & /api/perf-tree
    const listRes = await fetchApi('/api/perf-trace-list?page=1&pageSize=10');
    expect(listRes.success).toBe(true);
    expect(listRes.data.length).toBeGreaterThan(0);

    const firstTraceId = listRes.data[0].trace_id;
    const treeRes = await fetchApi(`/api/perf-tree?traceId=${encodeURIComponent(firstTraceId)}`);
    expect(treeRes.success).toBe(true);
    expect(treeRes.data.traceId).toBe(firstTraceId);
    expect(treeRes.data.rootNode).not.toBeNull();

    // 3. GET /api/app-logs
    const appLogsRes = await fetchApi('/api/app-logs?page=1&pageSize=10');
    expect(appLogsRes.success).toBe(true);
    expect(appLogsRes.data.length).toBeGreaterThan(0);

    // 4. GET /api/top-repeated & /api/top-slow
    const repRes = await fetchApi('/api/top-repeated?page=1&pageSize=5');
    expect(repRes.success).toBe(true);
    expect(repRes.data.length).toBeGreaterThan(0);

    const slowRes = await fetchApi('/api/top-slow?page=1&pageSize=5');
    expect(slowRes.success).toBe(true);
    expect(slowRes.data.length).toBeGreaterThan(0);

    // 5. GET /api/diagnostics
    const diagRes = await fetchApi('/api/diagnostics?minRepeatCount=1');
    expect(diagRes.success).toBe(true);

    // 6. GET /api/trace-summary-list
    const traceSumRes = await fetchApi('/api/trace-summary-list?page=1&pageSize=5');
    expect(traceSumRes.success).toBe(true);
    expect(traceSumRes.data.length).toBeGreaterThan(0);

    // 7. GET /api/by-template
    const tpl = repRes.data[0].sql_template;
    const byTplRes = await fetchApi(`/api/by-template?sqlTemplate=${encodeURIComponent(tpl)}&page=1&pageSize=5`);
    expect(byTplRes.success).toBe(true);
    expect(byTplRes.data.length).toBeGreaterThan(0);

    // 8. GET /api/decompress-gz
    const sampleLog = path.join(fixturesDir, 'DevNode-server-info-sample.log');
    const gzRes = await fetchApi(`/api/decompress-gz?filePath=${encodeURIComponent(sampleLog)}`);
    expect(gzRes.success).toBe(true);
  });

  it('用例 45: GET / 应当正确返回 Vue 3 静态编译后的 SPA 单页应用', async () => {
    const html: string = await new Promise((resolve, reject) => {
      http.get(`http://localhost:${port}/`, res => {
        let data = '';
        res.on('data', chunk => (data += chunk));
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<div id="app"></div>');
  });
});
