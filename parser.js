const fs = require('fs');
const readline = require('readline');
const path = require('path');

/**
 * 解析时间耗时字符串 (如 "0ms", "3165ms/TimeCostLevel100ms200ms500ms1s2s", "1.5s/TimeCostLevel...")
 * 自动识别并截取 '/' 前面的真正耗时数值
 */
function parseTimeToMs(timeStr) {
    if (!timeStr) return 0;
    // 取 '/' 左侧的核心耗时部分
    const cleanStr = timeStr.trim().split('/')[0].trim();
    const match = cleanStr.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i);
    if (!match) return 0;
    const val = parseFloat(match[1]);
    const unit = (match[2] || 'ms').toLowerCase();
    if (unit === 's') return Math.round(val * 1000);
    if (unit === 'm') return Math.round(val * 60000);
    return Math.round(val);
}

/**
 * 从日志 Header 行中提取 时间、TraceID、线程名
 */
function parseLogHeader(line) {
    // 匹配时间戳: 2026-08-12 13:12:00.062
    const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})/);
    const logTime = timeMatch ? timeMatch[1] : '';

    // 提取所有 [] 中的中括号内容
    const bracketMatches = [];
    const re = /\[([^\]]+)\]/g;
    let m;
    while ((m = re.exec(line)) !== null) {
        bracketMatches.push(m[1]);
    }

    // 根据约定: brackets[4] 为 TraceID, brackets[7] 为 线程名
    let traceId = bracketMatches.length >= 5 ? bracketMatches[4] : '-';
    let threadName = bracketMatches.length >= 8 ? bracketMatches[7] : '-';

    return { logTime, traceId, threadName };
}

/**
 * 清理 SQL 字符串中的 '>' 换行符前缀与包裹的结尾 ']'
 */
function cleanSqlText(text) {
    if (!text) return '';
    // 按行拆分，处理每行的前置 '>' 字符
    const lines = text.split('\n').map(l => {
        return l.replace(/^\s*>\s*/, '').trim();
    }).filter(l => l.length > 0);

    let result = lines.join('\n');
    
    // 移除尾部未闭合的多余 ']' 字符
    result = result.replace(/\s*\]\s*$/, '').trim();
    return result;
}

/**
 * 极速流式日志解析器
 * @param {string} filePath - 日志文件路径
 * @param {function} onRecord - 每解析完一条 SQL 结构化记录时的回调函数
 * @returns {Promise<{totalLines: number, totalRecords: number}>}
 */
async function parseLogFile(filePath, onRecord) {
    const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8', highWaterMark: 64 * 1024 });
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let totalLines = 0;
    let totalRecords = 0;

    let currentRecord = null;
    let captureState = null; // 'sql_template' | 'full_sql' | null

    function flushCurrent() {
        if (currentRecord) {
            currentRecord.sql_template = cleanSqlText(currentRecord.sql_template);
            currentRecord.full_sql = cleanSqlText(currentRecord.full_sql);

            // 若只有其中一种，进行互相补充
            if (!currentRecord.sql_template && currentRecord.full_sql) {
                currentRecord.sql_template = currentRecord.full_sql;
            }
            if (!currentRecord.full_sql && currentRecord.sql_template) {
                currentRecord.full_sql = currentRecord.sql_template;
            }

            // 只有包含有效 SQL 的记录才算数
            if (currentRecord.sql_template || currentRecord.full_sql) {
                totalRecords++;
                currentRecord.id = totalRecords;
                onRecord(currentRecord);
            }
        }
        currentRecord = null;
        captureState = null;
    }

    for await (const rawLine of rl) {
        totalLines++;
        const line = rawLine;

        // 判定是否是标准日志 Header 行 (时间戳开头: 2026-08-12 13:44:26...)
        const isAnyLogHeader = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}/.test(line);

        if (isAnyLogHeader) {
            // 一旦遇到任何新日志 Header，必然刷新闭合前一条 SQL 记录
            flushCurrent();

            // 判断是否是 SQL 相关的日志 Header
            const isSqlLogHeader = line.includes('PreparedStatementWithLog') || line.includes('SQLLogUtils') || line.includes('SQL执行信息');

            if (isSqlLogHeader) {
                const headerInfo = parseLogHeader(line);
                currentRecord = {
                    id: 0,
                    log_time: headerInfo.logTime,
                    trace_id: headerInfo.traceId,
                    thread_name: headerInfo.threadName,
                    exec_time_ms: 0,
                    result_rows: 0,
                    db_manager: '',
                    sql_template: '',
                    sql_params: '',
                    full_sql: ''
                };
            }
            continue;
        }

        // 非 Header 行逻辑
        if (!currentRecord) {
            if (line.includes('SQL执行信息:')) {
                currentRecord = {
                    id: 0,
                    log_time: '',
                    trace_id: '-',
                    thread_name: '-',
                    exec_time_ms: 0,
                    result_rows: 0,
                    db_manager: '',
                    sql_template: '',
                    sql_params: '',
                    full_sql: ''
                };
            } else {
                // 不处于 SQL 录制状态且非 SQL 标志行，忽略
                continue;
            }
        }

        // 解析 SQL执行信息
        if (line.includes('SQL执行信息:')) {
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

    flushCurrent();
    return { totalLines, totalRecords };
}

/**
 * 遍历扫描指定目录/文件列表 (专一只扫描 info 和 error 文件)
 */
async function parseLogs(targetPath, onRecord) {
    let files = [];
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
        const fileNames = fs.readdirSync(targetPath);
        for (const f of fileNames) {
            const isInfoOrError = /info|error/i.test(f);
            if ((f.endsWith('.log') || f.endsWith('.txt')) && isInfoOrError) {
                files.push(path.join(targetPath, f));
            }
        }
    } else {
        files.push(targetPath);
    }

    let grandTotalLines = 0;
    let grandTotalRecords = 0;

    for (const file of files) {
        const result = await parseLogFile(file, onRecord);
        grandTotalLines += result.totalLines;
        grandTotalRecords += result.totalRecords;
    }

    return { totalFiles: files.length, totalLines: grandTotalLines, totalRecords: grandTotalRecords };
}

module.exports = {
    parseLogs,
    parseLogFile,
    parseTimeToMs,
    cleanSqlText
};
