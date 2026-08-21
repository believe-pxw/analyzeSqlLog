import { LogHeader } from '../types/log';

/**
 * 极速判定单行文本是否属于标准应用日志 Header
 * 特征: 前 10 位满足 YYYY-MM-DD 格式，第 11 位为空格或 T
 */
export function isLogHeader(line: string): boolean {
  if (!line || line.length < 23) return false;
  // 快速字符特征检测: 202x-xx-xx
  const c0 = line.charCodeAt(0);
  const c4 = line.charCodeAt(4);
  const c7 = line.charCodeAt(7);
  // '2' = 50, '-' = 45
  if (c0 !== 50 || c4 !== 45 || c7 !== 45) return false;

  // 校验日期数字格式: 20xx-xx-xx
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\.\d{3}/.test(line.substring(0, 23));
}

/**
 * 高性能从日志 Header 行中提取标准 13 维元数据 (依据 LOG_FORMAT_SPEC.md 规范)
 * 格式: Time NanoTime Level [ServiceName] [InstanceName] [IpAddress] [HostName] [TraceId] [SpanId] [ParentSpanId] [Thread] LoggerName Msg
 */
export function parseLogHeader(line: string): LogHeader {
  const logTime = line.length >= 23 ? line.substring(0, 23) : line;
  let nanoTime = '';
  let level = 'INFO';
  let serviceName = '-';
  let instanceName = '-';
  let ipAddress = '-';
  let hostName = '-';
  let traceId = '-';
  let spanId = '-';
  let parentSpanId = '-';
  let threadName = '-';
  let loggerName = '';
  let message = '';

  // 解析第 23 字符之后的 nanoTime 与 level，直到遇到第一个 '['
  let firstBracketIdx = line.indexOf('[', 23);
  if (firstBracketIdx === -1) firstBracketIdx = line.indexOf('[');

  if (firstBracketIdx !== -1) {
    const prefixParts = line.substring(23, firstBracketIdx).trim().split(/\s+/).filter(Boolean);
    if (prefixParts.length === 1) {
      // 兼容只有 level (旧格式)
      level = prefixParts[0];
    } else if (prefixParts.length >= 2) {
      nanoTime = prefixParts[0];
      level = prefixParts[1];
    }
  }

  let bracketCount = 0;
  let start = -1;
  let lastBracketCloseIdx = -1;

  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 91) { // '['
      start = i + 1;
    } else if (c === 93 && start !== -1) { // ']'
      bracketCount++;
      const val = line.substring(start, i);
      if (bracketCount === 1) {
        serviceName = val;
      } else if (bracketCount === 2) {
        instanceName = val;
      } else if (bracketCount === 3) {
        ipAddress = val;
      } else if (bracketCount === 4) {
        hostName = val;
      } else if (bracketCount === 5) {
        traceId = val;
      } else if (bracketCount === 6) {
        spanId = val;
      } else if (bracketCount === 7) {
        parentSpanId = val;
      } else if (bracketCount === 8) {
        threadName = val;
        lastBracketCloseIdx = i;
        break;
      }
      start = -1;
    }
  }

  if (lastBracketCloseIdx !== -1 && lastBracketCloseIdx < line.length - 1) {
    const afterBracket = line.substring(lastBracketCloseIdx + 1).trim();
    const spaceIdx = afterBracket.indexOf(' ');
    if (spaceIdx !== -1) {
      loggerName = afterBracket.substring(0, spaceIdx).trim();
      message = afterBracket.substring(spaceIdx + 1);
    } else {
      loggerName = afterBracket;
      message = '';
    }
  }

  return {
    logTime,
    nanoTime,
    level,
    serviceName,
    instanceName,
    ipAddress,
    hostName,
    traceId,
    spanId,
    parentSpanId,
    threadName,
    loggerName,
    message
  };
}
