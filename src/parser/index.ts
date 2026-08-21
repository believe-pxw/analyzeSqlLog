import fs from 'fs';
import readline from 'readline';
import path from 'path';
import zlib from 'zlib';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import os from 'os';
import { isLogHeader, parseLogHeader } from './header';
import { cleanSqlText, parseTimeToMs } from './sqlParser';
import { parseActionLine, calculatePerfTraceMetrics, ParsedActionItem } from './perfParser';
import { SqlRecord } from '../types/sql';
import { AppLogRecord, LogHeader } from '../types/log';
import { LogTraceStub } from '../types/stub';

export interface ParseResult {
  totalFiles: number;
  totalLines: number;
  totalRecords: number;
  totalPerfTraces: number;
  totalAppLogs: number;
  traceStubs?: LogTraceStub[];
  costMs?: number;
}

export type RecordCallback = (record: SqlRecord) => Promise<any> | void;
export type PerfTraceCallback = (perfData: { trace: any; actions: any[] }) => Promise<any> | void;
export type AppLogCallback = (appLog: AppLogRecord) => Promise<any> | void;
export type StubCallback = (stub: LogTraceStub) => Promise<any> | void;

/**
 * 极速流式单文件解析器 (同时支持 SQL 日志、ActionRecorder 性能日志与通用应用日志)
 */
export async function parseLogFile(
  filePath: string,
  onRecord?: RecordCallback | null,
  startRecordId = 0,
  onPerfTrace?: PerfTraceCallback | null,
  onAppLog?: AppLogCallback | null,
  startAppLogId = 0,
  onStub?: StubCallback | null
): Promise<{ totalLines: number; totalRecords: number; totalPerfTraces: number; totalAppLogs: number; traceStubs: LogTraceStub[] }> {
  let inputStream: NodeJS.ReadableStream;
  if (filePath.endsWith('.gz')) {
    inputStream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
  } else {
    inputStream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 1024 * 1024 });
  }

  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  let totalLines = 0;
  let totalRecords = startRecordId;
  let totalPerfTraces = 0;
  let totalAppLogs = startAppLogId;
  const stubsMap = new Map<string, LogTraceStub>();

  let currentRecord: any = null;
  let currentAppLog: any = null;
  let captureState: 'sql_template' | 'full_sql' | null = null;
  let lastHeaderInfo: LogHeader = {
    logTime: '',
    nanoTime: '',
    level: 'INFO',
    serviceName: '-',
    instanceName: '-',
    ipAddress: '-',
    hostName: '-',
    traceId: '-',
    spanId: '-',
    parentSpanId: '-',
    threadName: '-',
    loggerName: '',
    message: '',
  };

  // Performance ActionRecorder 状态机
  let inPerfBlock = false;
  let currentPerfTrace: {
    trace_id: string;
    log_time: string;
    thread_name: string;
    source_file: string;
    line_number: number;
    actions: ParsedActionItem[];
  } | null = null;
  let lastPerfAction: ParsedActionItem | null = null;
  const seenPerfTraceIds = new Set<string>();

  function allocateUniquePerfTraceId(baseTraceId: string, spanId: string): string {
    let uniqueId = baseTraceId;
    if (seenPerfTraceIds.has(uniqueId)) {
      if (spanId && spanId !== '-' && !seenPerfTraceIds.has(spanId)) {
        uniqueId = spanId;
      } else {
        let suffix = 2;
        while (seenPerfTraceIds.has(`${baseTraceId}_#${suffix}`)) {
          suffix++;
        }
        uniqueId = `${baseTraceId}_#${suffix}`;
      }
    }
    seenPerfTraceIds.add(uniqueId);
    return uniqueId;
  }

  async function flushCurrent(): Promise<void> {
    if (currentRecord) {
      currentRecord.sql_template = cleanSqlText(currentRecord.sql_template);
      currentRecord.full_sql = cleanSqlText(currentRecord.full_sql);

      if (!currentRecord.sql_template && currentRecord.full_sql) {
        currentRecord.sql_template = currentRecord.full_sql;
      }
      if (!currentRecord.full_sql && currentRecord.sql_template) {
        currentRecord.full_sql = currentRecord.sql_template;
      }

      if (currentRecord.sql_template || currentRecord.full_sql) {
        totalRecords++;
        currentRecord.id = totalRecords;
        if (onRecord) {
          const res = onRecord(currentRecord);
          if (res && typeof res.then === 'function') {
            await res;
          }
        }
      }
    }
    currentRecord = null;
    captureState = null;
  }

  async function flushAppLog(): Promise<void> {
    if (currentAppLog) {
      if (currentAppLog.message) {
        currentAppLog.message = cleanSqlText(currentAppLog.message);
      }

      // 智能精简策略：仅保留有业务 TraceID 的日志 或 ERROR/WARN/FATAL 异常日志
      // 过滤掉无 TraceID 且为 INFO/DEBUG 的海量系统心跳与冗余噪音日志，防止海量日志爆内存
      const isImportantLevel =
        currentAppLog.level === 'ERROR' ||
        currentAppLog.level === 'WARN' ||
        currentAppLog.level === 'FATAL' ||
        (currentAppLog.stack_trace && currentAppLog.stack_trace.length > 0);
      const hasValidTrace =
        Boolean(currentAppLog.trace_id) &&
        currentAppLog.trace_id !== '-' &&
        currentAppLog.trace_id !== '';

      if (isImportantLevel || hasValidTrace) {
        totalAppLogs++;
        currentAppLog.id = totalAppLogs;
        if (onAppLog) {
          const res = onAppLog(currentAppLog);
          if (res && typeof res.then === 'function') {
            await res;
          }
        }
      }
      currentAppLog = null;
    }
  }

  async function flushPerfTrace(): Promise<void> {
    if (!currentPerfTrace || currentPerfTrace.actions.length === 0) {
      currentPerfTrace = null;
      return;
    }

    const { trace, actions } = calculatePerfTraceMetrics(
      currentPerfTrace.trace_id,
      currentPerfTrace.log_time,
      currentPerfTrace.thread_name,
      currentPerfTrace.source_file,
      currentPerfTrace.line_number,
      currentPerfTrace.actions
    );

    totalPerfTraces++;
    if (onPerfTrace) {
      const res = onPerfTrace({ trace, actions });
      if (res && typeof res.then === 'function') {
        await res;
      }
    }

    currentPerfTrace = null;
  }

  for await (const rawLine of rl) {
    totalLines++;
    const line = rawLine;

    // 极速判断 Header
    if (isLogHeader(line)) {
      // 一旦遇到任何新日志 Header，必然刷新闭合前一条 SQL 记录与通用应用日志
      await flushCurrent();
      await flushAppLog();

      lastHeaderInfo = parseLogHeader(line);

      // 记录轻量 Trace 与 Span 的起止行号存根
      if (lastHeaderInfo.traceId && lastHeaderInfo.traceId !== '-' && lastHeaderInfo.traceId !== '') {
        let stub = stubsMap.get(lastHeaderInfo.traceId);
        if (!stub) {
          stub = {
            trace_id: lastHeaderInfo.traceId,
            source_file: path.resolve(filePath),
            start_line: totalLines,
            end_line: totalLines,
            log_time: lastHeaderInfo.logTime,
            spans: {},
          };
          stubsMap.set(lastHeaderInfo.traceId, stub);
        } else {
          stub.end_line = totalLines;
        }

        if (lastHeaderInfo.spanId && lastHeaderInfo.spanId !== '-' && lastHeaderInfo.spanId !== '') {
          if (!stub.spans[lastHeaderInfo.spanId]) {
            stub.spans[lastHeaderInfo.spanId] = { start_line: totalLines, end_line: totalLines };
          } else {
            stub.spans[lastHeaderInfo.spanId].end_line = totalLines;
          }
        }
      }

      if (onAppLog) {
        currentAppLog = {
          id: 0,
          log_time: lastHeaderInfo.logTime,
          nano_time: lastHeaderInfo.nanoTime,
          level: lastHeaderInfo.level,
          service_name: lastHeaderInfo.serviceName,
          instance_name: lastHeaderInfo.instanceName,
          ip_address: lastHeaderInfo.ipAddress,
          host_name: lastHeaderInfo.hostName,
          trace_id: lastHeaderInfo.traceId,
          span_id: lastHeaderInfo.spanId,
          parent_span_id: lastHeaderInfo.parentSpanId,
          thread_name: lastHeaderInfo.threadName,
          logger_name: lastHeaderInfo.loggerName,
          message: lastHeaderInfo.message,
          line_number: totalLines,
          source_file: path.resolve(filePath),
        };
      }

      // 判断是否是 ActionRecorder 性能日志
      if (line.includes('com.bokesoft.erp.performance.ActionRecorder')) {
        inPerfBlock = true;

        if (currentPerfTrace && currentPerfTrace.thread_name !== lastHeaderInfo.threadName) {
          await flushPerfTrace();
        }

        if (!currentPerfTrace) {
          const uniqueTraceId = allocateUniquePerfTraceId(lastHeaderInfo.traceId, lastHeaderInfo.spanId);
          currentPerfTrace = {
            trace_id: uniqueTraceId,
            log_time: lastHeaderInfo.logTime,
            thread_name: lastHeaderInfo.threadName,
            source_file: path.resolve(filePath),
            line_number: totalLines,
            actions: [],
          };
        }
        lastPerfAction = null;
        continue;
      }

      if (currentPerfTrace) {
        if (lastHeaderInfo.threadName === currentPerfTrace.thread_name) {
          await flushPerfTrace();
        }
      }
      inPerfBlock = false;
      lastPerfAction = null;

      // 判断是否是 SQL 相关的日志 Header
      const isSqlLogHeader =
        line.includes('PreparedStatementWithLog') ||
        line.includes('SQLLogUtils') ||
        line.includes('GeneralDBManager') ||
        line.includes('DBManager') ||
        line.includes('SQL执行信息');

      if (isSqlLogHeader) {
        currentRecord = {
          id: 0,
          log_time: lastHeaderInfo.logTime,
          nano_time: lastHeaderInfo.nanoTime,
          level: lastHeaderInfo.level,
          service_name: lastHeaderInfo.serviceName,
          instance_name: lastHeaderInfo.instanceName,
          ip_address: lastHeaderInfo.ipAddress,
          host_name: lastHeaderInfo.hostName,
          trace_id: lastHeaderInfo.traceId,
          span_id: lastHeaderInfo.spanId,
          parent_span_id: lastHeaderInfo.parentSpanId,
          thread_name: lastHeaderInfo.threadName,
          logger_name: lastHeaderInfo.loggerName,
          exec_time_ms: 0,
          result_rows: 0,
          db_manager: '',
          sql_template: '',
          sql_params: '',
          full_sql: '',
          line_number: totalLines,
          source_file: path.resolve(filePath),
        };
      }
      continue;
    }

    // ==================== ActionRecorder 性能日志行解析 ====================
    if (inPerfBlock) {
      if (
        line.includes('================================================================================') ||
        line.includes('Level\tTime(0.001ms)')
      ) {
        continue;
      }

      if (line.startsWith('>')) {
        const parsedAction = parseActionLine(line);
        if (parsedAction) {
          parsedAction.line_number = totalLines;
          parsedAction.source_file = path.resolve(filePath);

          if (parsedAction.level === 0 && currentPerfTrace && currentPerfTrace.actions.length > 0) {
            const oldLogTime = currentPerfTrace.log_time;
            const oldThread = currentPerfTrace.thread_name;
            await flushPerfTrace();
            const uniqueTraceId = allocateUniquePerfTraceId(lastHeaderInfo.traceId, lastHeaderInfo.spanId);
            currentPerfTrace = {
              trace_id: uniqueTraceId,
              log_time: oldLogTime,
              thread_name: oldThread,
              source_file: path.resolve(filePath),
              line_number: totalLines,
              actions: [],
            };
          }

          if (currentPerfTrace) {
            currentPerfTrace.actions.push(parsedAction);
          }
          lastPerfAction = parsedAction;
        } else if (lastPerfAction) {
          const sqlLine = line.startsWith('>') ? line.substring(1).trim() : line.trim();
          if (sqlLine) {
            lastPerfAction.sql_text += (lastPerfAction.sql_text ? '\n' : '') + sqlLine;
          }
        }
        continue;
      }
    }

    // 追加多行 AppLog 文本 (如异常堆栈)
    if (currentAppLog && !inPerfBlock) {
      currentAppLog.message += (currentAppLog.message ? '\n' : '') + line;
    }

    // ==================== SQL 记录行解析 ====================
    if (!currentRecord) {
      if (line.includes('SQL执行信息:')) {
        currentRecord = {
          id: 0,
          log_time: lastHeaderInfo.logTime,
          nano_time: lastHeaderInfo.nanoTime,
          level: lastHeaderInfo.level,
          service_name: lastHeaderInfo.serviceName,
          instance_name: lastHeaderInfo.instanceName,
          ip_address: lastHeaderInfo.ipAddress,
          host_name: lastHeaderInfo.hostName,
          trace_id: lastHeaderInfo.traceId,
          span_id: lastHeaderInfo.spanId,
          parent_span_id: lastHeaderInfo.parentSpanId,
          thread_name: lastHeaderInfo.threadName,
          logger_name: lastHeaderInfo.loggerName,
          exec_time_ms: 0,
          result_rows: 0,
          db_manager: '',
          sql_template: '',
          sql_params: '',
          full_sql: '',
          line_number: totalLines,
          source_file: path.resolve(filePath),
        };
      } else {
        continue;
      }
    }

    if (line.includes('SQL执行信息:')) {
      if (currentRecord && (currentRecord.sql_template || currentRecord.full_sql)) {
        await flushCurrent();
      }
      if (!currentRecord) {
        currentRecord = {
          id: 0,
          log_time: lastHeaderInfo.logTime,
          nano_time: lastHeaderInfo.nanoTime,
          level: lastHeaderInfo.level,
          service_name: lastHeaderInfo.serviceName,
          instance_name: lastHeaderInfo.instanceName,
          ip_address: lastHeaderInfo.ipAddress,
          host_name: lastHeaderInfo.hostName,
          trace_id: lastHeaderInfo.traceId,
          span_id: lastHeaderInfo.spanId,
          parent_span_id: lastHeaderInfo.parentSpanId,
          thread_name: lastHeaderInfo.threadName,
          logger_name: lastHeaderInfo.loggerName,
          exec_time_ms: 0,
          result_rows: 0,
          db_manager: '',
          sql_template: '',
          sql_params: '',
          full_sql: '',
          line_number: totalLines,
          source_file: path.resolve(filePath),
        };
      }

      const rowMatch = line.match(/影响行数:\[(\d+)\s*rows\]/i);
      if (rowMatch) currentRecord.result_rows = parseInt(rowMatch[1], 10);

      const timeMatch = line.match(/执行时间:\[([^\]]+)\]/i);
      if (timeMatch) currentRecord.exec_time_ms = parseTimeToMs(timeMatch[1]);

      const dbMatch = line.match(/dbManager：\[([^\]]+)\]/i);
      if (dbMatch) currentRecord.db_manager = dbMatch[1];
      continue;
    }

    if (line.includes('SQL语句:')) {
      if (currentRecord && currentRecord.sql_template) {
        await flushCurrent();
        currentRecord = {
          id: 0,
          log_time: lastHeaderInfo.logTime,
          nano_time: lastHeaderInfo.nanoTime,
          level: lastHeaderInfo.level,
          service_name: lastHeaderInfo.serviceName,
          instance_name: lastHeaderInfo.instanceName,
          ip_address: lastHeaderInfo.ipAddress,
          host_name: lastHeaderInfo.hostName,
          trace_id: lastHeaderInfo.traceId,
          span_id: lastHeaderInfo.spanId,
          parent_span_id: lastHeaderInfo.parentSpanId,
          thread_name: lastHeaderInfo.threadName,
          logger_name: lastHeaderInfo.loggerName,
          exec_time_ms: 0,
          result_rows: 0,
          db_manager: '',
          sql_template: '',
          sql_params: '',
          full_sql: '',
          line_number: totalLines,
          source_file: path.resolve(filePath),
        };
      }
      captureState = 'sql_template';
      const idx = line.indexOf('SQL语句:[');
      let content = '';
      if (idx !== -1) {
        content = line.substring(idx + 'SQL语句:['.length);
      } else {
        content = line.replace(/.*SQL语句:\s*\[?/, '');
      }
      currentRecord.sql_template = content;
      continue;
    }

    if (line.includes('SQL参数:')) {
      captureState = null;
      const paramMatch = line.match(/SQL参数:\[([^\]]*)\]/);
      if (paramMatch) {
        currentRecord.sql_params = paramMatch[1];
      } else {
        currentRecord.sql_params = line.replace(/.*SQL参数:\s*\[?/, '');
      }
      continue;
    }

    if (line.includes('完整SQL:')) {
      captureState = 'full_sql';
      const idx = line.indexOf('完整SQL:[');
      let content = '';
      if (idx !== -1) {
        content = line.substring(idx + '完整SQL:['.length);
      } else {
        content = line.replace(/.*完整SQL:\s*\[?/, '');
      }
      currentRecord.full_sql = content;
      continue;
    }

    if (captureState === 'sql_template') {
      currentRecord.sql_template += '\n' + line;
    } else if (captureState === 'full_sql') {
      currentRecord.full_sql += '\n' + line;
    }
  }

  await flushCurrent();
  await flushPerfTrace();
  await flushAppLog();

  if (onStub) {
    for (const stub of stubsMap.values()) {
      const res = onStub(stub);
      if (res && typeof res.then === 'function') {
        await res;
      }
    }
  }

  return {
    totalLines,
    totalRecords: totalRecords - startRecordId,
    totalPerfTraces,
    totalAppLogs: totalAppLogs - startAppLogId,
    traceStubs: Array.from(stubsMap.values()),
  };
}

/**
 * 遍历扫描指定目录/文件列表 (支持多核 Worker 线程池并行深度扫描)
 */
export async function parseLogs(
  targetPath: string,
  onRecord?: RecordCallback | null,
  onPerfTrace?: PerfTraceCallback | null,
  onAppLog?: AppLogCallback | null,
  onStub?: StubCallback | null
): Promise<ParseResult> {
  const files: string[] = [];
  const allStubs: LogTraceStub[] = [];

  function collectFiles(dirOrFilePath: string): void {
    const stat = fs.statSync(dirOrFilePath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(dirOrFilePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dirOrFilePath, entry.name);
        if (entry.isDirectory()) {
          collectFiles(fullPath);
        } else if (entry.isFile()) {
          const f = entry.name;
          const isServerInfoOrError = /server-info|server-error/i.test(f);
          const isSupportedExt = f.endsWith('.log') || f.endsWith('.txt') || f.endsWith('.gz') || f.endsWith('.log.gz');
          if (isSupportedExt && isServerInfoOrError) {
            files.push(fullPath);
          }
        }
      }
    } else if (stat.isFile()) {
      files.push(dirOrFilePath);
    }
  }

  if (fs.existsSync(targetPath)) {
    collectFiles(targetPath);
  }

  if (files.length === 0) {
    return { totalFiles: 0, totalLines: 0, totalRecords: 0, totalPerfTraces: 0, totalAppLogs: 0, traceStubs: [] };
  }

  const cpuCount = os.cpus() ? os.cpus().length : 4;
  const maxWorkers = Math.min(cpuCount, files.length);

  if (files.length <= 1 || !isMainThread || maxWorkers <= 1) {
    let grandTotalLines = 0;
    let grandTotalRecords = 0;
    let grandTotalPerfTraces = 0;
    let grandTotalAppLogs = 0;

    for (const file of files) {
      const result = await parseLogFile(file, onRecord, grandTotalRecords, onPerfTrace, onAppLog, grandTotalAppLogs, stub => {
        allStubs.push(stub);
        if (onStub) onStub(stub);
      });
      grandTotalLines += result.totalLines;
      grandTotalRecords += result.totalRecords;
      grandTotalPerfTraces += result.totalPerfTraces || 0;
      grandTotalAppLogs += result.totalAppLogs || 0;
    }

    return {
      totalFiles: files.length,
      totalLines: grandTotalLines,
      totalRecords: grandTotalRecords,
      totalPerfTraces: grandTotalPerfTraces,
      totalAppLogs: grandTotalAppLogs,
      traceStubs: allStubs,
    };
  }

  // 多核 Worker 分发
  let workerScript = path.resolve(__dirname, 'worker.js');
  if (!fs.existsSync(workerScript)) {
    const distWorker = path.resolve(__dirname, '../dist/worker.js');
    if (fs.existsSync(distWorker)) {
      workerScript = distWorker;
    } else {
      // 若无独立 worker.js 产物，降级单线程极速顺序解析
      let grandTotalLines = 0;
      let grandTotalRecords = 0;
      let grandTotalPerfTraces = 0;
      let grandTotalAppLogs = 0;

      for (const file of files) {
        const result = await parseLogFile(file, onRecord, grandTotalRecords, onPerfTrace, onAppLog, 0, stub => {
          allStubs.push(stub);
          if (onStub) onStub(stub);
        });
        grandTotalLines += result.totalLines;
        grandTotalRecords += result.totalRecords;
        grandTotalPerfTraces += result.totalPerfTraces || 0;
        grandTotalAppLogs += result.totalAppLogs || 0;
      }

      return {
        totalFiles: files.length,
        totalLines: grandTotalLines,
        totalRecords: grandTotalRecords,
        totalPerfTraces: grandTotalPerfTraces,
        totalAppLogs: grandTotalAppLogs,
        traceStubs: allStubs,
      };
    }
  }

  const chunks: string[][] = Array.from({ length: maxWorkers }, () => []);
  files.forEach((f, idx) => chunks[idx % maxWorkers].push(f));

  let grandTotalLines = 0;
  let grandTotalRecords = 0;
  let grandTotalPerfTraces = 0;
  let grandTotalAppLogs = 0;

  const workerPromises = chunks.map(workerFiles => {
    return new Promise<void>((resolve, reject) => {
      if (workerFiles.length === 0) return resolve();

      const worker = new Worker(workerScript, {
        workerData: { files: workerFiles, hasAppLogCallback: !!onAppLog },
      });

      let pendingBatchPromise = Promise.resolve();

      worker.on('message', msg => {
        if (msg.type === 'batch') {
          pendingBatchPromise = pendingBatchPromise.then(async () => {
            const records = msg.records;
            for (let i = 0; i < records.length; i++) {
              grandTotalRecords++;
              records[i].id = grandTotalRecords;
              if (onRecord) {
                const res = onRecord(records[i]);
                if (res && typeof res.then === 'function') {
                  await res;
                }
              }
            }
          });
        } else if (msg.type === 'perf_trace') {
          pendingBatchPromise = pendingBatchPromise.then(async () => {
            grandTotalPerfTraces++;
            if (onPerfTrace) {
              const res = onPerfTrace(msg.data);
              if (res && typeof res.then === 'function') {
                await res;
              }
            }
          });
        } else if (msg.type === 'app_log_batch') {
          pendingBatchPromise = pendingBatchPromise.then(async () => {
            const logs = msg.records;
            for (let i = 0; i < logs.length; i++) {
              grandTotalAppLogs++;
              logs[i].id = grandTotalAppLogs;
              if (onAppLog) {
                const res = onAppLog(logs[i]);
                if (res && typeof res.then === 'function') {
                  await res;
                }
              }
            }
          });
        } else if (msg.type === 'trace_stubs') {
          const stubs: LogTraceStub[] = msg.stubs;
          stubs.forEach(s => {
            allStubs.push(s);
            if (onStub) onStub(s);
          });
        } else if (msg.type === 'done') {
          pendingBatchPromise.then(() => {
            grandTotalLines += msg.totalLines;
            resolve();
          });
        }
      });

      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
    });
  });

  await Promise.all(workerPromises);

  return {
    totalFiles: files.length,
    totalLines: grandTotalLines,
    totalRecords: grandTotalRecords,
    totalPerfTraces: grandTotalPerfTraces,
    totalAppLogs: grandTotalAppLogs,
    traceStubs: allStubs,
  };
}

export * from './header';
export * from './sqlParser';
export * from './perfParser';
export * from './logExtractor';

