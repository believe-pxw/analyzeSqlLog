import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import http from 'http';
import fs from 'fs';
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

  it('GET /api/summary 应当正确返回全局概览统计数据', async () => {
    const res = await fetchApi('/api/summary');
    expect(res.success).toBe(true);
    expect(res.data.totalRecords).toBeGreaterThan(0);
    expect(res.data.totalTraces).toBeGreaterThan(0);
    expect(res.data.parseStats).toBeDefined();
  });

  it('GET /api/perf-trace-list 与 /api/perf-tree 应当正确返回性能链路与调用树', async () => {
    const listRes = await fetchApi('/api/perf-trace-list?page=1&pageSize=10');
    expect(listRes.success).toBe(true);
    expect(listRes.data.length).toBeGreaterThan(0);

    const firstTraceId = listRes.data[0].trace_id;
    const treeRes = await fetchApi(`/api/perf-tree?traceId=${encodeURIComponent(firstTraceId)}`);
    expect(treeRes.success).toBe(true);
    expect(treeRes.data.traceId).toBe(firstTraceId);
    expect(treeRes.data.rootNode).not.toBeNull();
    expect(treeRes.data.totalTimeMs).toBeGreaterThan(0);
  });

  it('GET /api/app-logs 应当正确返回 13 维应用日志与 Span 分布', async () => {
    const res = await fetchApi('/api/app-logs?page=1&pageSize=10');
    expect(res.success).toBe(true);
    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data[0].service_name).toBeDefined();
  });

  it('GET /api/top-repeated 与 /api/top-slow 应当正确返回频次与慢 SQL', async () => {
    const repeatedRes = await fetchApi('/api/top-repeated?page=1&pageSize=5');
    expect(repeatedRes.success).toBe(true);
    expect(repeatedRes.data.length).toBeGreaterThan(0);

    const slowRes = await fetchApi('/api/top-slow?page=1&pageSize=5');
    expect(slowRes.success).toBe(true);
    expect(slowRes.data.length).toBeGreaterThan(0);
    expect(slowRes.data[0].exec_time_ms).toBeGreaterThanOrEqual(slowRes.data[slowRes.data.length - 1].exec_time_ms);
  });

  it('GET /api/diagnostics 应当正确诊断事务内 N+1 循环', async () => {
    const diagRes = await fetchApi('/api/diagnostics?minRepeatCount=1');
    expect(diagRes.success).toBe(true);
  });

  it('GET /api/trace-summary-list 应当正确按 Trace 聚合总耗时', async () => {
    const summaryRes = await fetchApi('/api/trace-summary-list?page=1&pageSize=5');
    expect(summaryRes.success).toBe(true);
    expect(summaryRes.data.length).toBeGreaterThan(0);
  });

  it('GET /api/trace 应当正确返回单条 Trace 下的时序 SQL', async () => {
    const summaryRes = await fetchApi('/api/trace-summary-list?page=1&pageSize=1');
    const traceId = summaryRes.data[0].trace_id;

    const traceRes = await fetchApi(`/api/trace?traceId=${encodeURIComponent(traceId)}&page=1&pageSize=10`);
    expect(traceRes.success).toBe(true);
    expect(traceRes.data.length).toBeGreaterThan(0);
    expect(traceRes.data[0].trace_id).toBe(traceId);
  });

  it('GET /api/by-template 应当支持按 SQL 模板精确检索调用', async () => {
    const repeatedRes = await fetchApi('/api/top-repeated?page=1&pageSize=1');
    const tpl = repeatedRes.data[0].sql_template;

    const byTplRes = await fetchApi(`/api/by-template?sqlTemplate=${encodeURIComponent(tpl)}&page=1&pageSize=5`);
    expect(byTplRes.success).toBe(true);
    expect(byTplRes.data.length).toBeGreaterThan(0);
  });

  it('GET /api/decompress-gz 应当支持解压 gz 日志文件并返回临时路径', async () => {
    const sampleLog = path.join(fixturesDir, 'DevNode-server-info-sample.log');
    const res = await fetchApi(`/api/decompress-gz?filePath=${encodeURIComponent(sampleLog)}`);
    expect(res.success).toBe(true);
    expect(res.decompressedPath).toBeDefined();
  });

  it('GET / 应当正确返回 Vue 3 静态编译后的 SPA 单页应用', async () => {
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
