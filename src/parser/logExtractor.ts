import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import path from 'path';
import { parseLogHeader, isLogHeader } from './header';
import { cleanSqlText } from './sqlParser';
import { AppLogRecord } from '../types/log';

/**
 * 极速流式切片读取并解析指定日志文件 [startLine, endLine] 区间内的应用日志（包含多行异常堆栈）
 * @param sourceFile 日志文件路径 (支持 .log 与 .gz)
 * @param startLine 起始行号 (1-based)
 * @param endLine 结束行号 (1-based)
 */
export async function extractLogLines(
  sourceFile: string,
  startLine: number,
  endLine: number
): Promise<AppLogRecord[]> {
  const resolvedPath = path.resolve(sourceFile);
  if (!fs.existsSync(resolvedPath)) {
    return [];
  }

  let inputStream: NodeJS.ReadableStream = fs.createReadStream(resolvedPath);
  if (resolvedPath.endsWith('.gz')) {
    const gunzip = zlib.createGunzip();
    inputStream = inputStream.pipe(gunzip);
  }

  const rl = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  const records: AppLogRecord[] = [];
  let currentRecord: AppLogRecord | null = null;
  let currentLine = 0;

  function flushCurrent() {
    if (currentRecord) {
      if (currentRecord.message) {
        currentRecord.message = cleanSqlText(currentRecord.message);
      }
      records.push(currentRecord);
      currentRecord = null;
    }
  }

  for await (const rawLine of rl) {
    currentLine++;

    // 还没到达目标区间
    if (currentLine < startLine) {
      continue;
    }

    // 超过了 endLine 并且遇到了新的 Header，说明目标 Trace 区间的所有行与堆栈已全部闭合
    if (currentLine > endLine && isLogHeader(rawLine)) {
      flushCurrent();
      break;
    }

    if (isLogHeader(rawLine)) {
      flushCurrent();

      const header = parseLogHeader(rawLine);
      currentRecord = {
        id: records.length + 1,
        log_time: header.logTime,
        nano_time: header.nanoTime,
        level: header.level,
        service_name: header.serviceName,
        instance_name: header.instanceName,
        ip_address: header.ipAddress,
        host_name: header.hostName,
        trace_id: header.traceId,
        span_id: header.spanId,
        parent_span_id: header.parentSpanId,
        thread_name: header.threadName,
        logger_name: header.loggerName,
        message: header.message,
        line_number: currentLine,
        source_file: resolvedPath,
      };
    } else if (currentRecord) {
      // 多行异常堆栈或多行日志正文
      const cleaned = rawLine.startsWith('>') ? rawLine.substring(1) : rawLine;
      if (!currentRecord.stack_trace) {
        currentRecord.stack_trace = cleaned;
      } else {
        currentRecord.stack_trace += '\n' + cleaned;
      }
      if (currentRecord.message) {
        currentRecord.message += '\n' + cleaned;
      }
    }
  }

  flushCurrent();
  return records;
}
