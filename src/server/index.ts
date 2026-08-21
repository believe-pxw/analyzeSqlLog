import http from 'http';
import url from 'url';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import os from 'os';
import { exec } from 'child_process';
import { SqlLogDatabase } from '../db';
import { serveStatic } from './static';
import { ParseResult } from '../parser';

export function createServer(db: SqlLogDatabase, parseStats: ParseResult, port = 3000): http.Server {
  let staticDir = path.resolve(process.cwd(), 'dist/web');
  if (!fs.existsSync(staticDir)) {
    staticDir = path.resolve(__dirname, '../../dist/web');
  }
  if (!fs.existsSync(staticDir)) {
    staticDir = path.resolve(__dirname, '../dist/web');
  }

  const server = http.createServer(async (req, res) => {
    // 统一跨域与 UTF-8
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams.entries());

    function jsonResponse(data: any, status = 200) {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data));
    }

    try {
      if (pathname === '/api/summary') {
        const summary = await db.getTotalSummary();
        summary.parseStats = parseStats;
        jsonResponse({ success: true, data: summary });
        return;
      }

      if (pathname === '/api/perf-trace-list') {
        const page = parseInt(query.page || '1', 10);
        const pageSize = parseInt(query.pageSize || '20', 10);
        const keyword = query.keyword || '';
        const minCostMs = parseFloat(query.minCostMs || '0');
        const service = query.service || '';

        const result = await db.getPerformanceTraceList(page, pageSize, keyword, minCostMs, service);
        jsonResponse({ success: true, ...result });
        return;
      }

      if (pathname === '/api/perf-tree') {
        const traceId = query.traceId || '';
        const result = await db.getPerformanceTree(traceId);
        jsonResponse({ success: true, data: result });
        return;
      }

      if (pathname === '/api/app-logs') {
        const page = parseInt(query.page || '1', 10);
        const pageSize = parseInt(query.pageSize || '50', 10);
        const traceId = query.traceId || '';
        const spanId = query.spanId || '';
        const level = query.level || '';
        const serviceName = query.serviceName || '';
        const loggerName = query.loggerName || '';
        const keyword = query.keyword || '';

        const result = await db.getAppLogs(page, pageSize, {
          traceId,
          spanId,
          level,
          serviceName,
          loggerName,
          keyword,
        });
        jsonResponse({ success: true, ...result });
        return;
      }

      if (pathname === '/api/trace-summary-list') {
        const page = parseInt(query.page || '1', 10);
        const pageSize = parseInt(query.pageSize || '20', 10);
        const keyword = query.keyword || '';
        const minCostMs = parseFloat(query.minCostMs || '0');

        const result = await db.getTraceSummaryList(page, pageSize, keyword, minCostMs);
        jsonResponse({ success: true, ...result });
        return;
      }

      if (pathname === '/api/diagnostics') {
        const traceId = query.traceId || '';
        const page = parseInt(query.page || '1', 10);
        const pageSize = parseInt(query.pageSize || '20', 10);
        const minRepeat = parseInt(query.minRepeatCount || '5', 10);
        const keyword = query.keyword || '';

        const result = await db.getDiagnostics(traceId, page, pageSize, minRepeat, keyword);
        jsonResponse({ success: true, ...result });
        return;
      }

      if (pathname === '/api/top-repeated') {
        const page = parseInt(query.page || '1', 10);
        const pageSize = parseInt(query.pageSize || '20', 10);
        const keyword = query.keyword || '';

        const result = await db.getTopRepeated(page, pageSize, keyword);
        jsonResponse({ success: true, ...result });
        return;
      }

      if (pathname === '/api/top-slow') {
        const page = parseInt(query.page || '1', 10);
        const pageSize = parseInt(query.pageSize || '20', 10);
        const traceId = query.traceId || '';
        const minCostMs = parseFloat(query.minCostMs || '0');
        const keyword = query.keyword || '';

        const result = await db.getTopSlow(page, pageSize, traceId, minCostMs, keyword);
        jsonResponse({ success: true, ...result });
        return;
      }

      if (pathname === '/api/trace') {
        const traceId = query.traceId || '';
        const page = parseInt(query.page || '1', 10);
        const pageSize = parseInt(query.pageSize || '50', 10);

        const result = await db.getTrace(traceId, page, pageSize);
        jsonResponse({ success: true, ...result });
        return;
      }

      if (pathname === '/api/by-template') {
        const sqlTemplate = query.sqlTemplate || '';
        const page = parseInt(query.page || '1', 10);
        const pageSize = parseInt(query.pageSize || '50', 10);
        const traceId = query.traceId || '';
        const dbManager = query.dbManager || '';

        const result = await db.getByTemplate(sqlTemplate, page, pageSize, traceId, dbManager);
        jsonResponse({ success: true, ...result });
        return;
      }

      if (pathname === '/api/decompress-gz') {
        const gzPath = query.filePath || '';
        if (!gzPath || !fs.existsSync(gzPath)) {
          jsonResponse({ success: false, error: '文件不存在' }, 404);
          return;
        }

        if (!gzPath.endsWith('.gz')) {
          jsonResponse({ success: true, decompressedPath: gzPath });
          return;
        }

        const tmpDir = path.join(os.tmpdir(), 'parselog_decompressed');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const baseName = path.basename(gzPath).replace(/\.gz$/, '');
        const targetPath = path.join(tmpDir, baseName);

        if (!fs.existsSync(targetPath)) {
          const buffer = fs.readFileSync(gzPath);
          const decompressed = zlib.gunzipSync(buffer);
          fs.writeFileSync(targetPath, decompressed);
        }

        jsonResponse({ success: true, decompressedPath: targetPath });
        return;
      }

      // 静态资源分发 (Vue 3 前端)
      const handled = serveStatic(req, res, staticDir);
      if (!handled) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
      }
    } catch (err: any) {
      jsonResponse({ success: false, error: err.message || String(err) }, 500);
    }
  });

  function startListen(p: number) {
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ 端口 ${p} 已被占用，正在尝试端口 ${p + 1}...`);
        startListen(p + 1);
      } else {
        console.error('❌ HTTP 服务启动失败:', err);
      }
    });

    server.listen(p, () => {
      const url = `http://localhost:${p}`;
      console.log(`\n==================================================`);
      console.log(`🚀 SQL 日志分析器控制台已成功启动: ${url}`);
      console.log(`==================================================\n`);

      // 非测试环境自动打开浏览器
      if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
        const openCmd =
          process.platform === 'win32'
            ? `start ${url}`
            : process.platform === 'darwin'
            ? `open ${url}`
            : `xdg-open ${url}`;
        exec(openCmd, () => {});
      }
    });
  }

  startListen(port);
  return server;
}

export * from './static';
export default createServer;
