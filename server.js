const http = require('http');
const zlib = require('zlib');
const fs = require('fs');
const fsPath = require('path');
const os = require('os');

function safeJsonStringify(obj) {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? Number(value) : value
    );
}

/**
 * 强健无死角的列名精简算法：采用 \bfrom\b 锁定列名区间，只要包含逗号或列长度>15，100% 精准折叠！
 */
function compressSqlColumns(sql) {
    if (!sql) return '';
    const str = sql.trim();

    // 宽松匹配 select ... from 结构
    const match = str.match(/(select\s+)([\s\S]+?)(\s+from\b[\s\S]+)/i);
    if (match) {
        const selectHead = match[1];
        const cols = match[2];
        const fromTail = match[3];

        if (cols.includes(',') || cols.trim().length > 15) {
            return selectHead + '... ' + fromTail.trim();
        }
    }

    return str;
}

function attachBriefSql(rows, sqlKey = 'sql_template') {
    if (!rows || !Array.isArray(rows)) return [];
    return rows.map(r => ({
        ...r,
        brief_sql: compressSqlColumns(r.full_sql || r[sqlKey] || '')
    }));
}

function createServer(dbInstance, parseStats, port = 3000) {
    const server = http.createServer(async (req, res) => {
const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const pathname = parsedUrl.pathname;
        const query = Object.fromEntries(parsedUrl.searchParams);
        const method = req.method.toUpperCase();

        // 统一 CORS & JSON 响应
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (method === 'OPTIONS') {
            res.writeHead(204);
            return res.end();
        }

        // API 路由
        if (pathname.startsWith('/api/')) {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            try {
                if (pathname === '/api/summary' && method === 'GET') {
                    const summary = await dbInstance.getTotalSummary();
                    return res.end(safeJsonStringify({ success: true, data: { ...summary, parseStats } }));
                }

                if (pathname === '/api/top-repeated' && method === 'GET') {
                    const page = parseInt(query.page, 10) || 1;
                    const pageSize = parseInt(query.pageSize, 10) || 20;
                    const traceId = query.traceId || '';
                    const excludeBg = query.excludeBackground === 'true';
                    
                    const result = await dbInstance.getTopRepeated(page, pageSize, traceId, excludeBg);
                    const processedRows = attachBriefSql(result.rows, 'sql_template');
                    return res.end(safeJsonStringify({ success: true, data: processedRows, total: result.total, page: result.page, pageSize: result.pageSize }));
                }

                if (pathname === '/api/top-slow' && method === 'GET') {
                    const page = parseInt(query.page, 10) || 1;
                    const pageSize = parseInt(query.pageSize, 10) || 20;
                    const traceId = query.traceId || '';
                    const excludeBg = query.excludeBackground === 'true';

                    const result = await dbInstance.getTopSlow(page, pageSize, traceId, excludeBg);
                    const processedRows = attachBriefSql(result.rows, 'full_sql');
                    return res.end(safeJsonStringify({ success: true, data: processedRows, total: result.total, page: result.page, pageSize: result.pageSize }));
                }

                if (pathname === '/api/trace' && method === 'GET') {
                    const traceId = query.traceId || '';
                    const pageStr = query.page;
                    const page = pageStr ? (parseInt(pageStr, 10) || 1) : null;
                    const pageSize = parseInt(query.pageSize, 10) || 200;

                    const result = await dbInstance.getByTraceId(traceId, page, pageSize);
                    if (page === null) {
                        const processedRows = attachBriefSql(result, 'full_sql');
                        return res.end(safeJsonStringify({ success: true, data: processedRows }));
                    } else {
                        const processedRows = attachBriefSql(result.rows, 'full_sql');
                        return res.end(safeJsonStringify({
                            success: true,
                            data: processedRows,
                            total: result.total,
                            page: result.page,
                            pageSize: result.pageSize
                        }));
                    }
                }

                if (pathname === '/api/diagnostics' && method === 'GET') {
                    const traceId = query.traceId || '';
                    const rows = await dbInstance.getDiagnostics(traceId);
                    const processedRows = attachBriefSql(rows, 'sql_template');
                    return res.end(safeJsonStringify({ success: true, data: processedRows }));
                }

                if (pathname === '/api/by-template' && method === 'GET') {
                    const sqlTemplate = query.sqlTemplate || '';
                    const page = parseInt(query.page, 10) || 1;
                    const pageSize = parseInt(query.pageSize, 10) || 50;

                    const result = await dbInstance.getByTemplate(sqlTemplate, page, pageSize);
                    const processedRows = attachBriefSql(result.rows, 'full_sql');
                    return res.end(safeJsonStringify({
                        success: true, data: processedRows,
                        total: result.total, page: result.page, pageSize: result.pageSize
                    }));
                }

                if (pathname === '/api/decompress-gz' && method === 'GET') {
                    const gzFilePath = query.filePath || '';
                    if (!gzFilePath || !gzFilePath.endsWith('.gz')) {
                        res.writeHead(400);
                        return res.end(safeJsonStringify({ success: false, error: '无效的 .gz 文件路径' }));
                    }

                    const decompressDir = fsPath.join(os.tmpdir(), 'sqllog_decompressed');
                    if (!fs.existsSync(decompressDir)) {
                        fs.mkdirSync(decompressDir, { recursive: true });
                    }

                    const baseName = fsPath.basename(gzFilePath).replace(/\.gz$/i, '');
                    const decompressedPath = fsPath.join(decompressDir, baseName);

                    // 如果已解压过则直接返回
                    if (fs.existsSync(decompressedPath)) {
                        return res.end(safeJsonStringify({ success: true, decompressedPath: decompressedPath.replace(/\\/g, '/') }));
                    }

                    try {
                        const input = fs.createReadStream(gzFilePath);
                        const gunzip = zlib.createGunzip();
                        const output = fs.createWriteStream(decompressedPath);

                        await new Promise((resolve, reject) => {
                            input.pipe(gunzip).pipe(output);
                            output.on('finish', resolve);
                            output.on('error', reject);
                            gunzip.on('error', reject);
                            input.on('error', reject);
                        });

                        return res.end(safeJsonStringify({ success: true, decompressedPath: decompressedPath.replace(/\\/g, '/') }));
                    } catch (e) {
                        res.writeHead(500);
                        return res.end(safeJsonStringify({ success: false, error: '解压失败: ' + e.message }));
                    }
                }

                res.writeHead(404);
                return res.end(safeJsonStringify({ success: false, error: 'Endpoint not found' }));
            } catch (err) {
                res.writeHead(500);
                return res.end(safeJsonStringify({ success: false, error: err.message }));
            }
        }

        // 返回 Web Dashboard 前端页面
        if (pathname === '/' || pathname === '/index.html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.end(getDashboardHtml());
        }

        res.writeHead(404);
        res.end('Not Found');
    });

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️  端口 ${port} 已被占用，正在尝试端口 ${port + 1}...`);
            createServer(dbInstance, parseStats, port + 1);
        } else {
            console.error('Server 监听错误:', err);
        }
    });

    // 优雅退出处理
    const cleanup = () => {
        server.close(() => {
            process.exit(0);
        });
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);

    server.listen(port, () => {
        const actualPort = server.address().port;
        const url = `http://localhost:${actualPort}`;
        console.log(`\n==================================================`);
        console.log(`🚀 SQL 日志分析器控制台已成功启动: ${url}`);
        console.log(`==================================================\n`);
        if (process.env.NODE_ENV !== 'test' && port !== 0) {
            const { exec } = require('child_process');
            exec(`start ${url}`);
        }
    });

    return server;
}

function getDashboardHtml() {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SQL 日志分析器 - 极简白</title>
    <style>
        :root {
            --bg: #f8fafc;
            --panel-bg: #ffffff;
            --border: #cbd5e1;
            --accent: #0284c7;
            --accent-hover: #0369a1;
            --accent-green: #16a34a;
            --accent-red: #dc2626;
            --accent-yellow: #d97706;
            --text: #0f172a;
            --text-muted: #64748b;
            --shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            line-height: 1.4;
            padding: 10px 16px;
        }

        .container { max-width: 1600px; margin: 0 auto; }
        
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 16px;
            background: var(--panel-bg);
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            border-radius: 8px;
            margin-bottom: 10px;
        }

        .title { display: flex; align-items: center; gap: 10px; }
        .title h1 { font-size: 18px; font-weight: 700; color: #0284c7; }
        .badge { background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; border: 1px solid #bae6fd; }

        .tabs {
            display: flex;
            gap: 6px;
            margin-bottom: 10px;
            border-bottom: 2px solid var(--border);
            padding-bottom: 4px;
        }
        .tab-btn {
            background: transparent;
            border: 1px solid transparent;
            color: var(--text-muted);
            padding: 5px 13px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: background 0.15s, color 0.15s, border-color 0.15s;
        }
        .tab-btn:hover { color: var(--accent); background: #f1f5f9; }
        .tab-btn.active { color: var(--accent); background: #e0f2fe; border-color: #bae6fd; }

        .panel { display: none; }
        .panel.active { display: block; }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 12px;
            margin-bottom: 12px;
        }

        .stat-card {
            background: var(--panel-bg);
            border: 1px solid var(--border);
            box-shadow: var(--shadow);
            border-radius: 8px;
            padding: 14px 18px;
            display: flex;
            flex-direction: column;
        }
        .stat-card .label { font-size: 13px; color: var(--text-muted); font-weight: 500; }
        .stat-card .value { font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--text); }

        .toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .search-input {
            flex: 1;
            min-width: 180px;
            background: #ffffff;
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: 5px 10px;
            color: var(--text);
            font-size: 13px;
        }
        .search-input:focus { outline: none; border-color: var(--accent); }
        
        .filter-checkbox {
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 12.5px;
            color: #334155;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            background: #f1f5f9;
            padding: 5px 10px;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
        }

        .btn {
            background: var(--accent);
            color: #ffffff;
            border: none;
            padding: 5px 14px;
            border-radius: 6px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: background 0.15s;
        }
        .btn:hover { background: var(--accent-hover); }

        .table-container {
            background: var(--panel-bg);
            border: 1px solid var(--border);
            box-shadow: var(--shadow);
            border-radius: 8px;
            overflow-x: auto;
        }
        table { width: 100%; border-collapse: collapse; text-align: left; font-size: 12.5px; }
        th, td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; }
        th { background: #f8fafc; color: var(--text-muted); font-weight: 600; white-space: nowrap; }
        tr:hover { background: #f1f5f9; }

        .th-sortable {
            cursor: pointer;
            user-select: none;
            transition: color 0.15s, background 0.15s;
        }
        .th-sortable:hover {
            color: #0284c7;
            background: #e0f2fe;
        }
        .sort-icon {
            font-size: 11px;
            margin-left: 2px;
            color: #0284c7;
        }

        .sql-code {
            font-family: "Fira Code", Consolas, Monaco, monospace;
            background: #f8fafc;
            padding: 6px 10px;
            border-radius: 4px;
            color: #1e293b;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 110px;
            overflow-y: auto;
            border: 1px solid #cbd5e1;
            font-size: 12px;
            line-height: 1.35;
            cursor: pointer;
            transition: border-color 0.15s, background 0.15s;
            user-select: text;
        }
        .sql-code:hover {
            border-color: #0284c7;
            background: #f0f9ff;
        }

        .trace-link { color: var(--accent); font-weight: 600; text-decoration: none; cursor: pointer; }
        .trace-link:hover { text-decoration: underline; }

        .tag-slow { color: var(--accent-red); font-weight: 700; }
        .tag-freq { color: var(--accent-yellow); font-weight: 700; }

        /* 分页条 Pagination Bar */
        .pagination-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 14px;
            background: #ffffff;
            border-top: 1px solid var(--border);
            border-bottom-left-radius: 8px;
            border-bottom-right-radius: 8px;
        }
        .pagination-info { font-size: 12px; color: var(--text-muted); }
        .pagination-controls { display: flex; align-items: center; gap: 6px; }
        .page-btn {
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            color: #334155;
            padding: 3px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
        }
        .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .page-btn:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
        .page-select {
            padding: 2px 6px;
            border-radius: 4px;
            border: 1px solid #cbd5e1;
            background: #ffffff;
            font-size: 12px;
        }
        .diagnose-banner {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 6px;
            padding: 6px 12px;
            margin-bottom: 8px;
            color: #166534;
            font-size: 12.5px;
            line-height: 1.4;
        }

        /* 桌面级自定义右键菜单 Context Menu */
        .context-menu {
            position: fixed;
            background: #ffffff;
            border: 1px solid #cbd5e1;
            border-radius: 8px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            padding: 4px;
            display: none;
            z-index: 99999;
            min-width: 160px;
            font-size: 13px;
        }
        .context-menu-item {
            padding: 8px 14px;
            color: #1e293b;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.15s, color 0.15s;
        }
        .context-menu-item:hover {
            background: #e0f2fe;
            color: #0284c7;
        }

        /* 浮动 Toast 复制提示 */
        .toast {
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: #0284c7;
            color: #ffffff;
            padding: 8px 18px;
            border-radius: 20px;
            font-size: 13px;
            font-weight: 600;
            box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3);
            z-index: 999999;
            opacity: 0;
            transition: opacity 0.2s, transform 0.2s;
            pointer-events: none;
        }
        .toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(4px);
        }

        .btn-vscode {
            display: inline-block;
            background: #22c55e;
            color: #ffffff;
            border: none;
            padding: 2px 8px;
            border-radius: 4px;
            font-weight: 600;
            font-size: 11px;
            cursor: pointer;
            text-decoration: none;
            transition: background 0.15s;
            white-space: nowrap;
        }
        .btn-vscode:hover { background: #16a34a; color: #ffffff; }

        .btn-view-calls {
            background: #8b5cf6;
            color: #ffffff;
            border: none;
            padding: 2px 8px;
            border-radius: 4px;
            font-weight: 600;
            font-size: 11px;
            cursor: pointer;
            transition: background 0.15s;
            white-space: nowrap;
        }
        .btn-view-calls:hover { background: #7c3aed; }

        .detail-header {
            margin-bottom: 12px;
            padding: 10px 14px;
            background: rgba(139, 92, 246, 0.08);
            border-left: 4px solid #8b5cf6;
            border-radius: 4px;
            font-size: 13px;
            color: var(--text);
        }
        .detail-header code {
            background: #f1f5f9;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
            color: #475569;
        }
    </style>
</head>
<body>
    <div class="toast" id="toast">已成功复制到剪贴板！</div>

    <!-- 极简单项右键菜单：仅保留【📋 复制完整 SQL】 -->
    <div id="custom-context-menu" class="context-menu">
        <div class="context-menu-item" onclick="execContextMenuAction('copy-full')">📋 复制完整 SQL</div>
    </div>

    <div class="container">
        <header>
            <div class="title">
                <h1>SQL 日志分析器</h1>
                <span class="badge">DuckDB 纯内存极速分析版</span>
            </div>
            <div id="parse-time" style="font-size: 12px; color: var(--text-muted);">数据加载完成</div>
        </header>

        <!-- Tab 菜单：增加 data-tab 属性实现精准联动高亮 -->
        <div class="tabs">
            <button class="tab-btn active" data-tab="diagnose" onclick="switchTab('diagnose')">🔁 事务内重复 SQL (N+1) 诊断</button>
            <button class="tab-btn" data-tab="slow" onclick="switchTab('slow')">🐢 慢 SQL 排行</button>
            <button class="tab-btn" data-tab="trace" onclick="switchTab('trace')">🔗 Trace 链路分析</button>
            <button class="tab-btn" data-tab="repeated" onclick="switchTab('repeated')">📊 SQL 频次榜</button>
            <button class="tab-btn" data-tab="detail" onclick="switchTab('detail')">📋 SQL 调用明细</button>
            <button class="tab-btn" data-tab="overview" onclick="switchTab('overview')">📈 概览统计分析</button>
        </div>

        <!-- 1. N+1 诊断 Panel (默认 Active) -->
        <div id="panel-diagnose" class="panel active">
            <div class="diagnose-banner">
                <strong>💡 事务粒度 N+1 冗余诊断说明：</strong> 基于日志中 <code>dbManager</code> 内存对象句柄（如 <code>MySqlDBManager@7b2aa7e0</code>），抓取在【同一数据库事务内】重复执行 5 次及以上的 SQL 模板。
            </div>
            <div class="toolbar">
                <input type="text" id="trace-diagnose" class="search-input" style="max-width: 260px;" placeholder="按 TraceID 筛选 (可选)" oninput="loadDiagnostics()">
                <input type="text" id="search-diagnose" class="search-input" placeholder="搜索 SQL 模板关键词（如表名 EMM_...）" oninput="filterDiagnoseTable()">
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 50px;">#</th>
                            <th style="width: 200px;">TraceID</th>
                            <th style="width: 180px;">dbManager 事务句柄</th>
                            <th style="width: 130px;">同一事务内循环次数</th>
                            <th style="width: 110px;">事务内浪费耗时</th>
                            <th style="width: 160px;">诊断重构建议</th>
                            <th>SQL 模板 (左键: 展开/收起 | 右键: 复制完整 SQL)</th>
                            <th style="width: 80px;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="diagnose-tbody"><tr><td colspan="8" style="text-align: center;">加载中...</td></tr></tbody>
                </table>
            </div>
        </div>

        <!-- 2. 慢 SQL Panel -->
        <div id="panel-slow" class="panel">
            <div class="toolbar">
                <input type="text" id="trace-slow" class="search-input" style="max-width: 240px;" placeholder="按 TraceID 筛选 (可选)" oninput="loadSlow(1)">
                <input type="text" id="search-slow" class="search-input" placeholder="搜索慢 SQL 语句..." oninput="filterSlowTable()">
                <label class="filter-checkbox">
                    <input type="checkbox" id="chk-slow-bg" onchange="loadSlow(1)">
                    🚫 排除后台锁/定时任务
                </label>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 50px;">#</th>
                            <th style="width: 100px;">执行耗时</th>
                            <th style="width: 180px;">TraceID</th>
                            <th style="width: 150px;">时间</th>
                            <th style="width: 80px;">影响行数</th>
                            <th style="width: 130px;">日志定位</th>
                            <th>完整执行 SQL (左键: 展开/收起 | 右键: 复制完整 SQL)</th>
                        </tr>
                    </thead>
                    <tbody id="slow-tbody"><tr><td colspan="7" style="text-align: center;">加载中...</td></tr></tbody>
                </table>
                <div class="pagination-bar" id="slow-pagination"></div>
            </div>
        </div>

        <!-- 3. Trace 链路 Panel (展示单次请求天然时间日志顺序，顶部醒目引导至慢 SQL 排行) -->
        <div id="panel-trace" class="panel">
            <div style="margin-bottom: 12px; padding: 10px 14px; background: rgba(59, 130, 246, 0.08); border-left: 4px solid var(--accent); border-radius: 4px; font-size: 13px; color: var(--text); display: flex; align-items: center; justify-content: space-between;">
                <span>💡 <b>Trace 链路</b> 展示单次请求真实日志执行顺序（按时间升序）。如需按耗时寻找慢 SQL，请使用 <a style="color: var(--accent); font-weight: 600; cursor: pointer; text-decoration: underline;" onclick="switchTab('slow')">🐢 慢 SQL 排行</a> 面板。</span>
                <button class="btn" style="padding: 4px 12px; font-size: 12px;" onclick="switchTab('slow')">去慢 SQL 排行 ➔</button>
            </div>
            <div class="toolbar">
                <input type="text" id="trace-input" class="search-input" style="max-width: 300px;" placeholder="输入 TraceID (如 Main_9ckgsuc...)" onchange="loadTraceData(1)">
                <input type="text" id="search-trace-sql" class="search-input" placeholder="在当前 Trace 页中按 SQL 语句/关键词过滤" oninput="sortAndRenderTraceTable()">
                <button class="btn" onclick="loadTraceData(1)">搜索 Trace 链路</button>
            </div>
            <div id="trace-summary" style="margin-bottom: 8px; font-size: 13px; color: var(--accent); font-weight: 600;"></div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 50px;">序号</th>
                            <th style="width: 160px;">时间</th>
                            <th style="width: 110px;">耗时 (ms)</th>
                            <th style="width: 80px;">影响行数</th>
                            <th style="width: 130px;">日志定位</th>
                            <th>执行 SQL 语句 (左键: 展开/收起 | 右键: 复制完整 SQL)</th>
                        </tr>
                    </thead>
                    <tbody id="trace-tbody"><tr><td colspan="6" style="text-align: center;">请输入 TraceID 进行查询</td></tr></tbody>
            </div>
            <div class="pagination-bar" id="trace-pagination"></div>
        </div>

        <!-- 4. 频次榜 Panel (倒数第二) -->
        <div id="panel-repeated" class="panel">
            <div class="toolbar">
                <input type="text" id="trace-repeated" class="search-input" style="max-width: 240px;" placeholder="按 TraceID 筛选 (可选)" oninput="loadRepeated(1)">
                <input type="text" id="search-repeated" class="search-input" placeholder="搜索 SQL 模板关键词（如表名 BK_...）" oninput="filterRepeatedTable()">
                <label class="filter-checkbox">
                    <input type="checkbox" id="chk-repeated-bg" onchange="loadRepeated(1)">
                    🚫 排除后台锁/定时任务
                </label>
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 50px;">#</th>
                            <th style="width: 90px;">全局总次数</th>
                            <th style="width: 100px;">总耗时 (ms)</th>
                            <th style="width: 90px;">平均耗时</th>
                            <th style="width: 90px;">最大耗时</th>
                            <th style="width: 80px;">Trace 数</th>
                            <th>SQL 参数化模板 (左键: 展开/收起 | 右键: 复制完整 SQL)</th>
                            <th style="width: 80px;">操作</th>
                        </tr>
                    </thead>
                    <tbody id="repeated-tbody"><tr><td colspan="8" style="text-align: center;">加载中...</td></tr></tbody>
                </table>
                <div class="pagination-bar" id="repeated-pagination"></div>
            </div>
        </div>

        <!-- 5. SQL 调用明细 Panel -->
        <div id="panel-detail" class="panel">
            <div class="detail-header" id="detail-header">
                💡 从 <b>频次榜</b> 点击「查看调用」跳转到此面板，查看某条 SQL 模板的所有调用明细。
            </div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 50px;">#</th>
                            <th style="width: 160px;">时间</th>
                            <th style="width: 130px;">TraceID</th>
                            <th style="width: 90px;">耗时 (ms)</th>
                            <th style="width: 70px;">影响行数</th>
                            <th style="width: 130px;">日志定位</th>
                            <th>执行 SQL (左键: 展开/收起 | 右键: 复制完整 SQL)</th>
                        </tr>
                    </thead>
                    <tbody id="detail-tbody"><tr><td colspan="7" style="text-align: center; color: var(--text-muted);">请从频次榜点击「查看调用」按钮</td></tr></tbody>
                </table>
                <div class="pagination-bar" id="detail-pagination"></div>
            </div>
        </div>

        <!-- 6. 独立概览统计 Tab Panel (最后) -->
        <div id="panel-overview" class="panel">
            <div class="stats-grid">
                <div class="stat-card"><span class="label">分析 SQL 总数</span><span class="value" id="stat-total-sqls">-</span></div>
                <div class="stat-card"><span class="label">SQL 归一模板数</span><span class="value" id="stat-distinct-templates">-</span></div>
                <div class="stat-card"><span class="label">最高慢 SQL 耗时</span><span class="value" id="stat-max-cost" style="color: var(--accent-red);">-</span></div>
                <div class="stat-card"><span class="label">独立 Trace 动作数</span><span class="value" id="stat-total-traces" style="color: var(--accent-green);">-</span></div>
                <div class="stat-card"><span class="label">SQL 总执行耗时</span><span class="value" id="stat-total-time" style="color: var(--accent);">-</span></div>
                <div class="stat-card"><span class="label">SQL 平均执行耗时</span><span class="value" id="stat-avg-time">-</span></div>
            </div>
        </div>
    </div>

    <script>
        let rawRepeatedData = [];
        let rawSlowData = [];
        let rawTraceData = [];
        let rawDiagnoseData = [];

        let curRepeatedPage = 1;
        let curRepeatedPageSize = 20;
        let totalRepeatedCount = 0;

        let curSlowPage = 1;
        let curSlowPageSize = 20;
        let totalSlowCount = 0;

        let currentRightClickedDiv = null;

        // Trace 当前排序模式: 'time-asc' (默认时间升序) | 'time-desc' (时间降序) | 'cost-desc' (耗时降序) | 'cost-asc' (耗时升序)
        let traceSortMode = 'time-asc';

        async function init() {
            try {
                const res = await fetch('/api/summary');
                const json = await res.json();
                if (json.success) {
                    const d = json.data;
                    document.getElementById('stat-total-sqls').innerText = (d.total_sqls || 0).toLocaleString();
                    document.getElementById('stat-distinct-templates').innerText = (d.distinct_templates || 0).toLocaleString();
                    document.getElementById('stat-max-cost').innerText = (d.max_exec_time_ms || 0) + ' ms';
                    document.getElementById('stat-total-traces').innerText = (d.total_traces || 0).toLocaleString();
                    document.getElementById('stat-total-time').innerText = (d.total_exec_time_ms || 0) + ' ms';
                    document.getElementById('stat-avg-time').innerText = (d.avg_exec_time_ms || 0) + ' ms';
                    
                    if (d.parseStats) {
                        document.getElementById('parse-time').innerText = \`扫描 \${d.parseStats.totalFiles} 个文件, \${d.parseStats.totalLines.toLocaleString()} 行日志, 提取 \${d.parseStats.totalRecords.toLocaleString()} 条 SQL (耗时 \${d.parseStats.costMs} ms)\`;
                    }
                }
            } catch(e) {}

            loadDiagnostics();
            loadRepeated(1);
            loadSlow(1);
        }

        /**
         * 强健精准的 Tab 切换高亮控制器
         */
        function switchTab(name) {
            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.classList.remove('active');
                if (btn.getAttribute('data-tab') === name) {
                    btn.classList.add('active');
                }
            });
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            
            const targetPanel = document.getElementById('panel-' + name);
            if (targetPanel) targetPanel.classList.add('active');
        }

        /**
         * 左键：0ms 瞬间展开 / 收起
         */
        function handleSqlClick(div) {
            const fullSql = div.getAttribute('data-full');
            const briefSql = div.getAttribute('data-brief');
            if (!fullSql || !briefSql || briefSql === fullSql) return;

            const isExpanded = div.getAttribute('data-expanded') === 'true';
            if (isExpanded) {
                div.innerHTML = escapeHtml(briefSql);
                div.setAttribute('data-expanded', 'false');
            } else {
                div.innerHTML = escapeHtml(fullSql);
                div.setAttribute('data-expanded', 'true');
            }
        }

        /**
         * 右键：弹出极简单项【📋 复制完整 SQL】右键菜单
         */
        function handleSqlContextMenu(e, div) {
            e.preventDefault();
            e.stopPropagation();

            currentRightClickedDiv = div;
            const menu = document.getElementById('custom-context-menu');
            
            let x = e.clientX;
            let y = e.clientY;

            menu.style.display = 'block';
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;

            if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
            if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;

            menu.style.left = x + 'px';
            menu.style.top = y + 'px';
        }

        function execContextMenuAction(action) {
            if (!currentRightClickedDiv) return;
            const fullSql = currentRightClickedDiv.getAttribute('data-full') || '';

            if (action === 'copy-full') {
                copySqlText(fullSql);
            }
            hideContextMenu();
        }

        function copySqlText(text) {
            if (!text) return;
            navigator.clipboard.writeText(text).then(() => {
                showToast('📋 已成功复制完整 SQL 至剪贴板！');
            }).catch(() => {
                showToast('复制失败');
            });
        }

        function hideContextMenu() {
            const menu = document.getElementById('custom-context-menu');
            if (menu) menu.style.display = 'none';
        }

        let toastTimer = null;
        function showToast(msg) {
            const toast = document.getElementById('toast');
            toast.innerText = msg;
            toast.classList.add('show');
            if (toastTimer) clearTimeout(toastTimer);
            toastTimer = setTimeout(() => {
                toast.classList.remove('show');
            }, 2000);
        }

        document.addEventListener('click', hideContextMenu);
        document.addEventListener('scroll', hideContextMenu);

        async function loadRepeated(page = 1) {
            curRepeatedPage = page;
            const traceId = document.getElementById('trace-repeated').value.trim();
            const excludeBg = document.getElementById('chk-repeated-bg').checked;

            const res = await fetch(\`/api/top-repeated?page=\${curRepeatedPage}&pageSize=\${curRepeatedPageSize}&traceId=\${encodeURIComponent(traceId)}&excludeBackground=\${excludeBg}\`);
            const json = await res.json();
            if (json.success) {
                rawRepeatedData = json.data;
                totalRepeatedCount = json.total;
                renderRepeatedTable(rawRepeatedData);
                renderPagination('repeated-pagination', curRepeatedPage, curRepeatedPageSize, totalRepeatedCount, (p, ps) => {
                    curRepeatedPageSize = ps;
                    loadRepeated(p);
                });
            }
        }

        function renderRepeatedTable(data) {
            const tbody = document.getElementById('repeated-tbody');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center;">未找到符合条件的 SQL</td></tr>';
                return;
            }
            const offset = (curRepeatedPage - 1) * curRepeatedPageSize;
            tbody.innerHTML = data.map((r, i) => {
                const fullSql = r.sql_template || '';
                const briefSql = r.brief_sql || fullSql;

                return \`
                <tr>
                    <td>\${offset + i + 1}</td>
                    <td><span class="tag-freq">\${r.count} 次</span></td>
                    <td>\${r.total_time_ms} ms</td>
                    <td>\${r.avg_time_ms} ms</td>
                    <td>\${r.max_time_ms} ms</td>
                    <td>\${r.trace_count}</td>
                    <td>
                        <div class="sql-code" onclick="handleSqlClick(this)" oncontextmenu="handleSqlContextMenu(event, this)" title="左键: 0ms秒开展开/收起 | 右键: 复制完整 SQL" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
                    </td>
                    <td>
                        <button class="btn-view-calls" onclick="jumpToDetail('\${escapeJs(fullSql)}', { source: 'repeated', count: \${r.count} })">🔍 查看调用</button>
                    </td>
                </tr>
            \`;
            }).join('');
        }

        function filterRepeatedTable() {
            const q = document.getElementById('search-repeated').value.toLowerCase();
            const filtered = rawRepeatedData.filter(d => (d.sql_template || '').toLowerCase().includes(q));
            renderRepeatedTable(filtered);
        }

        async function loadSlow(page = 1) {
            curSlowPage = page;
            const traceId = document.getElementById('trace-slow').value.trim();
            const excludeBg = document.getElementById('chk-slow-bg').checked;

            const res = await fetch(\`/api/top-slow?page=\${curSlowPage}&pageSize=\${curSlowPageSize}&traceId=\${encodeURIComponent(traceId)}&excludeBackground=\${excludeBg}\`);
            const json = await res.json();
            if (json.success) {
                rawSlowData = json.data;
                totalSlowCount = json.total;
                renderSlowTable(rawSlowData);
                renderPagination('slow-pagination', curSlowPage, curSlowPageSize, totalSlowCount, (p, ps) => {
                    curSlowPageSize = ps;
                    loadSlow(p);
                });
            }
        }

        function renderSlowTable(data) {
            const tbody = document.getElementById('slow-tbody');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">未找到符合条件的慢 SQL</td></tr>';
                return;
            }
            const offset = (curSlowPage - 1) * curSlowPageSize;
            tbody.innerHTML = data.map((r, i) => {
                const fullSql = r.full_sql || r.sql_template || '';
                const briefSql = r.brief_sql || fullSql;

                return \`
                <tr>
                    <td>\${offset + i + 1}</td>
                    <td><span class="tag-slow">\${r.exec_time_ms} ms</span></td>
                    <td><a class="trace-link" onclick="jumpToTrace('\${r.trace_id}')">\${r.trace_id}</a></td>
                    <td>\${r.log_time}</td>
                    <td>\${r.result_rows}</td>
                    <td>\${buildVscodeLink(r.source_file, r.line_number)}</td>
                    <td>
                        <div class="sql-code" onclick="handleSqlClick(this)" oncontextmenu="handleSqlContextMenu(event, this)" title="左键: 0ms秒开展开/收起 | 右键: 复制完整 SQL" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
                    </td>
                </tr>
            \`;
            }).join('');
        }

        function filterSlowTable() {
            const q = document.getElementById('search-slow').value.toLowerCase();
            const filtered = rawSlowData.filter(d => 
                (d.full_sql || '').toLowerCase().includes(q) || 
                (d.sql_template || '').toLowerCase().includes(q) ||
                (d.trace_id || '').toLowerCase().includes(q)
            );
            renderSlowTable(filtered);
        }

        function renderPagination(containerId, page, pageSize, total, onPageChange) {
            const container = document.getElementById(containerId);
            if (!container) return;
            const totalPages = Math.ceil(total / pageSize) || 1;

            container.innerHTML = \`
                <div class="pagination-info">共 \${total.toLocaleString()} 条，第 \${page} / \${totalPages} 页</div>
                <div class="pagination-controls">
                    <button class="page-btn" \${page <= 1 ? 'disabled' : ''} onclick="changePage('\${containerId}', 1)">首页</button>
                    <button class="page-btn" \${page <= 1 ? 'disabled' : ''} onclick="changePage('\${containerId}', \${page - 1})">上一页</button>
                    <span style="font-size: 12px;">每页</span>
                    <select class="page-select" onchange="changePageSize('\${containerId}', this.value)">
                        <option value="15" \${pageSize === 15 ? 'selected' : ''}>15 条</option>
                        <option value="20" \${pageSize === 20 ? 'selected' : ''}>20 条</option>
                        <option value="50" \${pageSize === 50 ? 'selected' : ''}>50 条</option>
                        <option value="100" \${pageSize === 100 ? 'selected' : ''}>100 条</option>
                        <option value="200" \${pageSize === 200 ? 'selected' : ''}>200 条</option>
                        <option value="500" \${pageSize === 500 ? 'selected' : ''}>500 条</option>
                    </select>
                    <button class="page-btn" \${page >= totalPages ? 'disabled' : ''} onclick="changePage('\${containerId}', \${page + 1})">下一页</button>
                    <button class="page-btn" \${page >= totalPages ? 'disabled' : ''} onclick="changePage('\${containerId}', \${totalPages})">尾页</button>
                </div>
            \`;

            window['cb_' + containerId] = onPageChange;
        }

        function changePage(containerId, targetPage) {
            const cb = window['cb_' + containerId];
            if (cb) {
                cb(targetPage, getPageSizeByContainer(containerId));
                scrollToTableTop(containerId);
            }
        }

        function changePageSize(containerId, newSize) {
            const cb = window['cb_' + containerId];
            if (cb) {
                cb(1, parseInt(newSize, 10));
                scrollToTableTop(containerId);
            }
        }

        function getPageSizeByContainer(containerId) {
            if (containerId === 'repeated-pagination') return curRepeatedPageSize;
            if (containerId === 'slow-pagination') return curSlowPageSize;
            if (containerId === 'trace-pagination') return curTracePageSize;
            if (containerId === 'detail-pagination') return curDetailPageSize;
            return 20;
        }

        function scrollToTableTop(containerId) {
            const bar = document.getElementById(containerId);
            if (bar) {
                const container = bar.closest('.panel')?.querySelector('.table-container');
                if (container) {
                    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    return;
                }
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        let curTracePage = 1;
        let curTracePageSize = 200;
        let totalTraceCount = 0;

        async function loadTraceData(page = 1) {
            const traceId = document.getElementById('trace-input').value.trim();
            if (!traceId) return;

            curTracePage = page;
            const res = await fetch(\`/api/trace?traceId=\${encodeURIComponent(traceId)}&page=\${curTracePage}&pageSize=\${curTracePageSize}\`);
            const json = await res.json();
            if (json.success) {
                totalTraceCount = json.total || 0;
                const pageOffset = (curTracePage - 1) * curTracePageSize;
                rawTraceData = (json.data || []).map((item, idx) => ({ ...item, _origIndex: pageOffset + idx }));
                sortAndRenderTraceTable();
                renderPagination('trace-pagination', curTracePage, curTracePageSize, totalTraceCount, (p, ps) => {
                    curTracePageSize = ps;
                    loadTraceData(p);
                });
            }
        }



        /**
         * Trace 链路渲染（保持天然日志时间执行顺序）
         */
        function sortAndRenderTraceTable() {
            if (!rawTraceData) return;
            const q = document.getElementById('search-trace-sql').value.toLowerCase();

            let result = [...rawTraceData];
            if (q) {
                result = result.filter(r => 
                    (r.full_sql || '').toLowerCase().includes(q) || 
                    (r.sql_template || '').toLowerCase().includes(q)
                );
            }

            renderTraceTable(result);
        }

        function renderTraceTable(data) {
            const tbody = document.getElementById('trace-tbody');
            const summary = document.getElementById('trace-summary');
            const traceId = document.getElementById('trace-input').value.trim();

            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">未查找到符合条件的 SQL 记录</td></tr>';
                summary.innerText = '';
                const pContainer = document.getElementById('trace-pagination');
                if (pContainer) pContainer.innerHTML = '';
                return;
            }

            const pageOffset = (curTracePage - 1) * curTracePageSize;
            const totalCost = rawTraceData.reduce((acc, curr) => acc + (curr.exec_time_ms || 0), 0);
            summary.innerText = \`Trace [ \${traceId} ] 共查到 \${totalTraceCount.toLocaleString()} 条 SQL 记录 (第 \${curTracePage} 页，当前页显示 \${data.length} 条)\`;

            tbody.innerHTML = data.map((r, i) => {
                const fullSql = r.full_sql || r.sql_template || '';
                const briefSql = r.brief_sql || fullSql;
                const globalIdx = (r._origIndex !== undefined) ? (r._origIndex + 1) : (pageOffset + i + 1);

                return \`
                <tr>
                    <td>\${globalIdx}</td>
                    <td>\${r.log_time}</td>
                    <td><span class="\${r.exec_time_ms > 50 ? 'tag-slow' : ''}">\${r.exec_time_ms} ms</span></td>
                    <td>\${r.result_rows}</td>
                    <td>\${buildVscodeLink(r.source_file, r.line_number)}</td>
                    <td>
                        <div class="sql-code" onclick="handleSqlClick(this)" oncontextmenu="handleSqlContextMenu(event, this)" title="左键: 0ms秒开展开/收起 | 右键: 复制完整 SQL" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
                    </td>
                </tr>
            \`;
            }).join('');
        }

        function jumpToTrace(traceId) {
            document.getElementById('trace-input').value = traceId;
            switchTab('trace');
            loadTraceData(1);
        }

        async function loadDiagnostics() {
            const traceId = document.getElementById('trace-diagnose').value.trim();
            const res = await fetch('/api/diagnostics?traceId=' + encodeURIComponent(traceId));
            const json = await res.json();
            if (json.success) {
                rawDiagnoseData = json.data;
                renderDiagnoseTable(rawDiagnoseData);
            }
        }

        function renderDiagnoseTable(data) {
            const tbody = document.getElementById('diagnose-tbody');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--accent-green);">🎉 优秀！未检测到符合条件的同一事务连接 (dbManager 句柄) 内重复执行次数 >= 5 的 N+1 循环问题</td></tr>';
                return;
            }
            tbody.innerHTML = data.map((r, i) => {
                const isSevere = r.repeat_count >= 20;
                const tagClass = isSevere ? 'tag-slow' : 'tag-freq';
                const tagText = isSevere ? '🔥 严重 N+1 (' + r.repeat_count + '次)' : '⚠️ 疑似 N+1 (' + r.repeat_count + '次)';
                const suggestion = isSevere ? '改写为 IN(...) 批量查询' : '增加二级缓存/批处理';
                
                const dbManagerStr = (r.db_manager || '').split('.').pop() || r.db_manager;
                const fullSql = r.sql_template || '';
                const briefSql = r.brief_sql || fullSql;

                return \`
                <tr>
                    <td>\${i + 1}</td>
                    <td><a class="trace-link" onclick="jumpToTrace('\${r.trace_id}')">\${r.trace_id}</a></td>
                    <td><code style="background: #f1f5f9; padding: 2px 5px; border-radius: 4px; font-weight: 600; color: #475569;">\${escapeHtml(dbManagerStr)}</code></td>
                    <td><span class="\${tagClass}">\${tagText}</span></td>
                    <td>\${r.total_time_ms} ms</td>
                    <td style="color: #0284c7; font-weight: 600;">\${suggestion}</td>
                    <td>
                        <div class="sql-code" onclick="handleSqlClick(this)" oncontextmenu="handleSqlContextMenu(event, this)" title="左键: 0ms秒开展开/收起 | 右键: 复制完整 SQL" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
                    </td>
                    <td>
                        <button class="btn-view-calls" onclick="jumpToDetail('\${escapeJs(fullSql)}', { source: 'diagnose', traceId: '\${r.trace_id}', dbManager: '\${escapeJs(r.db_manager)}', repeatCount: \${r.repeat_count} })">🔍 查看调用</button>
                    </td>
                </tr>
            \`;
            }).join('');
        }

        function filterDiagnoseTable() {
            const q = document.getElementById('search-diagnose').value.toLowerCase();
            if (!rawDiagnoseData) return;
            const filtered = rawDiagnoseData.filter(d => 
                (d.sql_template || '').toLowerCase().includes(q) || 
                (d.trace_id || '').toLowerCase().includes(q) ||
                (d.db_manager || '').toLowerCase().includes(q)
            );
            renderDiagnoseTable(filtered);
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }

        function escapeJs(str) {
            if (!str) return '';
            return JSON.stringify(str).slice(1, -1);
        }

        // ==================== SQL 调用明细 (Detail) 功能 ====================
        let currentDetailTemplate = '';
        let currentDetailContext = null;
        let curDetailPage = 1;
        let curDetailPageSize = 50;
        let totalDetailCount = 0;

        function jumpToDetail(sqlTemplate, contextInfo = null) {
            currentDetailTemplate = sqlTemplate;
            currentDetailContext = contextInfo;
            switchTab('detail');
            loadDetailData(1);
        }

        async function loadDetailData(page = 1) {
            if (!currentDetailTemplate) return;
            curDetailPage = page;

            const res = await fetch(\`/api/by-template?sqlTemplate=\${encodeURIComponent(currentDetailTemplate)}&page=\${curDetailPage}&pageSize=\${curDetailPageSize}\`);
            const json = await res.json();
            if (json.success) {
                totalDetailCount = json.total;
                renderDetailTable(json.data);
                renderPagination('detail-pagination', curDetailPage, curDetailPageSize, totalDetailCount, (p, ps) => {
                    curDetailPageSize = ps;
                    loadDetailData(p);
                });

                // 更新头部摘要 (展示完整过滤上下文条件：来源, TraceID, dbManager 事务句柄, 循环/执行频次)
                const header = document.getElementById('detail-header');
                const briefTemplate = compressSqlColumnsFrontend(currentDetailTemplate);
                const ctx = currentDetailContext || {};

                let contextTagsHtml = '';
                if (ctx.source === 'diagnose') {
                    const dbManagerStr = (ctx.dbManager || '').split('.').pop() || ctx.dbManager || '-';
                    contextTagsHtml = \`
                        <div style="margin-top: 4px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 12.5px;">
                            <span>来源: <b style="color: #8b5cf6;">🔁 事务内重复 SQL (N+1) 诊断</b></span>
                            <span>TraceID: <a class="trace-link" onclick="jumpToTrace('\${ctx.traceId}')">\${ctx.traceId}</a></span>
                            <span>dbManager 事务句柄: <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; color: #475569;">\${escapeHtml(dbManagerStr)}</code></span>
                            <span>事务内循环: <b style="color: var(--accent-red);">\${ctx.repeatCount} 次</b></span>
                            <span>全库匹配: <b>\${totalDetailCount.toLocaleString()} 条</b></span>
                        </div>
                    \`;
                } else if (ctx.source === 'repeated') {
                    contextTagsHtml = \`
                        <div style="margin-top: 4px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 12.5px;">
                            <span>来源: <b style="color: #0284c7;">📊 SQL 频次榜</b></span>
                            <span>全局频次: <b style="color: var(--accent-yellow);">\${ctx.count} 次</b></span>
                            <span>匹配调用日志: <b>\${totalDetailCount.toLocaleString()} 条</b></span>
                        </div>
                    \`;
                } else {
                    contextTagsHtml = \`
                        <div style="margin-top: 4px; font-size: 12.5px;">
                            <span>匹配日志调用记录: <b>\${totalDetailCount.toLocaleString()} 条</b></span>
                        </div>
                    \`;
                }

                header.innerHTML = \`
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                        <div>
                            <span style="font-size: 13.5px;">🔍 <b>SQL 模板调用明细</b></span>
                            \${contextTagsHtml}
                        </div>
                        <button class="btn" style="padding: 3px 10px; font-size: 11.5px; background: #8b5cf6; white-space: nowrap;" onclick="copySqlText('\${escapeJs(currentDetailTemplate)}')">📋 复制完整 SQL 模板</button>
                    </div>
                    <div class="sql-code" onclick="handleSqlClick(this)" oncontextmenu="handleSqlContextMenu(event, this)" title="左键: 0ms 展开/收起 | 右键: 复制完整 SQL 模板" data-full="\${escapeHtml(currentDetailTemplate)}" data-brief="\${escapeHtml(briefTemplate)}">\${escapeHtml(briefTemplate)}</div>
                \`;
            }
        }

        function compressSqlColumnsFrontend(sql) {
            if (!sql) return '';
            const str = sql.trim();
            const match = str.match(/(select\\s+)([\\s\\S]+?)(\\s+from\\b[\\s\\S]+)/i);
            if (match) {
                const selectHead = match[1];
                const cols = match[2];
                const fromTail = match[3];
                if (cols.includes(',') || cols.trim().length > 15) {
                    return selectHead + '... ' + fromTail.trim();
                }
            }
            return str;
        }

        function renderDetailTable(data) {
            const tbody = document.getElementById('detail-tbody');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">未找到调用记录</td></tr>';
                return;
            }
            const offset = (curDetailPage - 1) * curDetailPageSize;
            tbody.innerHTML = data.map((r, i) => {
                const fullSql = r.full_sql || r.sql_template || '';
                const briefSql = r.brief_sql || fullSql;

                return \`
                <tr>
                    <td>\${offset + i + 1}</td>
                    <td>\${r.log_time}</td>
                    <td><a class="trace-link" onclick="jumpToTrace('\${r.trace_id}')">\${r.trace_id}</a></td>
                    <td><span class="\${r.exec_time_ms > 50 ? 'tag-slow' : ''}">\${r.exec_time_ms} ms</span></td>
                    <td>\${r.result_rows}</td>
                    <td>\${buildVscodeLink(r.source_file, r.line_number)}</td>
                    <td>
                        <div class="sql-code" onclick="handleSqlClick(this)" oncontextmenu="handleSqlContextMenu(event, this)" title="左键: 0ms秒开展开/收起 | 右键: 复制完整 SQL" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
                    </td>
                </tr>
            \`;
            }).join('');
        }

        // ==================== VSCode 跳转功能 ====================
        function buildVscodeLink(sourceFile, lineNumber) {
            if (!sourceFile || !lineNumber) return '<span style="color:#999;">-</span>';

            const fileName = sourceFile.split('/').pop().split('\\\\').pop();

            if (sourceFile.endsWith('.gz')) {
                return \`<button class="btn-vscode" onclick="openGzInVscode('\${escapeJs(sourceFile)}', \${lineNumber})" title="\${escapeHtml(sourceFile)}:L\${lineNumber}">
                    📂 \${fileName}:L\${lineNumber}
                </button>\`;
            }

            const vscodeUri = 'vscode://file/' + sourceFile.replace(/\\\\/g, '/') + ':' + lineNumber;
            return \`<a href="\${vscodeUri}" class="btn-vscode" title="\${escapeHtml(sourceFile)}:L\${lineNumber}">
                📎 \${fileName}:L\${lineNumber}
            </a>\`;
        }

        async function openGzInVscode(gzPath, lineNumber) {
            const res = await fetch('/api/decompress-gz?filePath=' + encodeURIComponent(gzPath));
            const json = await res.json();
            if (json.success) {
                window.open('vscode://file/' + json.decompressedPath + ':' + lineNumber, '_self');
            } else {
                alert('解压失败: ' + (json.error || '未知错误'));
            }
        }

        window.onload = init;
    </script>
</body>
</html>`;
}

module.exports = { createServer, compressSqlColumns };
