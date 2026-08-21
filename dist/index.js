"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  AppLogDao: () => AppLogDao,
  DbConnection: () => DbConnection,
  INIT_SCHEMA_SQL: () => INIT_SCHEMA_SQL,
  PerfDao: () => PerfDao,
  SqlDao: () => SqlDao,
  SqlLogDatabase: () => SqlLogDatabase,
  calculatePerfTraceMetrics: () => calculatePerfTraceMetrics,
  cleanSqlText: () => cleanSqlText,
  compressSqlColumns: () => compressSqlColumns,
  createServer: () => createServer,
  default: () => src_default,
  extractLogLines: () => extractLogLines,
  isLogHeader: () => isLogHeader,
  main: () => main,
  parseActionLine: () => parseActionLine,
  parseLogFile: () => parseLogFile,
  parseLogHeader: () => parseLogHeader,
  parseLogs: () => parseLogs,
  parseSqlExecutionInfo: () => parseSqlExecutionInfo,
  parseTimeToMs: () => parseTimeToMs,
  serveStatic: () => serveStatic
});
module.exports = __toCommonJS(src_exports);

// src/parser/index.ts
var import_fs2 = __toESM(require("fs"));
var import_readline2 = __toESM(require("readline"));
var import_path2 = __toESM(require("path"));
var import_zlib2 = __toESM(require("zlib"));
var import_worker_threads = require("worker_threads");
var import_os = __toESM(require("os"));

// src/parser/header.ts
function isLogHeader(line) {
  if (!line || line.length < 23) return false;
  const c0 = line.charCodeAt(0);
  const c4 = line.charCodeAt(4);
  const c7 = line.charCodeAt(7);
  if (c0 !== 50 || c4 !== 45 || c7 !== 45) return false;
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\.\d{3}/.test(line.substring(0, 23));
}
function parseLogHeader(line) {
  const logTime = line.length >= 23 ? line.substring(0, 23) : line;
  let nanoTime = "";
  let level = "INFO";
  let serviceName = "-";
  let instanceName = "-";
  let ipAddress = "-";
  let hostName = "-";
  let traceId = "-";
  let spanId = "-";
  let parentSpanId = "-";
  let threadName = "-";
  let loggerName = "";
  let message = "";
  let firstBracketIdx = line.indexOf("[", 23);
  if (firstBracketIdx === -1) firstBracketIdx = line.indexOf("[");
  if (firstBracketIdx !== -1) {
    const prefixParts = line.substring(23, firstBracketIdx).trim().split(/\s+/).filter(Boolean);
    if (prefixParts.length === 1) {
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
    if (c === 91) {
      start = i + 1;
    } else if (c === 93 && start !== -1) {
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
    const spaceIdx = afterBracket.indexOf(" ");
    if (spaceIdx !== -1) {
      loggerName = afterBracket.substring(0, spaceIdx).trim();
      message = afterBracket.substring(spaceIdx + 1);
    } else {
      loggerName = afterBracket;
      message = "";
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

// src/parser/sqlParser.ts
function parseTimeToMs(timeStr) {
  if (!timeStr) return 0;
  const slashIdx = timeStr.indexOf("/");
  const cleanStr = slashIdx !== -1 ? timeStr.substring(0, slashIdx).trim() : timeStr.trim();
  const val = parseFloat(cleanStr);
  if (isNaN(val)) return 0;
  if (cleanStr.endsWith("s") || cleanStr.endsWith("S")) {
    if (cleanStr.endsWith("ms") || cleanStr.endsWith("MS")) {
      return Math.round(val);
    }
    return Math.round(val * 1e3);
  }
  if (cleanStr.endsWith("m") || cleanStr.endsWith("M")) {
    return Math.round(val * 6e4);
  }
  return Math.round(val);
}
function cleanSqlText(text) {
  if (!text) return "";
  let str = text.replace(/(^|\n)\s*>\s*/g, "$1").trim();
  if (str.endsWith("]")) {
    str = str.replace(/\s*\]\s*$/, "").trim();
  }
  if (str.startsWith("SQL\u8BED\u53E5:[")) {
    str = str.substring(7);
  } else if (str.startsWith("SQL\u8BED\u53E5:")) {
    str = str.substring(5);
  }
  if (str.endsWith("]")) {
    str = str.substring(0, str.length - 1);
  }
  return str.trim();
}
function parseSqlExecutionInfo(line) {
  let resultRows = 0;
  let execTimeMs = 0;
  let dbManager = "";
  const rowsMatch = line.match(/影响行数:\[(\d+)\s*rows?\]/i);
  if (rowsMatch) resultRows = parseInt(rowsMatch[1], 10);
  const timeMatch = line.match(/执行时间:\[([^\]]+)\]/i);
  if (timeMatch) execTimeMs = parseTimeToMs(timeMatch[1]);
  const dbMatch = line.match(/dbManager[：:]\[([^\]]+)\]/i);
  if (dbMatch) dbManager = dbMatch[1].trim();
  return { resultRows, execTimeMs, dbManager };
}
function compressSqlColumns(sql) {
  if (!sql) return "";
  const selectMatch = sql.match(/^(\s*select\s+)([\s\S]+?)(\s+from\s+[\s\S]+)$/i);
  if (!selectMatch) return sql;
  const prefix = selectMatch[1];
  const columnsStr = selectMatch[2].trim();
  const suffix = selectMatch[3];
  if (columnsStr.includes("(") || columnsStr.includes(")")) {
    return sql;
  }
  const cols = columnsStr.split(",");
  if (cols.length > 5) {
    return `${prefix}...${suffix}`;
  }
  return sql;
}

// src/parser/perfParser.ts
function parseActionLine(line) {
  const cleanLine = line.startsWith(">") ? line.substring(1) : line;
  const parts = cleanLine.split("	");
  if (parts.length < 5) return null;
  const rawLevel = parts[0];
  const level = parseInt(rawLevel.trim(), 10);
  if (isNaN(level)) return null;
  const timeUs = parseFloat(parts[1]) || 0;
  const selfTimeUs = parseFloat(parts[2]) || 0;
  const gapTimeUs = parseFloat(parts[3]) || 0;
  const actionName = parts.slice(4).join("	").trim();
  return {
    level,
    time_us: timeUs,
    self_time_us: selfTimeUs,
    gap_time_us: gapTimeUs,
    time_ms: Math.round(timeUs / 10) / 100,
    self_time_ms: Math.round(selfTimeUs / 10) / 100,
    gap_time_ms: Math.round(gapTimeUs / 10) / 100,
    action_name: actionName,
    sql_text: ""
  };
}
function calculatePerfTraceMetrics(traceId, logTime, threadName, sourceFile, lineNumber, actions) {
  const levelStack = [];
  let totalSqlCount = 0;
  let totalSqlTimeMs = 0;
  let totalCommitTimeMs = 0;
  let totalGapTimeMs = 0;
  let maxDepth = 0;
  actions.forEach((a, idx) => {
    a.node_id = idx;
    if (a.level > maxDepth) maxDepth = a.level;
    levelStack[a.level] = idx;
    a.parent_id = a.level > 0 ? levelStack[a.level - 1] ?? -1 : -1;
    totalGapTimeMs += a.gap_time_ms;
    if (a.action_name.startsWith("QueryDatabase/")) {
      totalSqlCount++;
      totalSqlTimeMs += a.time_ms;
      a.action_category = "sql";
    } else if (a.action_name === "DB commit" || a.action_name === "submit") {
      totalCommitTimeMs += a.time_ms;
      a.action_category = "commit";
    } else {
      a.action_category = "biz";
    }
  });
  const rootAction = actions.find((a) => a.level === 0) || actions[0];
  const firstService = actions.find((a) => a.level === 1) || { action_name: "-" };
  const totalTimeMs = rootAction ? rootAction.time_ms : 0;
  const selfTimeMs = rootAction ? rootAction.self_time_ms : 0;
  const bizTimeMs = Math.max(0, Math.round((totalTimeMs - totalSqlTimeMs - totalCommitTimeMs) * 100) / 100);
  const traceSummary = {
    id: 0,
    trace_id: traceId,
    log_time: logTime,
    thread_name: threadName,
    root_action: rootAction ? rootAction.action_name : "MidVEFilter.doFilter",
    service_name: firstService ? firstService.action_name : "-",
    total_time_ms: totalTimeMs,
    self_time_ms: selfTimeMs,
    gap_time_ms: Math.round(totalGapTimeMs * 100) / 100,
    biz_time_ms: bizTimeMs,
    sql_time_ms: Math.round(totalSqlTimeMs * 100) / 100,
    commit_time_ms: Math.round(totalCommitTimeMs * 100) / 100,
    action_count: actions.length,
    sql_count: totalSqlCount,
    max_depth: maxDepth,
    source_file: sourceFile,
    line_number: lineNumber
  };
  return { trace: traceSummary, actions };
}

// src/parser/logExtractor.ts
var import_fs = __toESM(require("fs"));
var import_readline = __toESM(require("readline"));
var import_zlib = __toESM(require("zlib"));
var import_path = __toESM(require("path"));
async function extractLogLines(sourceFile, startLine, endLine) {
  const resolvedPath = import_path.default.resolve(sourceFile);
  if (!import_fs.default.existsSync(resolvedPath)) {
    return [];
  }
  let inputStream = import_fs.default.createReadStream(resolvedPath);
  if (resolvedPath.endsWith(".gz")) {
    const gunzip = import_zlib.default.createGunzip();
    inputStream = inputStream.pipe(gunzip);
  }
  const rl = import_readline.default.createInterface({
    input: inputStream,
    crlfDelay: Infinity
  });
  const records = [];
  let currentRecord = null;
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
    if (currentLine < startLine) {
      continue;
    }
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
        source_file: resolvedPath
      };
    } else if (currentRecord) {
      const cleaned = rawLine.startsWith(">") ? rawLine.substring(1) : rawLine;
      if (!currentRecord.stack_trace) {
        currentRecord.stack_trace = cleaned;
      } else {
        currentRecord.stack_trace += "\n" + cleaned;
      }
      if (currentRecord.message) {
        currentRecord.message += "\n" + cleaned;
      }
    }
  }
  flushCurrent();
  return records;
}

// src/parser/index.ts
async function parseLogFile(filePath, onRecord, startRecordId = 0, onPerfTrace, onAppLog, startAppLogId = 0, onStub) {
  let inputStream;
  if (filePath.endsWith(".gz")) {
    inputStream = import_fs2.default.createReadStream(filePath).pipe(import_zlib2.default.createGunzip());
  } else {
    inputStream = import_fs2.default.createReadStream(filePath, { encoding: "utf-8", highWaterMark: 1024 * 1024 });
  }
  const rl = import_readline2.default.createInterface({
    input: inputStream,
    crlfDelay: Infinity
  });
  let totalLines = 0;
  let totalRecords = startRecordId;
  let totalPerfTraces = 0;
  let totalAppLogs = startAppLogId;
  const stubsMap = /* @__PURE__ */ new Map();
  let currentRecord = null;
  let currentAppLog = null;
  let captureState = null;
  let lastHeaderInfo = {
    logTime: "",
    nanoTime: "",
    level: "INFO",
    serviceName: "-",
    instanceName: "-",
    ipAddress: "-",
    hostName: "-",
    traceId: "-",
    spanId: "-",
    parentSpanId: "-",
    threadName: "-",
    loggerName: "",
    message: ""
  };
  let inPerfBlock = false;
  let currentPerfTrace = null;
  let lastPerfAction = null;
  const seenPerfTraceIds = /* @__PURE__ */ new Set();
  function allocateUniquePerfTraceId(baseTraceId, spanId) {
    let uniqueId = baseTraceId;
    if (seenPerfTraceIds.has(uniqueId)) {
      if (spanId && spanId !== "-" && !seenPerfTraceIds.has(spanId)) {
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
  async function flushCurrent() {
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
          if (res && typeof res.then === "function") {
            await res;
          }
        }
      }
    }
    currentRecord = null;
    captureState = null;
  }
  async function flushAppLog() {
    if (currentAppLog) {
      if (currentAppLog.message) {
        currentAppLog.message = cleanSqlText(currentAppLog.message);
      }
      const isImportantLevel = currentAppLog.level === "ERROR" || currentAppLog.level === "WARN" || currentAppLog.level === "FATAL" || currentAppLog.stack_trace && currentAppLog.stack_trace.length > 0;
      const hasValidTrace = Boolean(currentAppLog.trace_id) && currentAppLog.trace_id !== "-" && currentAppLog.trace_id !== "";
      if (isImportantLevel || hasValidTrace) {
        totalAppLogs++;
        currentAppLog.id = totalAppLogs;
        if (onAppLog) {
          const res = onAppLog(currentAppLog);
          if (res && typeof res.then === "function") {
            await res;
          }
        }
      }
      currentAppLog = null;
    }
  }
  async function flushPerfTrace() {
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
      if (res && typeof res.then === "function") {
        await res;
      }
    }
    currentPerfTrace = null;
  }
  for await (const rawLine of rl) {
    totalLines++;
    const line = rawLine;
    if (isLogHeader(line)) {
      await flushCurrent();
      await flushAppLog();
      lastHeaderInfo = parseLogHeader(line);
      if (lastHeaderInfo.traceId && lastHeaderInfo.traceId !== "-" && lastHeaderInfo.traceId !== "") {
        let stub = stubsMap.get(lastHeaderInfo.traceId);
        if (!stub) {
          stub = {
            trace_id: lastHeaderInfo.traceId,
            source_file: import_path2.default.resolve(filePath),
            start_line: totalLines,
            end_line: totalLines,
            log_time: lastHeaderInfo.logTime,
            spans: {}
          };
          stubsMap.set(lastHeaderInfo.traceId, stub);
        } else {
          stub.end_line = totalLines;
        }
        if (lastHeaderInfo.spanId && lastHeaderInfo.spanId !== "-" && lastHeaderInfo.spanId !== "") {
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
          source_file: import_path2.default.resolve(filePath)
        };
      }
      if (line.includes("com.bokesoft.erp.performance.ActionRecorder")) {
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
            source_file: import_path2.default.resolve(filePath),
            line_number: totalLines,
            actions: []
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
      const isSqlLogHeader = line.includes("PreparedStatementWithLog") || line.includes("SQLLogUtils") || line.includes("GeneralDBManager") || line.includes("DBManager") || line.includes("SQL\u6267\u884C\u4FE1\u606F");
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
          db_manager: "",
          sql_template: "",
          sql_params: "",
          full_sql: "",
          line_number: totalLines,
          source_file: import_path2.default.resolve(filePath)
        };
      }
      continue;
    }
    if (inPerfBlock) {
      if (line.includes("================================================================================") || line.includes("Level	Time(0.001ms)")) {
        continue;
      }
      if (line.startsWith(">")) {
        const parsedAction = parseActionLine(line);
        if (parsedAction) {
          parsedAction.line_number = totalLines;
          parsedAction.source_file = import_path2.default.resolve(filePath);
          if (parsedAction.level === 0 && currentPerfTrace && currentPerfTrace.actions.length > 0) {
            const oldLogTime = currentPerfTrace.log_time;
            const oldThread = currentPerfTrace.thread_name;
            await flushPerfTrace();
            const uniqueTraceId = allocateUniquePerfTraceId(lastHeaderInfo.traceId, lastHeaderInfo.spanId);
            currentPerfTrace = {
              trace_id: uniqueTraceId,
              log_time: oldLogTime,
              thread_name: oldThread,
              source_file: import_path2.default.resolve(filePath),
              line_number: totalLines,
              actions: []
            };
          }
          if (currentPerfTrace) {
            currentPerfTrace.actions.push(parsedAction);
          }
          lastPerfAction = parsedAction;
        } else if (lastPerfAction) {
          const sqlLine = line.startsWith(">") ? line.substring(1).trim() : line.trim();
          if (sqlLine) {
            lastPerfAction.sql_text += (lastPerfAction.sql_text ? "\n" : "") + sqlLine;
          }
        }
        continue;
      }
    }
    if (currentAppLog && !inPerfBlock) {
      currentAppLog.message += (currentAppLog.message ? "\n" : "") + line;
    }
    if (!currentRecord) {
      if (line.includes("SQL\u6267\u884C\u4FE1\u606F:")) {
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
          db_manager: "",
          sql_template: "",
          sql_params: "",
          full_sql: "",
          line_number: totalLines,
          source_file: import_path2.default.resolve(filePath)
        };
      } else {
        continue;
      }
    }
    if (line.includes("SQL\u6267\u884C\u4FE1\u606F:")) {
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
          db_manager: "",
          sql_template: "",
          sql_params: "",
          full_sql: "",
          line_number: totalLines,
          source_file: import_path2.default.resolve(filePath)
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
    if (line.includes("SQL\u8BED\u53E5:")) {
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
          db_manager: "",
          sql_template: "",
          sql_params: "",
          full_sql: "",
          line_number: totalLines,
          source_file: import_path2.default.resolve(filePath)
        };
      }
      captureState = "sql_template";
      const idx = line.indexOf("SQL\u8BED\u53E5:[");
      let content = "";
      if (idx !== -1) {
        content = line.substring(idx + "SQL\u8BED\u53E5:[".length);
      } else {
        content = line.replace(/.*SQL语句:\s*\[?/, "");
      }
      currentRecord.sql_template = content;
      continue;
    }
    if (line.includes("SQL\u53C2\u6570:")) {
      captureState = null;
      const paramMatch = line.match(/SQL参数:\[([^\]]*)\]/);
      if (paramMatch) {
        currentRecord.sql_params = paramMatch[1];
      } else {
        currentRecord.sql_params = line.replace(/.*SQL参数:\s*\[?/, "");
      }
      continue;
    }
    if (line.includes("\u5B8C\u6574SQL:")) {
      captureState = "full_sql";
      const idx = line.indexOf("\u5B8C\u6574SQL:[");
      let content = "";
      if (idx !== -1) {
        content = line.substring(idx + "\u5B8C\u6574SQL:[".length);
      } else {
        content = line.replace(/.*完整SQL:\s*\[?/, "");
      }
      currentRecord.full_sql = content;
      continue;
    }
    if (captureState === "sql_template") {
      currentRecord.sql_template += "\n" + line;
    } else if (captureState === "full_sql") {
      currentRecord.full_sql += "\n" + line;
    }
  }
  await flushCurrent();
  await flushPerfTrace();
  await flushAppLog();
  if (onStub) {
    for (const stub of stubsMap.values()) {
      const res = onStub(stub);
      if (res && typeof res.then === "function") {
        await res;
      }
    }
  }
  return {
    totalLines,
    totalRecords: totalRecords - startRecordId,
    totalPerfTraces,
    totalAppLogs: totalAppLogs - startAppLogId,
    traceStubs: Array.from(stubsMap.values())
  };
}
async function parseLogs(targetPath, onRecord, onPerfTrace, onAppLog, onStub) {
  const files = [];
  const allStubs = [];
  function collectFiles(dirOrFilePath) {
    const stat = import_fs2.default.statSync(dirOrFilePath);
    if (stat.isDirectory()) {
      const entries = import_fs2.default.readdirSync(dirOrFilePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        const fullPath = import_path2.default.join(dirOrFilePath, entry.name);
        if (entry.isDirectory()) {
          collectFiles(fullPath);
        } else if (entry.isFile()) {
          const f = entry.name;
          const isServerInfoOrError = /server-info|server-error/i.test(f);
          const isSupportedExt = f.endsWith(".log") || f.endsWith(".txt") || f.endsWith(".gz") || f.endsWith(".log.gz");
          if (isSupportedExt && isServerInfoOrError) {
            files.push(fullPath);
          }
        }
      }
    } else if (stat.isFile()) {
      files.push(dirOrFilePath);
    }
  }
  if (import_fs2.default.existsSync(targetPath)) {
    collectFiles(targetPath);
  }
  if (files.length === 0) {
    return { totalFiles: 0, totalLines: 0, totalRecords: 0, totalPerfTraces: 0, totalAppLogs: 0, traceStubs: [] };
  }
  const cpuCount = import_os.default.cpus() ? import_os.default.cpus().length : 4;
  const maxWorkers = Math.min(cpuCount, files.length);
  if (files.length <= 1 || !import_worker_threads.isMainThread || maxWorkers <= 1) {
    let grandTotalLines2 = 0;
    let grandTotalRecords2 = 0;
    let grandTotalPerfTraces2 = 0;
    let grandTotalAppLogs2 = 0;
    for (const file of files) {
      const result = await parseLogFile(file, onRecord, grandTotalRecords2, onPerfTrace, onAppLog, grandTotalAppLogs2, (stub) => {
        allStubs.push(stub);
        if (onStub) onStub(stub);
      });
      grandTotalLines2 += result.totalLines;
      grandTotalRecords2 += result.totalRecords;
      grandTotalPerfTraces2 += result.totalPerfTraces || 0;
      grandTotalAppLogs2 += result.totalAppLogs || 0;
    }
    return {
      totalFiles: files.length,
      totalLines: grandTotalLines2,
      totalRecords: grandTotalRecords2,
      totalPerfTraces: grandTotalPerfTraces2,
      totalAppLogs: grandTotalAppLogs2,
      traceStubs: allStubs
    };
  }
  let workerScript = import_path2.default.resolve(__dirname, "worker.js");
  if (!import_fs2.default.existsSync(workerScript)) {
    const distWorker = import_path2.default.resolve(__dirname, "../dist/worker.js");
    if (import_fs2.default.existsSync(distWorker)) {
      workerScript = distWorker;
    } else {
      let grandTotalLines2 = 0;
      let grandTotalRecords2 = 0;
      let grandTotalPerfTraces2 = 0;
      let grandTotalAppLogs2 = 0;
      for (const file of files) {
        const result = await parseLogFile(file, onRecord, grandTotalRecords2, onPerfTrace, onAppLog, 0, (stub) => {
          allStubs.push(stub);
          if (onStub) onStub(stub);
        });
        grandTotalLines2 += result.totalLines;
        grandTotalRecords2 += result.totalRecords;
        grandTotalPerfTraces2 += result.totalPerfTraces || 0;
        grandTotalAppLogs2 += result.totalAppLogs || 0;
      }
      return {
        totalFiles: files.length,
        totalLines: grandTotalLines2,
        totalRecords: grandTotalRecords2,
        totalPerfTraces: grandTotalPerfTraces2,
        totalAppLogs: grandTotalAppLogs2,
        traceStubs: allStubs
      };
    }
  }
  const chunks = Array.from({ length: maxWorkers }, () => []);
  files.forEach((f, idx) => chunks[idx % maxWorkers].push(f));
  let grandTotalLines = 0;
  let grandTotalRecords = 0;
  let grandTotalPerfTraces = 0;
  let grandTotalAppLogs = 0;
  const workerPromises = chunks.map((workerFiles) => {
    return new Promise((resolve, reject) => {
      if (workerFiles.length === 0) return resolve();
      const worker = new import_worker_threads.Worker(workerScript, {
        workerData: { files: workerFiles, hasAppLogCallback: !!onAppLog }
      });
      let pendingBatchPromise = Promise.resolve();
      worker.on("message", (msg) => {
        if (msg.type === "batch") {
          pendingBatchPromise = pendingBatchPromise.then(async () => {
            const records = msg.records;
            for (let i = 0; i < records.length; i++) {
              grandTotalRecords++;
              records[i].id = grandTotalRecords;
              if (onRecord) {
                const res = onRecord(records[i]);
                if (res && typeof res.then === "function") {
                  await res;
                }
              }
            }
          });
        } else if (msg.type === "perf_trace") {
          pendingBatchPromise = pendingBatchPromise.then(async () => {
            grandTotalPerfTraces++;
            if (onPerfTrace) {
              const res = onPerfTrace(msg.data);
              if (res && typeof res.then === "function") {
                await res;
              }
            }
          });
        } else if (msg.type === "app_log_batch") {
          pendingBatchPromise = pendingBatchPromise.then(async () => {
            const logs = msg.records;
            for (let i = 0; i < logs.length; i++) {
              grandTotalAppLogs++;
              logs[i].id = grandTotalAppLogs;
              if (onAppLog) {
                const res = onAppLog(logs[i]);
                if (res && typeof res.then === "function") {
                  await res;
                }
              }
            }
          });
        } else if (msg.type === "trace_stubs") {
          const stubs = msg.stubs;
          stubs.forEach((s) => {
            allStubs.push(s);
            if (onStub) onStub(s);
          });
        } else if (msg.type === "done") {
          pendingBatchPromise.then(() => {
            grandTotalLines += msg.totalLines;
            resolve();
          });
        }
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
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
    traceStubs: allStubs
  };
}

// src/db/connection.ts
var import_duckdb = __toESM(require("duckdb"));

// src/db/schema.ts
var INIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sqllogs (
    id INTEGER,
    log_time VARCHAR,
    nano_time VARCHAR,
    level VARCHAR,
    service_name VARCHAR,
    instance_name VARCHAR,
    ip_address VARCHAR,
    host_name VARCHAR,
    trace_id VARCHAR,
    span_id VARCHAR,
    parent_span_id VARCHAR,
    thread_name VARCHAR,
    logger_name VARCHAR,
    exec_time_ms DOUBLE,
    result_rows INTEGER,
    db_manager VARCHAR,
    sql_template VARCHAR,
    sql_params VARCHAR,
    full_sql VARCHAR,
    line_number INTEGER,
    source_file VARCHAR
);

CREATE TABLE IF NOT EXISTS perf_traces (
    trace_id VARCHAR,
    log_time VARCHAR,
    thread_name VARCHAR,
    root_action VARCHAR,
    service_name VARCHAR,
    total_time_ms DOUBLE,
    self_time_ms DOUBLE,
    gap_time_ms DOUBLE,
    biz_time_ms DOUBLE,
    sql_time_ms DOUBLE,
    commit_time_ms DOUBLE,
    action_count INTEGER,
    sql_count INTEGER,
    max_depth INTEGER,
    source_file VARCHAR,
    line_number INTEGER
);

CREATE TABLE IF NOT EXISTS perf_actions (
    trace_id VARCHAR,
    node_id INTEGER,
    parent_id INTEGER,
    level INTEGER,
    action_name VARCHAR,
    time_ms DOUBLE,
    self_time_ms DOUBLE,
    gap_time_ms DOUBLE,
    action_category VARCHAR,
    sql_text VARCHAR,
    line_number INTEGER,
    source_file VARCHAR
);

CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER,
    log_time VARCHAR,
    nano_time VARCHAR,
    level VARCHAR,
    service_name VARCHAR,
    instance_name VARCHAR,
    ip_address VARCHAR,
    host_name VARCHAR,
    trace_id VARCHAR,
    span_id VARCHAR,
    parent_span_id VARCHAR,
    thread_name VARCHAR,
    logger_name VARCHAR,
    message VARCHAR,
    stack_trace VARCHAR,
    has_stack BOOLEAN,
    line_number INTEGER,
    source_file VARCHAR
);

CREATE INDEX IF NOT EXISTS idx_sqllogs_trace_id ON sqllogs(trace_id);
CREATE INDEX IF NOT EXISTS idx_sqllogs_exec_time ON sqllogs(exec_time_ms);
CREATE INDEX IF NOT EXISTS idx_perf_actions_trace ON perf_actions(trace_id);
CREATE INDEX IF NOT EXISTS idx_app_logs_trace_id ON app_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_app_logs_span_id ON app_logs(span_id);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);
`;

// src/db/connection.ts
var DbConnection = class {
  db;
  conn;
  insertChain = Promise.resolve();
  constructor(dbPath = ":memory:") {
    this.db = new import_duckdb.default.Database(dbPath);
    this.conn = this.db.connect();
  }
  async initSchema() {
    return this.query(INIT_SCHEMA_SQL);
  }
  query(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.conn.all(sql, ...params, (err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }
  exec(sql) {
    return new Promise((resolve, reject) => {
      this.conn.exec(sql, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
  runSerial(fn) {
    const next = this.insertChain.then(fn, fn);
    this.insertChain = next;
    return next;
  }
  close() {
    return new Promise((resolve) => {
      try {
        this.conn.close(() => {
          this.db.close(() => {
            resolve();
          });
        });
      } catch (e) {
        resolve();
      }
    });
  }
};

// src/db/sqlDao.ts
var import_fs3 = __toESM(require("fs"));
var import_path3 = __toESM(require("path"));
var import_os2 = __toESM(require("os"));
var SqlDao = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async insertBatch(records) {
    if (!records || records.length === 0) return;
    return this.db.runSerial(async () => {
      await this._doInsertBatch(records);
    });
  }
  async _doInsertBatch(records) {
    if (!records || records.length === 0) return;
    const tmpFile = import_path3.default.join(import_os2.default.tmpdir(), `duckdb_sqllogs_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    try {
      const jsonLines = records.map((r) => JSON.stringify({
        id: r.id || 0,
        log_time: r.log_time || "",
        nano_time: r.nano_time || "",
        level: r.level || "INFO",
        service_name: r.service_name || "-",
        instance_name: r.instance_name || "-",
        ip_address: r.ip_address || "-",
        host_name: r.host_name || "-",
        trace_id: r.trace_id || "-",
        span_id: r.span_id || "-",
        parent_span_id: r.parent_span_id || "-",
        thread_name: r.thread_name || "-",
        logger_name: r.logger_name || "",
        exec_time_ms: r.exec_time_ms || 0,
        result_rows: r.result_rows || 0,
        db_manager: r.db_manager || "",
        sql_template: r.sql_template || "",
        sql_params: r.sql_params || "",
        full_sql: r.full_sql || "",
        line_number: r.line_number || 0,
        source_file: r.source_file || ""
      })).join("\n");
      await import_fs3.default.promises.writeFile(tmpFile, jsonLines, "utf-8");
      const normalizedPath = tmpFile.replace(/\\/g, "/");
      const sql = `
        INSERT INTO sqllogs (
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          exec_time_ms, result_rows, db_manager, sql_template, sql_params, full_sql, line_number, source_file
        )
        SELECT 
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          exec_time_ms, result_rows, db_manager, sql_template, sql_params, full_sql, line_number, source_file
        FROM read_json_auto('${normalizedPath}', format='newline_delimited');
      `;
      await this.db.exec(sql);
    } catch (err) {
      await this._insertFallback(records);
    } finally {
      import_fs3.default.unlink(tmpFile, () => {
      });
    }
  }
  async _insertFallback(records) {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const values = chunk.map((r) => `(
        ${r.id || 0},
        '${(r.log_time || "").replace(/'/g, "''")}',
        '${(r.nano_time || "").replace(/'/g, "''")}',
        '${(r.level || "INFO").replace(/'/g, "''")}',
        '${(r.service_name || "-").replace(/'/g, "''")}',
        '${(r.instance_name || "-").replace(/'/g, "''")}',
        '${(r.ip_address || "-").replace(/'/g, "''")}',
        '${(r.host_name || "-").replace(/'/g, "''")}',
        '${(r.trace_id || "-").replace(/'/g, "''")}',
        '${(r.span_id || "-").replace(/'/g, "''")}',
        '${(r.parent_span_id || "-").replace(/'/g, "''")}',
        '${(r.thread_name || "-").replace(/'/g, "''")}',
        '${(r.logger_name || "").replace(/'/g, "''")}',
        ${r.exec_time_ms || 0},
        ${r.result_rows || 0},
        '${(r.db_manager || "").replace(/'/g, "''")}',
        '${(r.sql_template || "").replace(/'/g, "''")}',
        '${(r.sql_params || "").replace(/'/g, "''")}',
        '${(r.full_sql || "").replace(/'/g, "''")}',
        ${r.line_number || 0},
        '${(r.source_file || "").replace(/'/g, "''")}'
      )`).join(",");
      await this.db.exec(`INSERT INTO sqllogs VALUES ${values}`);
    }
  }
  async getTotalSummary() {
    const sql = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT trace_id) as total_traces,
        COUNT(DISTINCT sql_template) as total_templates,
        COALESCE(SUM(exec_time_ms), 0) as total_time_ms,
        COALESCE(MAX(exec_time_ms), 0) as max_time_ms,
        COALESCE(AVG(exec_time_ms), 0) as avg_time_ms
      FROM sqllogs
    `;
    const res = await this.db.query(sql);
    const row = res[0] || {};
    return {
      totalRecords: Number(row.total_records || 0),
      totalTraces: Number(row.total_traces || 0),
      totalTemplates: Number(row.total_templates || 0),
      totalTimeMs: Math.round(Number(row.total_time_ms || 0)),
      maxTimeMs: Math.round(Number(row.max_time_ms || 0)),
      avgTimeMs: Math.round(Number(row.avg_time_ms || 0) * 100) / 100
    };
  }
  async getTopRepeated(page = 1, pageSize = 20, keyword = "") {
    let whereClause = "WHERE sql_template IS NOT NULL AND sql_template != ''";
    const params = [];
    if (keyword) {
      whereClause += " AND sql_template ILIKE ?";
      params.push(`%${keyword}%`);
    }
    const countSql = `SELECT COUNT(DISTINCT sql_template) as total FROM sqllogs ${whereClause}`;
    const countRes = await this.db.query(countSql, params);
    const total = Number(countRes[0]?.total || 0);
    const statSql = `
      SELECT 
        COALESCE(SUM(exec_time_ms), 0) as total_cost_ms,
        COUNT(*) as total_sqls,
        COALESCE(MAX(exec_time_ms), 0) as max_cost_ms
      FROM sqllogs ${whereClause}
    `;
    const statRes = await this.db.query(statSql, params);
    const statRow = statRes[0] || {};
    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT 
        sql_template,
        COUNT(*) as repeat_count,
        SUM(exec_time_ms) as total_time_ms,
        AVG(exec_time_ms) as avg_time_ms,
        MAX(exec_time_ms) as max_time_ms,
        MIN(exec_time_ms) as min_time_ms,
        COUNT(DISTINCT trace_id) as trace_count,
        FIRST(full_sql) as example_sql,
        FIRST(trace_id) as example_trace_id,
        FIRST(source_file) as example_source_file,
        FIRST(line_number) as example_line_number
      FROM sqllogs
      ${whereClause}
      GROUP BY sql_template
      ORDER BY repeat_count DESC, total_time_ms DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query(listSql, [...params, pageSize, offset]);
    const data = rows.map((r) => ({
      sql_template: r.sql_template,
      repeat_count: Number(r.repeat_count),
      total_time_ms: Math.round(Number(r.total_time_ms)),
      avg_time_ms: Math.round(Number(r.avg_time_ms) * 100) / 100,
      max_time_ms: Math.round(Number(r.max_time_ms)),
      min_time_ms: Math.round(Number(r.min_time_ms)),
      trace_count: Number(r.trace_count),
      example_sql: r.example_sql || r.sql_template,
      example_trace_id: r.example_trace_id,
      example_source_file: r.example_source_file,
      example_line_number: Number(r.example_line_number)
    }));
    return {
      data,
      total,
      totalSqls: Number(statRow.total_sqls || 0),
      totalCostMs: Math.round(Number(statRow.total_cost_ms || 0)),
      maxCostMs: Math.round(Number(statRow.max_cost_ms || 0))
    };
  }
  async getTopSlow(page = 1, pageSize = 20, traceId = "", minCostMs = 0, keyword = "") {
    let whereClause = "WHERE 1=1";
    const params = [];
    if (traceId) {
      whereClause += " AND trace_id = ?";
      params.push(traceId);
    }
    if (minCostMs > 0) {
      whereClause += " AND exec_time_ms >= ?";
      params.push(minCostMs);
    }
    if (keyword) {
      whereClause += " AND (sql_template ILIKE ? OR full_sql ILIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const countSql = `SELECT COUNT(*) as total FROM sqllogs ${whereClause}`;
    const countRes = await this.db.query(countSql, params);
    const total = Number(countRes[0]?.total || 0);
    const statSql = `
      SELECT 
        COALESCE(SUM(exec_time_ms), 0) as total_cost_ms,
        COALESCE(MAX(exec_time_ms), 0) as max_cost_ms,
        COUNT(DISTINCT trace_id) as total_traces
      FROM sqllogs ${whereClause}
    `;
    const statRes = await this.db.query(statSql, params);
    const statRow = statRes[0] || {};
    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT * FROM sqllogs
      ${whereClause}
      ORDER BY exec_time_ms DESC, log_time ASC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query(listSql, [...params, pageSize, offset]);
    const data = rows.map((r) => ({
      ...r,
      full_sql: r.full_sql || r.sql_template
    }));
    return {
      data,
      total,
      totalCostMs: Math.round(Number(statRow.total_cost_ms || 0)),
      maxCostMs: Math.round(Number(statRow.max_cost_ms || 0)),
      totalTraces: Number(statRow.total_traces || 0)
    };
  }
  async getDiagnostics(traceId = "", page = 1, pageSize = 20, minRepeatCount = 5, keyword = "") {
    let whereClause = "WHERE db_manager IS NOT NULL AND db_manager != '' AND sql_template IS NOT NULL AND sql_template != '' AND sql_template NOT ILIKE 'update %' AND sql_template NOT ILIKE 'delete %' AND sql_template NOT ILIKE 'insert %'";
    const params = [];
    if (traceId) {
      whereClause += " AND trace_id = ?";
      params.push(traceId);
    }
    if (keyword) {
      whereClause += " AND (sql_template ILIKE ? OR full_sql ILIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const havingClause = "HAVING COUNT(*) >= ?";
    const havingParams = [minRepeatCount];
    const groupSql = `
      SELECT 
        trace_id,
        db_manager,
        sql_template,
        COUNT(*) as repeat_count,
        SUM(exec_time_ms) as total_time_ms,
        AVG(exec_time_ms) as avg_time_ms,
        MAX(exec_time_ms) as max_time_ms,
        FIRST(full_sql) as example_sql,
        FIRST(source_file) as example_source_file,
        FIRST(line_number) as example_line_number
      FROM sqllogs
      ${whereClause}
      GROUP BY trace_id, db_manager, sql_template
      ${havingClause}
    `;
    const countSql = `SELECT COUNT(*) as total, COALESCE(SUM(total_time_ms), 0) as total_cost_ms, COALESCE(SUM(repeat_count), 0) as total_sqls, COUNT(DISTINCT trace_id) as total_traces, COALESCE(MAX(max_time_ms), 0) as max_cost_ms FROM (${groupSql}) t`;
    const countRes = await this.db.query(countSql, [...params, ...havingParams]);
    const total = Number(countRes[0]?.total || 0);
    const totalCostMs = Math.round(Number(countRes[0]?.total_cost_ms || 0));
    const totalSqls = Number(countRes[0]?.total_sqls || 0);
    const totalTraces = Number(countRes[0]?.total_traces || 0);
    const maxCostMs = Math.round(Number(countRes[0]?.max_cost_ms || 0));
    const offset = (page - 1) * pageSize;
    const listSql = `
      ${groupSql}
      ORDER BY repeat_count DESC, total_time_ms DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query(listSql, [...params, ...havingParams, pageSize, offset]);
    const data = rows.map((r) => ({
      trace_id: r.trace_id,
      db_manager: r.db_manager,
      sql_template: r.sql_template,
      repeat_count: Number(r.repeat_count),
      total_time_ms: Math.round(Number(r.total_time_ms)),
      avg_time_ms: Math.round(Number(r.avg_time_ms) * 100) / 100,
      max_time_ms: Math.round(Number(r.max_time_ms)),
      example_sql: r.example_sql || r.sql_template,
      example_source_file: r.example_source_file,
      example_line_number: Number(r.example_line_number),
      advice: Number(r.repeat_count) >= 20 ? "\u{1F525} \u4E25\u91CD\u5FAA\u73AF: \u5F3A\u70C8\u5EFA\u8BAE\u6539\u7528\u6279\u91CF IN \u67E5\u8BE2\u6216\u52A0\u7F13\u5B58" : "\u26A0\uFE0F \u91CD\u590D\u6267\u884C: \u5EFA\u8BAE\u8BC4\u4F30\u5FAA\u73AF\u8C03\u7528"
    }));
    return { data, total, totalCostMs, totalSqls, totalTraces, maxCostMs };
  }
  async getTraceSummaryList(page = 1, pageSize = 20, keyword = "", minCostMs = 0) {
    let whereClause = "WHERE trace_id IS NOT NULL AND trace_id != '-'";
    const params = [];
    if (keyword) {
      whereClause += " AND trace_id ILIKE ?";
      params.push(`%${keyword}%`);
    }
    const groupSql = `
      SELECT 
        trace_id,
        COUNT(*) as sql_count,
        SUM(exec_time_ms) as total_time_ms,
        AVG(exec_time_ms) as avg_time_ms,
        MAX(exec_time_ms) as max_time_ms,
        COUNT(DISTINCT db_manager) as db_manager_count,
        MIN(log_time) as first_time,
        MAX(log_time) as last_time
      FROM sqllogs
      ${whereClause}
      GROUP BY trace_id
      ${minCostMs > 0 ? "HAVING SUM(exec_time_ms) >= " + Number(minCostMs) : ""}
    `;
    const countSql = `
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(total_time_ms), 0) as total_cost_ms,
        COALESCE(SUM(sql_count), 0) as total_sqls,
        COALESCE(MAX(max_time_ms), 0) as max_cost_ms
      FROM (${groupSql}) t
    `;
    const countRes = await this.db.query(countSql, params);
    const total = Number(countRes[0]?.total || 0);
    const offset = (page - 1) * pageSize;
    const listSql = `
      ${groupSql}
      ORDER BY total_time_ms DESC, sql_count DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query(listSql, [...params, pageSize, offset]);
    const data = rows.map((r) => ({
      trace_id: r.trace_id,
      sql_count: Number(r.sql_count),
      total_time_ms: Math.round(Number(r.total_time_ms)),
      avg_time_ms: Math.round(Number(r.avg_time_ms) * 100) / 100,
      max_time_ms: Math.round(Number(r.max_time_ms)),
      db_manager_count: Number(r.db_manager_count),
      first_time: r.first_time || "",
      last_time: r.last_time || ""
    }));
    return {
      data,
      total,
      totalCostMs: Math.round(Number(countRes[0]?.total_cost_ms || 0)),
      totalSqls: Number(countRes[0]?.total_sqls || 0),
      totalTraces: total,
      maxCostMs: Math.round(Number(countRes[0]?.max_cost_ms || 0))
    };
  }
  async getTrace(traceId, page = 1, pageSize = 50) {
    const countSql = "SELECT COUNT(*) as total, COALESCE(SUM(exec_time_ms), 0) as total_cost_ms, COALESCE(MAX(exec_time_ms), 0) as max_cost_ms, COALESCE(AVG(exec_time_ms), 0) as avg_cost_ms FROM sqllogs WHERE trace_id = ?";
    const countRes = await this.db.query(countSql, [traceId]);
    const total = Number(countRes[0]?.total || 0);
    const totalCostMs = Math.round(Number(countRes[0]?.total_cost_ms || 0));
    const maxCostMs = Math.round(Number(countRes[0]?.max_cost_ms || 0));
    const avgCostMs = Math.round(Number(countRes[0]?.avg_cost_ms || 0) * 100) / 100;
    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT * FROM sqllogs
      WHERE trace_id = ?
      ORDER BY log_time ASC, id ASC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query(listSql, [traceId, pageSize, offset]);
    const data = rows.map((r) => ({
      ...r,
      full_sql: r.full_sql || r.sql_template
    }));
    return {
      data,
      total,
      totalCostMs,
      maxCostMs,
      avgCostMs,
      page,
      pageSize
    };
  }
  async getByTemplate(sqlTemplate, page = 1, pageSize = 50, traceId = "", dbManager = "") {
    let whereClause = "WHERE sql_template = ?";
    const params = [sqlTemplate];
    if (traceId) {
      whereClause += " AND trace_id = ?";
      params.push(traceId);
    }
    if (dbManager) {
      whereClause += " AND db_manager = ?";
      params.push(dbManager);
    }
    const countSql = `SELECT COUNT(*) as total, COALESCE(SUM(exec_time_ms), 0) as total_cost_ms, COALESCE(MAX(exec_time_ms), 0) as max_cost_ms, COALESCE(AVG(exec_time_ms), 0) as avg_cost_ms FROM sqllogs ${whereClause}`;
    const countRes = await this.db.query(countSql, params);
    const total = Number(countRes[0]?.total || 0);
    const totalCostMs = Math.round(Number(countRes[0]?.total_cost_ms || 0));
    const maxCostMs = Math.round(Number(countRes[0]?.max_cost_ms || 0));
    const avgCostMs = Math.round(Number(countRes[0]?.avg_cost_ms || 0) * 100) / 100;
    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT * FROM sqllogs
      ${whereClause}
      ORDER BY exec_time_ms DESC, log_time ASC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query(listSql, [...params, pageSize, offset]);
    const data = rows.map((r) => ({
      ...r,
      full_sql: r.full_sql || r.sql_template
    }));
    return {
      data,
      total,
      totalCostMs,
      maxCostMs,
      avgCostMs,
      page,
      pageSize
    };
  }
};

// src/db/perfDao.ts
var import_fs4 = __toESM(require("fs"));
var import_path4 = __toESM(require("path"));
var import_os3 = __toESM(require("os"));
var PerfDao = class {
  constructor(db) {
    this.db = db;
  }
  db;
  async insertPerfBatch(perfTraceList) {
    if (!perfTraceList || perfTraceList.length === 0) return;
    return this.db.runSerial(async () => {
      await this._doInsertPerfBatch(perfTraceList);
    });
  }
  async _doInsertPerfBatch(perfTraceList) {
    const traces = [];
    const actions = [];
    for (const item of perfTraceList) {
      if (item.trace) traces.push(item.trace);
      if (item.actions && item.actions.length > 0) {
        for (const a of item.actions) {
          actions.push({
            trace_id: item.trace.trace_id,
            node_id: a.node_id || 0,
            parent_id: a.parent_id !== void 0 ? a.parent_id : -1,
            level: a.level || 0,
            action_name: a.action_name || "",
            time_ms: a.time_ms || 0,
            self_time_ms: a.self_time_ms || 0,
            gap_time_ms: a.gap_time_ms || 0,
            action_category: a.action_category || "biz",
            sql_text: a.sql_text || "",
            line_number: a.line_number || 0,
            source_file: a.source_file || ""
          });
        }
      }
    }
    if (traces.length > 0) {
      const traceFile = import_path4.default.join(import_os3.default.tmpdir(), `duckdb_perf_traces_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
      try {
        const jsonLines = traces.map((t) => JSON.stringify(t)).join("\n");
        await import_fs4.default.promises.writeFile(traceFile, jsonLines, "utf-8");
        const normPath = traceFile.replace(/\\/g, "/");
        const sql = `
          INSERT INTO perf_traces (
            trace_id, log_time, thread_name, root_action, service_name,
            total_time_ms, self_time_ms, gap_time_ms, biz_time_ms, sql_time_ms, commit_time_ms,
            action_count, sql_count, max_depth, source_file, line_number
          )
          SELECT 
            trace_id, log_time, thread_name, root_action, service_name,
            total_time_ms, self_time_ms, gap_time_ms, biz_time_ms, sql_time_ms, commit_time_ms,
            action_count, sql_count, max_depth, source_file, line_number
          FROM read_json_auto('${normPath}', format='newline_delimited');
        `;
        await this.db.exec(sql);
      } finally {
        import_fs4.default.unlink(traceFile, () => {
        });
      }
    }
    if (actions.length > 0) {
      const actionFile = import_path4.default.join(import_os3.default.tmpdir(), `duckdb_perf_actions_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
      try {
        const jsonLines = actions.map((a) => JSON.stringify(a)).join("\n");
        await import_fs4.default.promises.writeFile(actionFile, jsonLines, "utf-8");
        const normPath = actionFile.replace(/\\/g, "/");
        const sql = `
          INSERT INTO perf_actions (
            trace_id, node_id, parent_id, level, action_name,
            time_ms, self_time_ms, gap_time_ms, action_category, sql_text, line_number, source_file
          )
          SELECT 
            trace_id, node_id, parent_id, level, action_name,
            time_ms, self_time_ms, gap_time_ms, action_category, sql_text, line_number, source_file
          FROM read_json_auto('${normPath}', format='newline_delimited');
        `;
        await this.db.exec(sql);
      } finally {
        import_fs4.default.unlink(actionFile, () => {
        });
      }
    }
  }
  async getPerformanceTraceList(page = 1, pageSize = 20, keyword = "", minCostMs = 0, serviceName = "") {
    let whereClause = "WHERE 1=1";
    const params = [];
    if (keyword) {
      whereClause += " AND (trace_id ILIKE ? OR service_name ILIKE ? OR root_action ILIKE ?)";
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    if (minCostMs > 0) {
      whereClause += " AND total_time_ms >= ?";
      params.push(minCostMs);
    }
    if (serviceName) {
      whereClause += " AND service_name = ?";
      params.push(serviceName);
    }
    const countSql = `SELECT COUNT(*) as total, COALESCE(SUM(total_time_ms), 0) as total_cost_ms, COALESCE(MAX(total_time_ms), 0) as max_cost_ms FROM perf_traces ${whereClause}`;
    const countRes = await this.db.query(countSql, params);
    const total = Number(countRes[0]?.total || 0);
    const offset = (page - 1) * pageSize;
    const listSql = `
      SELECT * FROM perf_traces
      ${whereClause}
      ORDER BY total_time_ms DESC, log_time DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.query(listSql, [...params, pageSize, offset]);
    return {
      data: rows,
      total,
      totalCostMs: Math.round(Number(countRes[0]?.total_cost_ms || 0)),
      totalTraces: total,
      maxCostMs: Math.round(Number(countRes[0]?.max_cost_ms || 0))
    };
  }
  async getPerformanceTree(traceId) {
    const traceRows = await this.db.query("SELECT * FROM perf_traces WHERE trace_id = ?", [traceId]);
    if (!traceRows || traceRows.length === 0) return null;
    const trace = traceRows[0];
    const actionRows = await this.db.query("SELECT * FROM perf_actions WHERE trace_id = ? ORDER BY node_id ASC", [traceId]);
    const nodeMap = /* @__PURE__ */ new Map();
    const hotspots = [];
    for (const a of actionRows) {
      const sqlDetails = [];
      if (a.sql_text) {
        sqlDetails.push({
          sql: a.sql_text,
          costMs: a.time_ms,
          time: "",
          sourceFile: a.source_file,
          lineNumber: a.line_number
        });
      }
      const node = {
        id: `${traceId}_${a.node_id}`,
        name: a.action_name,
        depth: a.level,
        totalCostMs: a.time_ms,
        selfCostMs: a.self_time_ms,
        gapCostMs: a.gap_time_ms,
        sourceFile: a.source_file,
        lineNumber: a.line_number,
        sqlCount: sqlDetails.length,
        sqlDetails,
        children: []
      };
      nodeMap.set(a.node_id, node);
      if (a.self_time_ms > 0) {
        hotspots.push({
          name: a.action_name,
          selfCostMs: a.self_time_ms,
          totalCostMs: a.time_ms,
          depth: a.level,
          sourceFile: a.source_file,
          lineNumber: a.line_number
        });
      }
    }
    let rootNode = null;
    for (const a of actionRows) {
      const node = nodeMap.get(a.node_id);
      if (a.parent_id === -1 || a.level === 0 || !nodeMap.has(a.parent_id)) {
        if (!rootNode) rootNode = node;
      } else {
        const parentNode = nodeMap.get(a.parent_id);
        if (parentNode) {
          parentNode.children.push(node);
        }
      }
    }
    hotspots.sort((x, y) => y.selfCostMs - x.selfCostMs);
    const topHotspots = hotspots.slice(0, 5);
    const topSelfHotspots = topHotspots.map((h) => ({
      action_name: h.name,
      name: h.name,
      self_time_ms: h.selfCostMs,
      selfCostMs: h.selfCostMs,
      total_time_ms: h.totalCostMs,
      totalCostMs: h.totalCostMs,
      depth: h.depth,
      source_file: h.sourceFile,
      sourceFile: h.sourceFile,
      line_number: h.lineNumber,
      lineNumber: h.lineNumber
    }));
    return {
      traceId: trace.trace_id,
      serviceName: trace.service_name,
      rootAction: trace.root_action,
      totalTimeMs: trace.total_time_ms,
      selfTimeMs: trace.self_time_ms,
      bizTimeMs: trace.biz_time_ms,
      sqlTimeMs: trace.sql_time_ms,
      commitTimeMs: trace.commit_time_ms,
      actionCount: trace.action_count,
      maxDepth: trace.max_depth,
      sqlCount: trace.sql_count,
      logTime: trace.log_time,
      sourceFile: trace.source_file,
      lineNumber: trace.line_number,
      rootNode: rootNode || (nodeMap.size > 0 ? Array.from(nodeMap.values())[0] : null),
      hotspots: topHotspots,
      topSelfHotspots
    };
  }
};

// src/db/appLogDao.ts
var import_fs5 = __toESM(require("fs"));
var import_path5 = __toESM(require("path"));
var import_os4 = __toESM(require("os"));
var AppLogDao = class {
  constructor(db) {
    this.db = db;
  }
  db;
  stubsMap = /* @__PURE__ */ new Map();
  /**
   * 注册轻量 Trace 起止行号存根索引
   */
  registerTraceStubs(stubs) {
    if (!stubs || stubs.length === 0) return;
    for (const stub of stubs) {
      if (!stub.trace_id || stub.trace_id === "-") continue;
      const list = this.stubsMap.get(stub.trace_id) || [];
      list.push(stub);
      this.stubsMap.set(stub.trace_id, list);
    }
  }
  /**
   * 获取当前内存中维护的所有 Trace 存根
   */
  getTraceStubs() {
    const all = [];
    for (const list of this.stubsMap.values()) {
      all.push(...list);
    }
    return all;
  }
  /**
   * 按需惰性装载核心：检查 DuckDB 是否已存在该 traceId 的日志，若无则切片读取文件并写入持久化缓存
   */
  async ensureTraceLogsLoaded(traceId) {
    if (!traceId || traceId === "-") return;
    const checkSql = "SELECT COUNT(*) as cnt FROM app_logs WHERE trace_id = ?";
    const checkRes = await this.db.query(checkSql, [traceId]);
    if (Number(checkRes[0]?.cnt || 0) > 0) {
      return;
    }
    const stubs = this.stubsMap.get(traceId);
    if (!stubs || stubs.length === 0) {
      return;
    }
    const allExtractedLogs = [];
    for (const stub of stubs) {
      const logs = await extractLogLines(stub.source_file, stub.start_line, stub.end_line);
      allExtractedLogs.push(...logs);
    }
    if (allExtractedLogs.length > 0) {
      await this.insertAppLogsBatch(allExtractedLogs);
    }
  }
  async insertAppLogsBatch(records) {
    if (!records || records.length === 0) return;
    return this.db.runSerial(async () => {
      await this._doInsertAppLogsBatch(records);
    });
  }
  async _doInsertAppLogsBatch(records) {
    const tmpFile = import_path5.default.join(import_os4.default.tmpdir(), `duckdb_app_logs_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
    try {
      const jsonLines = records.map((r) => JSON.stringify({
        id: r.id || 0,
        log_time: r.log_time || "",
        nano_time: r.nano_time || "",
        level: r.level || "INFO",
        service_name: r.service_name || "-",
        instance_name: r.instance_name || "-",
        ip_address: r.ip_address || "-",
        host_name: r.host_name || "-",
        trace_id: r.trace_id || "-",
        span_id: r.span_id || "-",
        parent_span_id: r.parent_span_id || "-",
        thread_name: r.thread_name || "-",
        logger_name: r.logger_name || "",
        message: r.message || "",
        stack_trace: r.stack_trace || "",
        has_stack: Boolean(r.stack_trace && r.stack_trace.length > 0),
        line_number: r.line_number || 0,
        source_file: r.source_file || ""
      })).join("\n");
      await import_fs5.default.promises.writeFile(tmpFile, jsonLines, "utf-8");
      const normPath = tmpFile.replace(/\\/g, "/");
      const sql = `
        INSERT INTO app_logs (
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          message, stack_trace, has_stack, line_number, source_file
        )
        SELECT 
          id, log_time, nano_time, level, service_name, instance_name, ip_address, host_name,
          trace_id, span_id, parent_span_id, thread_name, logger_name,
          message, stack_trace, has_stack, line_number, source_file
        FROM read_json_auto('${normPath}', format='newline_delimited');
      `;
      await this.db.exec(sql);
    } finally {
      import_fs5.default.unlink(tmpFile, () => {
      });
    }
  }
  async getAppLogs(page = 1, pageSize = 50, filters = {}) {
    if (filters.traceId) {
      await this.ensureTraceLogsLoaded(filters.traceId);
    }
    let whereClause = "WHERE 1=1";
    const params = [];
    if (filters.traceId) {
      whereClause += " AND trace_id = ?";
      params.push(filters.traceId);
    }
    if (filters.spanId) {
      whereClause += " AND span_id = ?";
      params.push(filters.spanId);
    }
    if (filters.level && filters.level !== "SQL") {
      whereClause += " AND level = ?";
      params.push(filters.level.toUpperCase());
    }
    if (filters.serviceName) {
      whereClause += " AND service_name = ?";
      params.push(filters.serviceName);
    }
    if (filters.loggerName) {
      whereClause += " AND logger_name ILIKE ?";
      params.push(`%${filters.loggerName}%`);
    }
    if (filters.keyword) {
      whereClause += " AND (message ILIKE ? OR logger_name ILIKE ?)";
      params.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
    }
    let appLogRows = [];
    let totalAppLogs = 0;
    if (!filters.level || filters.level !== "SQL") {
      const countSql = `SELECT COUNT(*) as total FROM app_logs ${whereClause}`;
      const countRes = await this.db.query(countSql, params);
      totalAppLogs = Number(countRes[0]?.total || 0);
      const listSql = `
        SELECT * FROM app_logs
        ${whereClause}
        ORDER BY id ASC, log_time ASC
      `;
      appLogRows = await this.db.query(listSql, params);
    }
    let sqlRows = [];
    if (filters.traceId && (!filters.level || filters.level === "SQL")) {
      let sqlWhere = "WHERE trace_id = ?";
      const sqlParams = [filters.traceId];
      if (filters.keyword) {
        sqlWhere += " AND (sql_template ILIKE ? OR full_sql ILIKE ?)";
        sqlParams.push(`%${filters.keyword}%`, `%${filters.keyword}%`);
      }
      const rawSqls = await this.db.query(`SELECT * FROM sqllogs ${sqlWhere} ORDER BY log_time ASC, id ASC`, sqlParams);
      sqlRows = rawSqls.map((r) => ({
        id: -r.id,
        log_time: r.log_time,
        nano_time: r.nano_time || "",
        level: "SQL",
        service_name: r.db_manager ? r.db_manager.replace(/^.*dbmanager\./, "") : "DB",
        instance_name: "-",
        ip_address: "-",
        host_name: "-",
        trace_id: r.trace_id,
        span_id: r.span_id || "-",
        parent_span_id: "-",
        thread_name: r.thread_name || "-",
        logger_name: r.db_manager || "PreparedStatementWithLog",
        message: r.full_sql || r.sql_template,
        stack_trace: "",
        has_stack: false,
        line_number: r.line_number || 0,
        source_file: r.source_file || "",
        is_sql: true,
        exec_time_ms: r.exec_time_ms,
        result_rows: r.result_rows
      }));
    }
    const allCombined = [...appLogRows, ...sqlRows];
    allCombined.sort((a, b) => {
      const timeComp = (a.log_time || "").localeCompare(b.log_time || "");
      if (timeComp !== 0) return timeComp;
      return (a.id || 0) - (b.id || 0);
    });
    const total = allCombined.length;
    const offset = (page - 1) * pageSize;
    const paginatedData = allCombined.slice(offset, offset + pageSize);
    let spans = [];
    let hasPerfTree = false;
    if (filters.traceId) {
      const spanSql = `
        SELECT span_id, parent_span_id, COUNT(*) as log_count
        FROM app_logs
        WHERE trace_id = ? AND span_id IS NOT NULL AND span_id != '-'
        GROUP BY span_id, parent_span_id
        ORDER BY MIN(id) ASC
      `;
      spans = await this.db.query(spanSql, [filters.traceId]);
      const perfCheck = await this.db.query("SELECT COUNT(*) as cnt FROM perf_traces WHERE trace_id = ?", [filters.traceId]);
      hasPerfTree = Number(perfCheck[0]?.cnt || 0) > 0;
    }
    return {
      data: paginatedData,
      total,
      spans: spans.map((s) => ({
        span_id: s.span_id,
        parent_span_id: s.parent_span_id,
        log_count: Number(s.log_count)
      })),
      hasPerfTree
    };
  }
  async getTraceSpans(traceId) {
    if (!traceId || traceId === "-") return [];
    await this.ensureTraceLogsLoaded(traceId);
    const sql = `
      SELECT 
        span_id, 
        parent_span_id, 
        COUNT(*) as log_count,
        SUM(CASE WHEN level = 'ERROR' THEN 1 ELSE 0 END) as error_count
      FROM app_logs
      WHERE trace_id = ? AND span_id IS NOT NULL AND span_id != '-'
      GROUP BY span_id, parent_span_id
      ORDER BY MIN(id) ASC
    `;
    const rows = await this.db.query(sql, [traceId]);
    return rows.map((r) => ({
      span_id: r.span_id,
      parent_span_id: r.parent_span_id,
      log_count: Number(r.log_count),
      error_count: Number(r.error_count || 0)
    }));
  }
};

// src/db/index.ts
var SqlLogDatabase = class {
  db;
  sqlDao;
  perfDao;
  appLogDao;
  constructor(dbPath = ":memory:") {
    this.db = new DbConnection(dbPath);
    this.sqlDao = new SqlDao(this.db);
    this.perfDao = new PerfDao(this.db);
    this.appLogDao = new AppLogDao(this.db);
  }
  async initSchema() {
    return this.db.initSchema();
  }
  query(sql, params = []) {
    return this.db.query(sql, params);
  }
  // SQL 相关
  async insertBatch(records) {
    return this.sqlDao.insertBatch(records);
  }
  async getTotalSummary() {
    return this.sqlDao.getTotalSummary();
  }
  async getTopRepeated(page = 1, pageSize = 20, keyword = "") {
    return this.sqlDao.getTopRepeated(page, pageSize, keyword);
  }
  async getTopSlow(page = 1, pageSize = 20, traceId = "", minCostMs = 0, keyword = "") {
    return this.sqlDao.getTopSlow(page, pageSize, traceId, minCostMs, keyword);
  }
  async getDiagnostics(traceId = "", page = 1, pageSize = 20, minRepeatCount = 5, keyword = "") {
    return this.sqlDao.getDiagnostics(traceId, page, pageSize, minRepeatCount, keyword);
  }
  async getTraceSummaryList(page = 1, pageSize = 20, keyword = "", minCostMs = 0) {
    return this.sqlDao.getTraceSummaryList(page, pageSize, keyword, minCostMs);
  }
  async getTrace(traceId, page = 1, pageSize = 50) {
    return this.sqlDao.getTrace(traceId, page, pageSize);
  }
  async getByTemplate(sqlTemplate, page = 1, pageSize = 50, traceId = "", dbManager = "") {
    return this.sqlDao.getByTemplate(sqlTemplate, page, pageSize, traceId, dbManager);
  }
  // Performance 相关
  async insertPerfBatch(perfTraceList) {
    return this.perfDao.insertPerfBatch(perfTraceList);
  }
  async getPerformanceTraceList(page = 1, pageSize = 20, keyword = "", minCostMs = 0, serviceName = "") {
    return this.perfDao.getPerformanceTraceList(page, pageSize, keyword, minCostMs, serviceName);
  }
  async getPerformanceTree(traceId) {
    return this.perfDao.getPerformanceTree(traceId);
  }
  // AppLog 相关与存根管理
  registerTraceStubs(stubs) {
    this.appLogDao.registerTraceStubs(stubs);
  }
  getTraceStubs() {
    return this.appLogDao.getTraceStubs();
  }
  async ensureTraceLogsLoaded(traceId) {
    return this.appLogDao.ensureTraceLogsLoaded(traceId);
  }
  async insertAppLogsBatch(records) {
    return this.appLogDao.insertAppLogsBatch(records);
  }
  async getAppLogs(page = 1, pageSize = 50, filters = {}) {
    return this.appLogDao.getAppLogs(page, pageSize, filters);
  }
  async getTraceSpans(traceId) {
    return this.appLogDao.getTraceSpans(traceId);
  }
  async close() {
    return this.db.close();
  }
};

// src/server/index.ts
var import_http = __toESM(require("http"));
var import_path7 = __toESM(require("path"));
var import_fs7 = __toESM(require("fs"));
var import_zlib3 = __toESM(require("zlib"));
var import_os5 = __toESM(require("os"));
var import_child_process = require("child_process");

// src/server/static.ts
var import_fs6 = __toESM(require("fs"));
var import_path6 = __toESM(require("path"));
var MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
function serveStatic(req, res, staticDir) {
  let reqPath = (req.url || "/").split("?")[0];
  if (reqPath === "/") reqPath = "/index.html";
  const safePath = import_path6.default.normalize(reqPath).replace(/^(\.\.[\/\\])+/, "");
  const filePath = import_path6.default.join(staticDir, safePath);
  if (import_fs6.default.existsSync(filePath) && import_fs6.default.statSync(filePath).isFile()) {
    const ext = import_path6.default.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    import_fs6.default.createReadStream(filePath).pipe(res);
    return true;
  }
  const indexPath = import_path6.default.join(staticDir, "index.html");
  if (import_fs6.default.existsSync(indexPath) && req.method === "GET" && !reqPath.startsWith("/api")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    import_fs6.default.createReadStream(indexPath).pipe(res);
    return true;
  }
  return false;
}

// src/server/index.ts
function createServer(db, parseStats, port = 3e3) {
  let staticDir = import_path7.default.resolve(process.cwd(), "dist/web");
  if (!import_fs7.default.existsSync(staticDir)) {
    staticDir = import_path7.default.resolve(__dirname, "../../dist/web");
  }
  if (!import_fs7.default.existsSync(staticDir)) {
    staticDir = import_path7.default.resolve(__dirname, "../dist/web");
  }
  const server = import_http.default.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;
    const query = Object.fromEntries(parsedUrl.searchParams.entries());
    function jsonResponse(data, status = 200) {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    }
    try {
      if (pathname === "/api/summary") {
        const summary = await db.getTotalSummary();
        summary.parseStats = parseStats;
        jsonResponse({ success: true, data: summary });
        return;
      }
      if (pathname === "/api/perf-trace-list") {
        const page = parseInt(query.page || "1", 10);
        const pageSize = parseInt(query.pageSize || "20", 10);
        const keyword = query.keyword || "";
        const minCostMs = parseFloat(query.minCostMs || "0");
        const service = query.service || "";
        const result = await db.getPerformanceTraceList(page, pageSize, keyword, minCostMs, service);
        jsonResponse({ success: true, ...result });
        return;
      }
      if (pathname === "/api/perf-tree") {
        const traceId = query.traceId || "";
        const result = await db.getPerformanceTree(traceId);
        jsonResponse({ success: true, data: result });
        return;
      }
      if (pathname === "/api/app-logs") {
        const page = parseInt(query.page || "1", 10);
        const pageSize = parseInt(query.pageSize || "50", 10);
        const traceId = query.traceId || "";
        const spanId = query.spanId || "";
        const level = query.level || "";
        const serviceName = query.serviceName || "";
        const loggerName = query.loggerName || "";
        const keyword = query.keyword || "";
        const result = await db.getAppLogs(page, pageSize, {
          traceId,
          spanId,
          level,
          serviceName,
          loggerName,
          keyword
        });
        jsonResponse({ success: true, ...result });
        return;
      }
      if (pathname === "/api/trace-summary-list") {
        const page = parseInt(query.page || "1", 10);
        const pageSize = parseInt(query.pageSize || "20", 10);
        const keyword = query.keyword || "";
        const minCostMs = parseFloat(query.minCostMs || "0");
        const result = await db.getTraceSummaryList(page, pageSize, keyword, minCostMs);
        jsonResponse({ success: true, ...result });
        return;
      }
      if (pathname === "/api/diagnostics") {
        const traceId = query.traceId || "";
        const page = parseInt(query.page || "1", 10);
        const pageSize = parseInt(query.pageSize || "20", 10);
        const minRepeat = parseInt(query.minRepeatCount || "5", 10);
        const keyword = query.keyword || "";
        const result = await db.getDiagnostics(traceId, page, pageSize, minRepeat, keyword);
        jsonResponse({ success: true, ...result });
        return;
      }
      if (pathname === "/api/top-repeated") {
        const page = parseInt(query.page || "1", 10);
        const pageSize = parseInt(query.pageSize || "20", 10);
        const keyword = query.keyword || "";
        const result = await db.getTopRepeated(page, pageSize, keyword);
        jsonResponse({ success: true, ...result });
        return;
      }
      if (pathname === "/api/top-slow") {
        const page = parseInt(query.page || "1", 10);
        const pageSize = parseInt(query.pageSize || "20", 10);
        const traceId = query.traceId || "";
        const minCostMs = parseFloat(query.minCostMs || "0");
        const keyword = query.keyword || "";
        const result = await db.getTopSlow(page, pageSize, traceId, minCostMs, keyword);
        jsonResponse({ success: true, ...result });
        return;
      }
      if (pathname === "/api/trace") {
        const traceId = query.traceId || "";
        const page = parseInt(query.page || "1", 10);
        const pageSize = parseInt(query.pageSize || "50", 10);
        const result = await db.getTrace(traceId, page, pageSize);
        jsonResponse({ success: true, ...result });
        return;
      }
      if (pathname === "/api/by-template") {
        const sqlTemplate = query.sqlTemplate || "";
        const page = parseInt(query.page || "1", 10);
        const pageSize = parseInt(query.pageSize || "50", 10);
        const traceId = query.traceId || "";
        const dbManager = query.dbManager || "";
        const result = await db.getByTemplate(sqlTemplate, page, pageSize, traceId, dbManager);
        jsonResponse({ success: true, ...result });
        return;
      }
      if (pathname === "/api/decompress-gz") {
        const gzPath = query.filePath || "";
        if (!gzPath || !import_fs7.default.existsSync(gzPath)) {
          jsonResponse({ success: false, error: "\u6587\u4EF6\u4E0D\u5B58\u5728" }, 404);
          return;
        }
        if (!gzPath.endsWith(".gz")) {
          jsonResponse({ success: true, decompressedPath: gzPath });
          return;
        }
        const tmpDir = import_path7.default.join(import_os5.default.tmpdir(), "parselog_decompressed");
        if (!import_fs7.default.existsSync(tmpDir)) import_fs7.default.mkdirSync(tmpDir, { recursive: true });
        const baseName = import_path7.default.basename(gzPath).replace(/\.gz$/, "");
        const targetPath = import_path7.default.join(tmpDir, baseName);
        if (!import_fs7.default.existsSync(targetPath)) {
          const buffer = import_fs7.default.readFileSync(gzPath);
          const decompressed = import_zlib3.default.gunzipSync(buffer);
          import_fs7.default.writeFileSync(targetPath, decompressed);
        }
        jsonResponse({ success: true, decompressedPath: targetPath });
        return;
      }
      const handled = serveStatic(req, res, staticDir);
      if (!handled) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
      }
    } catch (err) {
      jsonResponse({ success: false, error: err.message || String(err) }, 500);
    }
  });
  function startListen(p) {
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.log(`\u26A0\uFE0F \u7AEF\u53E3 ${p} \u5DF2\u88AB\u5360\u7528\uFF0C\u6B63\u5728\u5C1D\u8BD5\u7AEF\u53E3 ${p + 1}...`);
        startListen(p + 1);
      } else {
        console.error("\u274C HTTP \u670D\u52A1\u542F\u52A8\u5931\u8D25:", err);
      }
    });
    server.listen(p, () => {
      const url = `http://localhost:${p}`;
      console.log(`
==================================================`);
      console.log(`\u{1F680} SQL \u65E5\u5FD7\u5206\u6790\u5668\u63A7\u5236\u53F0\u5DF2\u6210\u529F\u542F\u52A8: ${url}`);
      console.log(`==================================================
`);
      if (process.env.NODE_ENV !== "test" && !process.env.VITEST) {
        const openCmd = process.platform === "win32" ? `start ${url}` : process.platform === "darwin" ? `open ${url}` : `xdg-open ${url}`;
        (0, import_child_process.exec)(openCmd, () => {
        });
      }
    });
  }
  startListen(port);
  return server;
}

// src/cli.ts
var import_path8 = __toESM(require("path"));
var import_fs8 = __toESM(require("fs"));
var DEFAULT_LOG_DIR = `D:\\Users\\boke\\Desktop\\source\\bokeerp\\erp-backend\\logs`;
async function main() {
  console.log(`
==================================================`);
  console.log(`\u26A1 \u6781\u901F\u5168\u94FE\u8DEF\u65E5\u5FD7\u4E0E\u6027\u80FD\u5206\u6790\u5668 (parselog CLI - TypeScript & Vue 3)`);
  console.log(`==================================================`);
  const args = process.argv.slice(2);
  let targetPath = "";
  if (args[0]) {
    targetPath = import_path8.default.resolve(args[0]);
  } else {
    const cwd = process.cwd();
    let hasLocalLogs = false;
    try {
      const files = import_fs8.default.readdirSync(cwd);
      hasLocalLogs = files.some((f) => f.endsWith(".log"));
    } catch (e) {
    }
    if (hasLocalLogs) {
      targetPath = cwd;
    } else if (import_fs8.default.existsSync(DEFAULT_LOG_DIR)) {
      targetPath = DEFAULT_LOG_DIR;
    } else {
      targetPath = cwd;
    }
  }
  console.log(`
\u{1F4C2} \u6B63\u5728\u626B\u63CF\u65E5\u5FD7\u8DEF\u5F84: ${targetPath}`);
  const startTime = Date.now();
  const db = new SqlLogDatabase(":memory:");
  await db.initSchema();
  let batch = [];
  const BATCH_SIZE = 1e4;
  let perfBatch = [];
  const PERF_BATCH_SIZE = 50;
  const parseResult = await parseLogs(
    targetPath,
    (record) => {
      batch.push(record);
      if (batch.length >= BATCH_SIZE) {
        const toInsert = batch;
        batch = [];
        return db.insertBatch(toInsert);
      }
    },
    (perfData) => {
      perfBatch.push(perfData);
      if (perfBatch.length >= PERF_BATCH_SIZE) {
        const toInsert = perfBatch;
        perfBatch = [];
        return db.insertPerfBatch(toInsert);
      }
    },
    null
    // 启动时不全量加载 app_logs，改用存根按需惰性切片装载
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
  console.log(`
\u2705 \u89E3\u6790\u5B8C\u6210\uFF01\u6570\u636E\u5DF2\u88C5\u8F7D\u81F3 DuckDB \u5185\u5B58\u5206\u6790\u5F15\u64CE`);
  console.log(`--------------------------------------------------`);
  console.log(`\u2022 \u8017\u65F6: ${costMs} ms`);
  console.log(`\u2022 \u65E5\u5FD7\u6587\u4EF6\u6570: ${parseResult.totalFiles}`);
  console.log(`\u2022 \u626B\u63CF\u65E5\u5FD7\u884C\u6570: ${parseResult.totalLines.toLocaleString()}`);
  console.log(`\u2022 \u7ED3\u6784\u5316 SQL \u8BB0\u5F55: ${parseResult.totalRecords.toLocaleString()} \u6761`);
  if (parseResult.totalPerfTraces > 0) {
    console.log(`\u2022 \u6027\u80FD\u5256\u6790\u6811 (ActionRecorder): ${parseResult.totalPerfTraces.toLocaleString()} \u7B14\u5B8C\u6574\u8BF7\u6C42`);
  }
  if (parseResult.traceStubs && parseResult.traceStubs.length > 0) {
    console.log(`\u2022 \u7EAF\u51C0\u65E5\u5FD7\u7D22\u5F15 (\u8D77\u6B62\u884C\u5B58\u6839): ${parseResult.traceStubs.length.toLocaleString()} \u7B14 Trace (\u6309\u9700\u60F0\u6027\u79D2\u7EA7\u52A0\u8F7D)`);
  }
  createServer(db, parseResult, 3e3);
}
main().catch((err) => {
  console.error("Fatal execution error:", err);
  process.exit(1);
});

// src/index.ts
var src_default = {
  SqlLogDatabase,
  parseLogs,
  parseLogFile,
  createServer
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AppLogDao,
  DbConnection,
  INIT_SCHEMA_SQL,
  PerfDao,
  SqlDao,
  SqlLogDatabase,
  calculatePerfTraceMetrics,
  cleanSqlText,
  compressSqlColumns,
  createServer,
  extractLogLines,
  isLogHeader,
  main,
  parseActionLine,
  parseLogFile,
  parseLogHeader,
  parseLogs,
  parseSqlExecutionInfo,
  parseTimeToMs,
  serveStatic
});
//# sourceMappingURL=index.js.map