import path from 'path';
import fs from 'fs';
import { SqlLogDatabase } from './db';
import { parseLogs } from './parser';
import { createServer } from './server';
import { SqlRecord } from './types/sql';
import { LogTraceStub } from './types/stub';

const DEFAULT_LOG_DIR = `D:\\Users\\boke\\Desktop\\source\\bokeerp\\erp-backend\\logs`;

export async function main() {
  console.log(`\n==================================================`);
  console.log(`⚡ 极速全链路日志与性能分析器 (parselog CLI - TypeScript & Vue 3)`);
  console.log(`==================================================`);

  const args = process.argv.slice(2);
  let targetPath = '';

  if (args[0]) {
    targetPath = path.resolve(args[0]);
  } else {
    const cwd = process.cwd();
    let hasLocalLogs = false;
    try {
      const files = fs.readdirSync(cwd);
      hasLocalLogs = files.some(f => f.endsWith('.log'));
    } catch (e) {}

    if (hasLocalLogs) {
      targetPath = cwd;
    } else if (fs.existsSync(DEFAULT_LOG_DIR)) {
      targetPath = DEFAULT_LOG_DIR;
    } else {
      targetPath = cwd;
    }
  }

  console.log(`\n📂 正在扫描日志路径: ${targetPath}`);

  const startTime = Date.now();
  const db = new SqlLogDatabase(':memory:');
  await db.initSchema();

  let batch: SqlRecord[] = [];
  const BATCH_SIZE = 10000;

  let perfBatch: { trace: any; actions: any[] }[] = [];
  const PERF_BATCH_SIZE = 50;

  // 流式解析并批量装载 SQL 与 性能树，应用日志仅记录轻量起止行存根
  const parseResult = await parseLogs(
    targetPath,
    record => {
      batch.push(record);
      if (batch.length >= BATCH_SIZE) {
        const toInsert = batch;
        batch = [];
        return db.insertBatch(toInsert);
      }
    },
    perfData => {
      perfBatch.push(perfData);
      if (perfBatch.length >= PERF_BATCH_SIZE) {
        const toInsert = perfBatch;
        perfBatch = [];
        return db.insertPerfBatch(toInsert);
      }
    },
    null // 启动时不全量加载 app_logs，改用存根按需惰性切片装载
  );

  if (batch.length > 0) {
    await db.insertBatch(batch);
  }
  if (perfBatch.length > 0) {
    await db.insertPerfBatch(perfBatch);
  }
  if (parseResult.traceStubs && parseResult.traceStubs.length > 0) {
    db.registerTraceStubs(parseResult.traceStubs);
  }

  const costMs = Date.now() - startTime;
  parseResult.costMs = costMs;

  console.log(`\n✅ 解析完成！数据已装载至 DuckDB 内存分析引擎`);
  console.log(`--------------------------------------------------`);
  console.log(`• 耗时: ${costMs} ms`);
  console.log(`• 日志文件数: ${parseResult.totalFiles}`);
  console.log(`• 扫描日志行数: ${parseResult.totalLines.toLocaleString()}`);
  console.log(`• 结构化 SQL 记录: ${parseResult.totalRecords.toLocaleString()} 条`);
  if (parseResult.totalPerfTraces > 0) {
    console.log(`• 性能剖析树 (ActionRecorder): ${parseResult.totalPerfTraces.toLocaleString()} 笔完整请求`);
  }
  if (parseResult.traceStubs && parseResult.traceStubs.length > 0) {
    console.log(`• 纯净日志索引 (起止行存根): ${parseResult.traceStubs.length.toLocaleString()} 笔 Trace (按需惰性秒级加载)`);
  }

  // 启动 Web 控制台
  createServer(db, parseResult, 3000);
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
