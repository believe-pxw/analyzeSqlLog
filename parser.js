const fs = require('fs');
const readline = require('readline');
const path = require('path');
const zlib = require('zlib');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');

/**
 * 高性能解析时间耗时字符串 (如 "0ms", "3165ms/TimeCostLevel100ms200ms500ms1s2s", "1.5s/TimeCostLevel...")
 * 自动识别并截取 '/' 前面的真正耗时数值
 */
function parseTimeToMs(timeStr) {
    if (!timeStr) return 0;
    const slashIdx = timeStr.indexOf('/');
    const cleanStr = slashIdx !== -1 ? timeStr.substring(0, slashIdx).trim() : timeStr.trim();
    const val = parseFloat(cleanStr);
    if (isNaN(val)) return 0;
    if (cleanStr.endsWith('s') || cleanStr.endsWith('S')) {
        if (cleanStr.endsWith('ms') || cleanStr.endsWith('MS')) {
            return Math.round(val);
        }
        return Math.round(val * 1000);
    }
    if (cleanStr.endsWith('m') || cleanStr.endsWith('M')) {
        return Math.round(val * 60000);
    }
    return Math.round(val);
}

/**
 * 高性能快速判定行首是否为标准日志 Header (格式: 2026-08-12 13:44:26...)
 */
function isLogHeader(line) {
    if (line.length < 19) return false;
    return line.charCodeAt(4) === 45 &&  // '-'
           line.charCodeAt(7) === 45 &&  // '-'
           line.charCodeAt(10) === 32 && // ' '
           line.charCodeAt(13) === 58 && // ':'
           line.charCodeAt(16) === 58;   // ':'
}

/**
 * 高性能从日志 Header 行中提取标准 13 维元数据 (依据 LOG_FORMAT_SPEC.md 规范)
 * 格式: Time NanoTime Level [ServiceName] [InstanceName] [IpAddress] [HostName] [TraceId] [SpanId] [ParentSpanId] [Thread] LoggerName Msg
 */
function parseLogHeader(line) {
    const len = line.length;
    const logTime = len >= 23 ? line.substring(0, 23) : line;
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

    let firstBracketIdx = -1;
    let bracketCount = 0;
    let start = -1;
    let lastBracketCloseIdx = -1;

    for (let i = 23; i < len; i++) {
        const c = line.charCodeAt(i);
        if (c === 91) { // '['
            if (firstBracketIdx === -1) firstBracketIdx = i;
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

    // 容错：如果方括号在索引 23 之前（极端非标准格式）
    if (firstBracketIdx === -1) {
        firstBracketIdx = line.indexOf('[');
    }

    if (firstBracketIdx > 23) {
        let p = 23;
        while (p < firstBracketIdx && line.charCodeAt(p) === 32) p++;
        let endP = firstBracketIdx - 1;
        while (endP > p && line.charCodeAt(endP) === 32) endP--;

        if (p <= endP) {
            const middle = line.substring(p, endP + 1);
            const spaceIdx = middle.indexOf(' ');
            if (spaceIdx === -1) {
                level = middle;
            } else {
                nanoTime = middle.substring(0, spaceIdx);
                let p2 = spaceIdx + 1;
                while (p2 < middle.length && middle.charCodeAt(p2) === 32) p2++;
                level = middle.substring(p2);
            }
        }
    }

    if (lastBracketCloseIdx !== -1 && lastBracketCloseIdx < len - 1) {
        let startPos = lastBracketCloseIdx + 1;
        while (startPos < len && line.charCodeAt(startPos) === 32) startPos++;
        if (startPos < len) {
            const spaceIdx = line.indexOf(' ', startPos);
            if (spaceIdx !== -1) {
                loggerName = line.substring(startPos, spaceIdx);
                let msgStart = spaceIdx + 1;
                while (msgStart < len && line.charCodeAt(msgStart) === 32) msgStart++;
                message = line.substring(msgStart);
            } else {
                loggerName = line.substring(startPos);
                message = '';
            }
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

/**
 * 高性能清理 SQL 字符串中的 '>' 换行符前缀与包裹的结尾 ']'
 */
function cleanSqlText(text) {
    if (!text) return '';
    let str = text.replace(/(^|\n)\s*>\s*/g, '$1').trim();
    if (str.endsWith(']')) {
        str = str.replace(/\s*\]\s*$/, '').trim();
    }
    return str;
}

/**
 * 解析 ActionRecorder 格式单行
 */
function parseActionLine(line) {
    const cleanLine = line.startsWith('>') ? line.substring(1) : line;
    const parts = cleanLine.split('\t');
    if (parts.length < 5) return null;

    const rawLevel = parts[0];
    const level = parseInt(rawLevel.trim(), 10);
    if (isNaN(level)) return null;

    const timeUs = parseFloat(parts[1]) || 0;
    const selfTimeUs = parseFloat(parts[2]) || 0;
    const gapTimeUs = parseFloat(parts[3]) || 0;
    const actionName = parts.slice(4).join('\t').trim();

    return {
        level,
        time_us: timeUs,
        self_time_us: selfTimeUs,
        gap_time_us: gapTimeUs,
        time_ms: Math.round(timeUs / 10) / 100,
        self_time_ms: Math.round(selfTimeUs / 10) / 100,
        gap_time_ms: Math.round(gapTimeUs / 10) / 100,
        action_name: actionName,
        sql_text: ''
    };
}

/**
 * 极速流式日志解析器 (同时支持 SQL 日志、ActionRecorder 性能日志与通用应用日志)
 * @param {string} filePath - 日志文件路径
 * @param {Function} onRecord - 解析到完整 SQL 记录时的回调函数
 * @param {number} startRecordId - 起始 ID 偏移量
 * @param {Function} onPerfTrace - 解析到完整 Performance Trace 树时的回调函数
 * @param {Function} onAppLog - 解析到完整通用应用日志记录时的回调函数
 */
async function parseLogFile(filePath, onRecord, startRecordId = 0, onPerfTrace = null, onAppLog = null) {
    let inputStream;
    if (filePath.endsWith('.gz')) {
        inputStream = fs.createReadStream(filePath).pipe(zlib.createGunzip());
    } else {
        inputStream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 1024 * 1024 });
    }

    const rl = readline.createInterface({
        input: inputStream,
        crlfDelay: Infinity
    });

    let totalLines = 0;
    let totalRecords = startRecordId;
    let totalPerfTraces = 0;
    let totalAppLogs = 0;

    let currentRecord = null;
    let currentAppLog = null;
    let captureState = null; // 'sql_template' | 'full_sql' | null
    let lastHeaderInfo = {
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
        message: ''
    };

    // Performance ActionRecorder 状态机
    let inPerfBlock = false;
    let currentPerfTrace = null;
    let lastPerfAction = null;
    const seenPerfTraceIds = new Set();

    function allocateUniquePerfTraceId(traceId, spanId) {
        let candidate = (traceId && traceId !== '-') ? traceId : spanId;
        if (!candidate || candidate === '-') candidate = 'perf_trace';

        let uniqueId = candidate;
        if (seenPerfTraceIds.has(uniqueId)) {
            if (spanId && spanId !== '-' && spanId !== candidate && !seenPerfTraceIds.has(spanId)) {
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
                    if (res && typeof res.then === 'function') {
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
                if (res && typeof res.then === 'function') {
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

        const actions = currentPerfTrace.actions;
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
            a.parent_id = a.level > 0 ? (levelStack[a.level - 1] ?? -1) : -1;

            totalGapTimeMs += a.gap_time_ms;

            if (a.action_name.startsWith('QueryDatabase/')) {
                totalSqlCount++;
                totalSqlTimeMs += a.time_ms;
                a.action_category = 'sql';
            } else if (a.action_name === 'DB commit' || a.action_name === 'submit') {
                totalCommitTimeMs += a.time_ms;
                a.action_category = 'commit';
            } else {
                a.action_category = 'biz';
            }
        });

        const rootAction = actions.find(a => a.level === 0) || actions[0];
        const firstService = actions.find(a => a.level === 1) || { action_name: '-' };

        const totalTimeMs = rootAction ? rootAction.time_ms : 0;
        const selfTimeMs = rootAction ? rootAction.self_time_ms : 0;
        const bizTimeMs = Math.max(0, Math.round((totalTimeMs - totalSqlTimeMs - totalCommitTimeMs) * 100) / 100);

        const traceSummary = {
            id: 0,
            trace_id: currentPerfTrace.trace_id,
            log_time: currentPerfTrace.log_time,
            thread_name: currentPerfTrace.thread_name,
            root_action: rootAction ? rootAction.action_name : 'MidVEFilter.doFilter',
            service_name: firstService ? firstService.action_name : '-',
            total_time_ms: totalTimeMs,
            self_time_ms: selfTimeMs,
            gap_time_ms: Math.round(totalGapTimeMs * 100) / 100,
            biz_time_ms: bizTimeMs,
            sql_time_ms: Math.round(totalSqlTimeMs * 100) / 100,
            commit_time_ms: Math.round(totalCommitTimeMs * 100) / 100,
            action_count: actions.length,
            sql_count: totalSqlCount,
            max_depth: maxDepth,
            source_file: currentPerfTrace.source_file,
            line_number: currentPerfTrace.line_number
        };

        totalPerfTraces++;
        if (onPerfTrace) {
            const res = onPerfTrace({ trace: traceSummary, actions });
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

            // 无论任何类名的 Header，都记忆更新最近的 Header 上下文
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
                    source_file: path.resolve(filePath)
                };
            }

            // 判断是否是 ActionRecorder 性能日志
            if (line.includes('com.bokesoft.erp.performance.ActionRecorder')) {
                inPerfBlock = true;

                // 如果已有正在构建的性能树，但属于不同线程，立即闭合前一笔
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
                        actions: []
                    };
                }
                lastPerfAction = null;
                continue;
            }

            // 非 ActionRecorder 的日志 Header，结束当前 perfBlock
            if (currentPerfTrace) {
                // 如果是其他类名日志，若出现不同线程的日志，或者属于当前线程的其他日志，闭合当前性能树
                if (lastHeaderInfo.threadName === currentPerfTrace.thread_name) {
                    await flushPerfTrace();
                }
            }
            inPerfBlock = false;
            lastPerfAction = null;

            // 判断是否是 SQL 相关的日志 Header
            const isSqlLogHeader = line.includes('PreparedStatementWithLog') || 
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
                    source_file: path.resolve(filePath)
                };
            }
            continue;
        }

        // ==================== ActionRecorder 性能日志行解析 ====================
        if (inPerfBlock) {
            if (line.includes('================================================================================') ||
                line.includes('Level\tTime(0.001ms)')) {
                continue;
            }

            if (line.startsWith('>')) {
                const parsedAction = parseActionLine(line);
                if (parsedAction) {
                    parsedAction.line_number = totalLines;
                    parsedAction.source_file = path.resolve(filePath);

                    // 如果遇到新的 Level 0 动作，且当前已有动作节点，说明开启了新请求
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
                            actions: []
                        };
                    }

                    if (currentPerfTrace) {
                        currentPerfTrace.actions.push(parsedAction);
                    }
                    lastPerfAction = parsedAction;
                } else if (lastPerfAction) {
                    // 多行 SQL 文本追加
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
                    source_file: path.resolve(filePath)
                };
            } else {
                continue;
            }
        }

        // 解析 SQL执行信息
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
                    source_file: path.resolve(filePath)
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

        // 解析 SQL语句:
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
                    source_file: path.resolve(filePath)
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

        // 解析 SQL参数:
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

        // 解析 完整SQL:
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

        // 多行追加逻辑
        if (captureState === 'sql_template') {
            currentRecord.sql_template += '\n' + line;
        } else if (captureState === 'full_sql') {
            currentRecord.full_sql += '\n' + line;
        }
    }

    await flushCurrent();
    await flushPerfTrace();
    await flushAppLog();

    return { totalLines, totalRecords: totalRecords - startRecordId, totalPerfTraces, totalAppLogs };
}

/**
 * 遍历扫描指定目录/文件列表 (支持多核 Worker 线程池并行深度扫描)
 */
async function parseLogs(targetPath, onRecord, onPerfTrace = null, onAppLog = null) {
    let files = [];

    function collectFiles(dirOrFilePath) {
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
        return { totalFiles: 0, totalLines: 0, totalRecords: 0, totalPerfTraces: 0, totalAppLogs: 0 };
    }

    // 🚀 极限性能拉满：解锁全 CPU 核心全速并发解析
    const cpuCount = os.cpus() ? os.cpus().length : 4;
    const maxWorkers = Math.min(cpuCount, files.length);

    // 单文件或 Worker 内部或单核设备降级处理
    if (files.length <= 1 || !isMainThread || maxWorkers <= 1) {
        let grandTotalLines = 0;
        let grandTotalRecords = 0;
        let grandTotalPerfTraces = 0;
        let grandTotalAppLogs = 0;

        for (const file of files) {
            const result = await parseLogFile(file, onRecord, grandTotalRecords, onPerfTrace, onAppLog);
            grandTotalLines += result.totalLines;
            grandTotalRecords += result.totalRecords;
            grandTotalPerfTraces += (result.totalPerfTraces || 0);
            grandTotalAppLogs += (result.totalAppLogs || 0);
        }

        return {
            totalFiles: files.length,
            totalLines: grandTotalLines,
            totalRecords: grandTotalRecords,
            totalPerfTraces: grandTotalPerfTraces,
            totalAppLogs: grandTotalAppLogs
        };
    }

    // 🚀 多核 Worker 线程池全速分发处理
    const chunks = Array.from({ length: maxWorkers }, () => []);
    files.forEach((f, idx) => chunks[idx % maxWorkers].push(f));

    let grandTotalLines = 0;
    let grandTotalRecords = 0;
    let grandTotalPerfTraces = 0;
    let grandTotalAppLogs = 0;

    const workerPromises = chunks.map((workerFiles) => {
        return new Promise((resolve, reject) => {
            if (workerFiles.length === 0) return resolve();

            const worker = new Worker(__filename, {
                workerData: { files: workerFiles, hasAppLogCallback: !!onAppLog }
            });

            let pendingBatchPromise = Promise.resolve();

            worker.on('message', (msg) => {
                if (msg.type === 'batch') {
                    pendingBatchPromise = pendingBatchPromise.then(async () => {
                        const records = msg.records;
                        const len = records.length;
                        for (let i = 0; i < len; i++) {
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
                        const logs = msg.logs;
                        const len = logs.length;
                        for (let i = 0; i < len; i++) {
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
                } else if (msg.type === 'done') {
                    grandTotalLines += msg.totalLines;
                    pendingBatchPromise.then(() => resolve()).catch(reject);
                }
            });

            worker.on('error', reject);
            worker.on('exit', (code) => {
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
        totalAppLogs: grandTotalAppLogs
    };
}

// 🚀 Worker 线程独立子进程入口
if (!isMainThread && workerData && workerData.files) {
    (async () => {
        let totalLines = 0;
        let totalRecords = 0;
        let totalPerfTraces = 0;
        let totalAppLogs = 0;
        const wantAppLogs = !!workerData.hasAppLogCallback;

        for (const file of workerData.files) {
            let batch = [];
            let appLogBatch = [];
            const result = await parseLogFile(
                file,
                async (record) => {
                    batch.push(record);
                    if (batch.length >= 10000) {
                        parentPort.postMessage({ type: 'batch', records: batch });
                        batch = [];
                    }
                },
                0,
                async (perfData) => {
                    parentPort.postMessage({ type: 'perf_trace', data: perfData });
                },
                wantAppLogs ? async (appLog) => {
                    appLogBatch.push(appLog);
                    if (appLogBatch.length >= 5000) {
                        parentPort.postMessage({ type: 'app_log_batch', logs: appLogBatch });
                        appLogBatch = [];
                    }
                } : null
            );

            if (batch.length > 0) {
                parentPort.postMessage({ type: 'batch', records: batch });
                batch = [];
            }
            if (appLogBatch.length > 0) {
                parentPort.postMessage({ type: 'app_log_batch', logs: appLogBatch });
                appLogBatch = [];
            }

            totalLines += result.totalLines;
            totalRecords += result.totalRecords;
            totalPerfTraces += (result.totalPerfTraces || 0);
            totalAppLogs += (result.totalAppLogs || 0);
        }
        parentPort.postMessage({ type: 'done', totalLines, totalRecords, totalPerfTraces, totalAppLogs });
    })();
}

module.exports = {
    isLogHeader,
    parseLogHeader,
    parseLogs,
    parseLogFile,
    parseTimeToMs,
    cleanSqlText,
    parseActionLine
};
