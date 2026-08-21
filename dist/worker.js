"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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

// src/parser/worker.ts
var import_worker_threads = require("worker_threads");

// src/parser/index.ts
var import_fs = __toESM(require("fs"));
var import_readline = __toESM(require("readline"));
var import_path = __toESM(require("path"));
var import_zlib = __toESM(require("zlib"));

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
  return str;
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

// src/parser/index.ts
async function parseLogFile(filePath, onRecord, startRecordId = 0, onPerfTrace, onAppLog, startAppLogId = 0) {
  let inputStream;
  if (filePath.endsWith(".gz")) {
    inputStream = import_fs.default.createReadStream(filePath).pipe(import_zlib.default.createGunzip());
  } else {
    inputStream = import_fs.default.createReadStream(filePath, { encoding: "utf-8", highWaterMark: 1024 * 1024 });
  }
  const rl = import_readline.default.createInterface({
    input: inputStream,
    crlfDelay: Infinity
  });
  let totalLines = 0;
  let totalRecords = startRecordId;
  let totalPerfTraces = 0;
  let totalAppLogs = startAppLogId;
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
  function allocateUniquePerfTraceId(traceId, spanId) {
    let candidate = traceId && traceId !== "-" ? traceId : spanId;
    if (!candidate || candidate === "-") candidate = "perf_trace";
    let uniqueId = candidate;
    if (seenPerfTraceIds.has(uniqueId)) {
      if (spanId && spanId !== "-" && spanId !== candidate && !seenPerfTraceIds.has(spanId)) {
        uniqueId = spanId;
      } else {
        let counter = 2;
        while (seenPerfTraceIds.has(`${candidate}_#${counter}`)) {
          counter++;
        }
        uniqueId = `${candidate}_#${counter}`;
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
      totalAppLogs++;
      currentAppLog.id = totalAppLogs;
      if (onAppLog) {
        const res = onAppLog(currentAppLog);
        if (res && typeof res.then === "function") {
          await res;
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
          source_file: import_path.default.resolve(filePath)
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
            source_file: import_path.default.resolve(filePath),
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
          source_file: import_path.default.resolve(filePath)
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
          parsedAction.source_file = import_path.default.resolve(filePath);
          if (parsedAction.level === 0 && currentPerfTrace && currentPerfTrace.actions.length > 0) {
            const oldLogTime = currentPerfTrace.log_time;
            const oldThread = currentPerfTrace.thread_name;
            await flushPerfTrace();
            const uniqueTraceId = allocateUniquePerfTraceId(lastHeaderInfo.traceId, lastHeaderInfo.spanId);
            currentPerfTrace = {
              trace_id: uniqueTraceId,
              log_time: oldLogTime,
              thread_name: oldThread,
              source_file: import_path.default.resolve(filePath),
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
          source_file: import_path.default.resolve(filePath)
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
          source_file: import_path.default.resolve(filePath)
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
          source_file: import_path.default.resolve(filePath)
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
  return { totalLines, totalRecords: totalRecords - startRecordId, totalPerfTraces, totalAppLogs: totalAppLogs - startAppLogId };
}

// src/parser/worker.ts
if (import_worker_threads.parentPort && import_worker_threads.workerData) {
  (async () => {
    const { files, hasAppLogCallback } = import_worker_threads.workerData;
    let workerBatch = [];
    const WORKER_BATCH_SIZE = 1e4;
    let workerAppLogBatch = [];
    const WORKER_APP_LOG_BATCH_SIZE = 5e3;
    let totalWorkerLines = 0;
    for (const file of files) {
      const result = await parseLogFile(
        file,
        (record) => {
          workerBatch.push(record);
          if (workerBatch.length >= WORKER_BATCH_SIZE) {
            import_worker_threads.parentPort.postMessage({ type: "batch", records: workerBatch });
            workerBatch = [];
          }
        },
        0,
        (perfData) => {
          import_worker_threads.parentPort.postMessage({ type: "perf_trace", data: perfData });
        },
        hasAppLogCallback ? (appLog) => {
          workerAppLogBatch.push(appLog);
          if (workerAppLogBatch.length >= WORKER_APP_LOG_BATCH_SIZE) {
            import_worker_threads.parentPort.postMessage({ type: "app_log_batch", records: workerAppLogBatch });
            workerAppLogBatch = [];
          }
        } : null
      );
      totalWorkerLines += result.totalLines;
    }
    if (workerBatch.length > 0) {
      import_worker_threads.parentPort.postMessage({ type: "batch", records: workerBatch });
    }
    if (workerAppLogBatch.length > 0) {
      import_worker_threads.parentPort.postMessage({ type: "app_log_batch", records: workerAppLogBatch });
    }
    import_worker_threads.parentPort.postMessage({ type: "done", totalLines: totalWorkerLines });
  })().catch((err) => {
    console.error("Worker error:", err);
    process.exit(1);
  });
}
//# sourceMappingURL=worker.js.map