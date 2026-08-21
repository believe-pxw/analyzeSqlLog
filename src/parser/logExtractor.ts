import fs from 'fs';
import readline from 'readline';
import zlib from 'zlib';
import path from 'path';
import { parseLogHeader, isLogHeader } from './header';
import { cleanSqlText } from './sqlParser';
import { AppLogRecord } from '../types/log';

/**
 * 极速流式切片读取并解析指定日志文件 [startLine, endLine] 区间内的应用日志（包含 SQL 内容与真实异常堆栈）
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
      const isSqlHeader =
        header.loggerName.includes('PreparedStatementWithLog') ||
        header.loggerName.includes('SQLLogUtils') ||
        header.loggerName.includes('GeneralDBManager') ||
        header.loggerName.includes('DBManager') ||
        (header.message && header.message.includes('SQL执行信息'));

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
        is_sql: isSqlHeader,
      };
    } else if (currentRecord) {
      const trimmed = rawLine.trim();
      const cleaned = rawLine.startsWith('>') ? rawLine.substring(1).trim() : trimmed;

      if (currentRecord.is_sql) {
        // SQL 日志后续行解析：提取真正的完整 SQL 文本与执行耗时，避免误作异常堆栈
        if (cleaned.startsWith('SQL语句:') || cleaned.startsWith('SQL:') || cleaned.startsWith('sql:')) {
          const sql = cleaned.replace(/^SQL(语句)?:/i, '').trim();
          currentRecord.message = sql;
        } else if (cleaned.startsWith('耗时:') || cleaned.startsWith('执行时间:') || cleaned.startsWith('Time:')) {
          const match = cleaned.match(/(\d+(\.\d+)?)\s*ms/i);
          if (match) {
            currentRecord.exec_time_ms = parseFloat(match[1]);
          }
        } else if (cleaned.startsWith('影响行数:') || cleaned.startsWith('结果集:') || cleaned.startsWith('Rows:')) {
          const match = cleaned.match(/(\d+)/);
          if (match) {
            currentRecord.result_rows = parseInt(match[1], 10);
          }
        } else if (!currentRecord.message || currentRecord.message === 'SQL执行信息:') {
          currentRecord.message = cleaned;
        } else if (currentRecord.message && !cleaned.startsWith('参数:')) {
          // 多行长 SQL
          currentRecord.message += '\n' + cleaned;
        }
      } else {
        // 普通日志多行文本或真实异常堆栈
        const isStackTrace =
          currentRecord.level === 'ERROR' ||
          currentRecord.level === 'FATAL' ||
          cleaned.startsWith('at ') ||
          cleaned.startsWith('Caused by:') ||
          cleaned.includes('Exception') ||
          cleaned.includes('Error');

        if (isStackTrace) {
          if (!currentRecord.stack_trace) {
            currentRecord.stack_trace = cleaned;
          } else {
            currentRecord.stack_trace += '\n' + cleaned;
          }
          currentRecord.has_stack = true;
        } else {
          if (currentRecord.message) {
            currentRecord.message += '\n' + cleaned;
          } else {
            currentRecord.message = cleaned;
          }
        }
      }
    }
  }

  flushCurrent();
  return records;
}
