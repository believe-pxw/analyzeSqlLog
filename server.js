const http = require('http');
const url = require('url');

function safeJsonStringify(obj) {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? Number(value) : value
    );
}

/**
 * 强健的列名精简算法：查找 SELECT 与 FROM，将冗长的列名区间替换为 select ... from
 */
function compressSqlColumns(sql) {
    if (!sql) return '';
    const str = sql.trim();
    const selectIdx = str.search(/select/i);
    const fromIdx = str.search(/\sfrom\s/i);

    if (selectIdx !== -1 && fromIdx !== -1 && fromIdx > selectIdx) {
        const selectPart = str.substring(0, selectIdx + 6);
        const cols = str.substring(selectIdx + 6, fromIdx);
        const fromPart = str.substring(fromIdx);

        if (cols.includes(',') || cols.trim().length > 25) {
            return selectPart + ' ...' + fromPart;
        }
    }
    return str;
}

function createServer(dbInstance, parseStats, port = 3000) {
    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);
        const pathname = parsedUrl.pathname;
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
                    const page = parseInt(parsedUrl.query.page, 10) || 1;
                    const pageSize = parseInt(parsedUrl.query.pageSize, 10) || 20;
                    const traceId = parsedUrl.query.traceId || '';
                    const excludeBg = parsedUrl.query.excludeBackground === 'true';
                    
                    const result = await dbInstance.getTopRepeated(page, pageSize, traceId, excludeBg);
                    return res.end(safeJsonStringify({ success: true, data: result.rows, total: result.total, page: result.page, pageSize: result.pageSize }));
                }

                if (pathname === '/api/top-slow' && method === 'GET') {
                    const page = parseInt(parsedUrl.query.page, 10) || 1;
                    const pageSize = parseInt(parsedUrl.query.pageSize, 10) || 20;
                    const traceId = parsedUrl.query.traceId || '';
                    const excludeBg = parsedUrl.query.excludeBackground === 'true';

                    const result = await dbInstance.getTopSlow(page, pageSize, traceId, excludeBg);
                    return res.end(safeJsonStringify({ success: true, data: result.rows, total: result.total, page: result.page, pageSize: result.pageSize }));
                }

                if (pathname === '/api/trace' && method === 'GET') {
                    const traceId = parsedUrl.query.traceId || '';
                    const rows = await dbInstance.getByTraceId(traceId);
                    return res.end(safeJsonStringify({ success: true, data: rows }));
                }

                if (pathname === '/api/diagnostics' && method === 'GET') {
                    const rows = await dbInstance.getDiagnostics();
                    return res.end(safeJsonStringify({ success: true, data: rows }));
                }

                if (pathname === '/api/query' && method === 'POST') {
                    let body = '';
                    req.on('data', chunk => body += chunk);
                    req.on('end', async () => {
                        try {
                            const json = JSON.parse(body);
                            const rows = await dbInstance.query(json.sql);
                            return res.end(safeJsonStringify({ success: true, data: rows }));
                        } catch (err) {
                            return res.end(safeJsonStringify({ success: false, error: err.message }));
                        }
                    });
                    return;
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
        const { exec } = require('child_process');
        const url = `http://localhost:${port}`;
        console.log(`\n==================================================`);
        console.log(`🚀 SQL 日志分析器控制台已成功启动: ${url}`);
        console.log(`==================================================\n`);
        exec(`start ${url}`);
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
            --border: #e2e8f0;
            --accent: #0284c7;
            --accent-hover: #0369a1;
            --accent-green: #16a34a;
            --accent-red: #dc2626;
            --accent-yellow: #d97706;
            --text: #0f172a;
            --text-muted: #64748b;
            --shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            line-height: 1.5;
            padding: 24px;
        }

        .container { max-width: 1440px; margin: 0 auto; }
        
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 18px 24px;
            background: var(--panel-bg);
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            border-radius: 12px;
            margin-bottom: 20px;
        }

        .title { display: flex; align-items: center; gap: 12px; }
        .title h1 { font-size: 22px; font-weight: 700; color: #0284c7; }
        .badge { background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 600; border: 1px solid #bae6fd; }

        .tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 20px;
            border-bottom: 2px solid var(--border);
            padding-bottom: 8px;
        }
        .tab-btn {
            background: transparent;
            border: none;
            color: var(--text-muted);
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s;
        }
        .tab-btn:hover { color: var(--accent); background: #f1f5f9; }
        .tab-btn.active { color: var(--accent); background: #e0f2fe; border: 1px solid #bae6fd; }

        .panel { display: none; }
        .panel.active { display: block; }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .stat-card {
            background: var(--panel-bg);
            border: 1px solid var(--border);
            box-shadow: var(--shadow);
            border-radius: 12px;
            padding: 24px;
            display: flex;
            flex-direction: column;
        }
        .stat-card .label { font-size: 14px; color: var(--text-muted); font-weight: 500; }
        .stat-card .value { font-size: 30px; font-weight: 700; margin-top: 8px; color: var(--text); }

        .toolbar {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
            align-items: center;
            flex-wrap: wrap;
        }
        .search-input {
            flex: 1;
            min-width: 200px;
            background: #ffffff;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 9px 14px;
            color: var(--text);
            font-size: 14px;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }
        .search-input:focus { outline: none; border-color: var(--accent); }
        
        .filter-checkbox {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13.5px;
            color: #334155;
            font-weight: 500;
            cursor: pointer;
            user-select: none;
            background: #f1f5f9;
            padding: 8px 12px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
        }

        .btn {
            background: var(--accent);
            color: #ffffff;
            border: none;
            padding: 9px 18px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
            box-shadow: var(--shadow);
        }
        .btn:hover { background: var(--accent-hover); }

        .table-container {
            background: var(--panel-bg);
            border: 1px solid var(--border);
            box-shadow: var(--shadow);
            border-radius: 12px;
            overflow-x: auto;
        }
        table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px; }
        th, td { padding: 14px 18px; border-bottom: 1px solid var(--border); }
        th { background: #f8fafc; color: var(--text-muted); font-weight: 600; }
        tr:hover { background: #f1f5f9; }

        .sql-box-wrapper {
            position: relative;
        }

        .sql-code {
            font-family: "Fira Code", Consolas, Monaco, monospace;
            background: #f1f5f9;
            padding: 10px 14px;
            border-radius: 6px;
            color: #1e293b;
            white-space: pre-wrap;
            word-break: break-all;
            max-height: 140px;
            overflow-y: auto;
            border: 1px solid #cbd5e1;
        }

        .sql-toggle-btn {
            background: #0284c7;
            color: #ffffff;
            border: none;
            padding: 3px 9px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 6px;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: background 0.2s;
        }
        .sql-toggle-btn:hover { background: #0369a1; }
        .sql-toggle-btn.expanded { background: #64748b; }

        .trace-link { color: var(--accent); font-weight: 600; text-decoration: none; cursor: pointer; }
        .trace-link:hover { text-decoration: underline; }

        .tag-slow { color: var(--accent-red); font-weight: 700; }
        .tag-freq { color: var(--accent-yellow); font-weight: 700; }

        .query-box {
            width: 100%;
            height: 110px;
            background: #ffffff;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px;
            color: #0284c7;
            font-family: monospace;
            font-size: 14px;
            margin-bottom: 12px;
            resize: vertical;
            box-shadow: var(--shadow);
        }
        .query-box:focus { outline: none; border-color: var(--accent); }

        .copy-btn {
            background: #e2e8f0;
            border: 1px solid #cbd5e1;
            color: #475569;
            padding: 3px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            margin-top: 6px;
            display: inline-block;
            font-weight: 500;
        }
        .copy-btn:hover { color: #0f172a; background: #cbd5e1; }

        /* 分页条 Pagination Bar */
        .pagination-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 14px 20px;
            background: #ffffff;
            border-top: 1px solid var(--border);
            border-bottom-left-radius: 12px;
            border-bottom-right-radius: 12px;
        }
        .pagination-info { font-size: 13.5px; color: var(--text-muted); }
        .pagination-controls { display: flex; align-items: center; gap: 8px; }
        .page-btn {
            background: #f1f5f9;
            border: 1px solid #cbd5e1;
            color: #334155;
            padding: 5px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
        }
        .page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .page-btn:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
        .page-select {
            padding: 5px 8px;
            border-radius: 6px;
            border: 1px solid #cbd5e1;
            background: #ffffff;
            font-size: 13px;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="title">
                <h1>SQL 日志分析器</h1>
                <span class="badge">DuckDB 极速分析版</span>
            </div>
            <div id="parse-time" style="font-size: 13px; color: var(--text-muted);">数据加载完成</div>
        </header>

        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('repeated')">📊 SQL 频次榜</button>
            <button class="tab-btn" onclick="switchTab('slow')">🐢 慢 SQL 排行</button>
            <button class="tab-btn" onclick="switchTab('overview')">📈 概览统计分析</button>
            <button class="tab-btn" onclick="switchTab('trace')">🔗 Trace 链路分析</button>
            <button class="tab-btn" onclick="switchTab('diagnose')">💡 N+1 冗余诊断</button>
            <button class="tab-btn" onclick="switchTab('query')">🔍 自由 DuckDB SQL 控制台</button>
        </div>

        <!-- 频次榜 Panel -->
        <div id="panel-repeated" class="panel active">
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
                            <th style="width: 60px;">#</th>
                            <th style="width: 100px;">出现次数</th>
                            <th style="width: 110px;">总耗时 (ms)</th>
                            <th style="width: 100px;">平均耗时</th>
                            <th style="width: 100px;">最大耗时</th>
                            <th style="width: 90px;">Trace 数</th>
                            <th>SQL 参数化模板</th>
                        </tr>
                    </thead>
                    <tbody id="repeated-tbody"><tr><td colspan="7" style="text-align: center;">加载中...</td></tr></tbody>
                </table>
                <div class="pagination-bar" id="repeated-pagination"></div>
            </div>
        </div>

        <!-- 慢 SQL Panel -->
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
                            <th style="width: 60px;">#</th>
                            <th style="width: 110px;">执行耗时</th>
                            <th style="width: 180px;">TraceID</th>
                            <th style="width: 160px;">时间</th>
                            <th style="width: 90px;">影响行数</th>
                            <th>完整执行 SQL</th>
                        </tr>
                    </thead>
                    <tbody id="slow-tbody"><tr><td colspan="6" style="text-align: center;">加载中...</td></tr></tbody>
                </table>
                <div class="pagination-bar" id="slow-pagination"></div>
            </div>
        </div>

        <!-- 独立概览统计 Tab Panel -->
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

        <!-- Trace 链路 Panel -->
        <div id="panel-trace" class="panel">
            <div class="toolbar">
                <input type="text" id="trace-input" class="search-input" placeholder="输入特定 TraceID (如 hcpc9te51703753lmmmmybe-0)">
                <button class="btn" onclick="loadTraceData()">搜索 Trace 链路</button>
            </div>
            <div id="trace-summary" style="margin-bottom: 12px; font-size: 14px; color: var(--accent); font-weight: 600;"></div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 60px;">序号</th>
                            <th style="width: 160px;">时间</th>
                            <th style="width: 100px;">耗时 (ms)</th>
                            <th style="width: 90px;">影响行数</th>
                            <th>执行 SQL 语句</th>
                        </tr>
                    </thead>
                    <tbody id="trace-tbody"><tr><td colspan="5" style="text-align: center;">请输入 TraceID 进行查询</td></tr></tbody>
                </table>
            </div>
        </div>

        <!-- N+1 诊断 Panel -->
        <div id="panel-diagnose" class="panel">
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 60px;">#</th>
                            <th style="width: 220px;">TraceID</th>
                            <th style="width: 120px;">重复执行次数</th>
                            <th style="width: 120px;">累计耗时 (ms)</th>
                            <th>疑似 N+1 循环调用的 SQL 模板</th>
                        </tr>
                    </thead>
                    <tbody id="diagnose-tbody"><tr><td colspan="5" style="text-align: center;">加载中...</td></tr></tbody>
                </table>
            </div>
        </div>

        <!-- DuckDB 自由查询 Panel -->
        <div id="panel-query" class="panel">
            <textarea id="sql-query" class="query-box" placeholder="输入 DuckDB SQL...">SELECT trace_id, count(*) as count, sum(exec_time_ms) as total_ms FROM sqllogs GROUP BY trace_id ORDER BY count DESC LIMIT 10;</textarea>
            <button class="btn" onclick="runCustomSql()">运行 DuckDB SQL</button>
            <div style="margin-top: 16px;" class="table-container">
                <table id="custom-query-table">
                    <thead id="custom-query-thead"></thead>
                    <tbody id="custom-query-tbody"><tr><td style="text-align: center;">运行 SQL 后在此处显示结果</td></tr></tbody>
                </table>
            </div>
        </div>
    </div>

    <script>
        let rawRepeatedData = [];
        let rawSlowData = [];
        let curRepeatedPage = 1;
        let curRepeatedPageSize = 20;
        let totalRepeatedCount = 0;

        let curSlowPage = 1;
        let curSlowPageSize = 20;
        let totalSlowCount = 0;

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

            loadRepeated(1);
            loadSlow(1);
            loadDiagnostics();
        }

        function switchTab(name) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            
            event.target.classList.add('active');
            document.getElementById('panel-' + name).classList.add('active');
        }

        /**
         * 强健的列名精简算法：查找 SELECT 与 FROM，将冗长的列名区间替换为 select ... from
         */
        function compressSqlColumns(sql) {
            if (!sql) return '';
            const str = sql.trim();
            const selectIdx = str.search(/select/i);
            const fromIdx = str.search(/\sfrom\s/i);

            if (selectIdx !== -1 && fromIdx !== -1 && fromIdx > selectIdx) {
                const selectPart = str.substring(0, selectIdx + 6);
                const cols = str.substring(selectIdx + 6, fromIdx);
                const fromPart = str.substring(fromIdx);

                if (cols.includes(',') || cols.trim().length > 25) {
                    return selectPart + ' ...' + fromPart;
                }
            }
            return str;
        }

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
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">未找到符合条件的 SQL</td></tr>';
                return;
            }
            const offset = (curRepeatedPage - 1) * curRepeatedPageSize;
            tbody.innerHTML = data.map((r, i) => {
                const fullSql = r.sql_template || '';
                const briefSql = compressSqlColumns(fullSql);
                const hasAbbr = briefSql !== fullSql;
                const elementId = 'rep-sql-' + (offset + i);

                return \`
                <tr>
                    <td>\${offset + i + 1}</td>
                    <td><span class="tag-freq">\${r.count} 次</span></td>
                    <td>\${r.total_time_ms} ms</td>
                    <td>\${r.avg_time_ms} ms</td>
                    <td>\${r.max_time_ms} ms</td>
                    <td>\${r.trace_count}</td>
                    <td>
                        <div class="sql-box-wrapper">
                            \${hasAbbr ? \`<button class="sql-toggle-btn" onclick="toggleSql('\${elementId}')" id="btn-\${elementId}">🔍 展开完整列名</button>\` : ''}
                            <div class="sql-code" id="\${elementId}" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
                            <button class="copy-btn" onclick="copyText(\\\`\${escapeJs(fullSql)}\\\`)">复制 SQL 模板</button>
                        </div>
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
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">未找到符合条件的慢 SQL</td></tr>';
                return;
            }
            const offset = (curSlowPage - 1) * curSlowPageSize;
            tbody.innerHTML = data.map((r, i) => {
                const fullSql = r.full_sql || r.sql_template || '';
                const briefSql = compressSqlColumns(fullSql);
                const hasAbbr = briefSql !== fullSql;
                const elementId = 'slow-sql-' + (offset + i);

                return \`
                <tr>
                    <td>\${offset + i + 1}</td>
                    <td><span class="tag-slow">\${r.exec_time_ms} ms</span></td>
                    <td><a class="trace-link" onclick="jumpToTrace('\${r.trace_id}')">\${r.trace_id}</a></td>
                    <td>\${r.log_time}</td>
                    <td>\${r.result_rows}</td>
                    <td>
                        <div class="sql-box-wrapper">
                            \${hasAbbr ? \`<button class="sql-toggle-btn" onclick="toggleSql('\${elementId}')" id="btn-\${elementId}">🔍 展开完整列名</button>\` : ''}
                            <div class="sql-code" id="\${elementId}" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
                            <button class="copy-btn" onclick="copyText(\\\`\${escapeJs(fullSql)}\\\`)">复制完整 SQL</button>
                        </div>
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

        function toggleSql(id) {
            const div = document.getElementById(id);
            const btn = document.getElementById('btn-' + id);
            const full = div.getAttribute('data-full');
            const brief = div.getAttribute('data-brief');

            if (btn.classList.contains('expanded')) {
                div.innerHTML = escapeHtml(brief);
                btn.innerText = '🔍 展开完整列名';
                btn.classList.remove('expanded');
            } else {
                div.innerHTML = escapeHtml(full);
                btn.innerText = '⬆️ 收起列名';
                btn.classList.add('expanded');
            }
        }

        function renderPagination(containerId, page, pageSize, total, onPageChange) {
            const container = document.getElementById(containerId);
            const totalPages = Math.ceil(total / pageSize) || 1;

            container.innerHTML = \`
                <div class="pagination-info">共 \${total.toLocaleString()} 条记录，第 \${page} / \${totalPages} 页</div>
                <div class="pagination-controls">
                    <button class="page-btn" \${page <= 1 ? 'disabled' : ''} onclick="changePage('\${containerId}', 1)">首页</button>
                    <button class="page-btn" \${page <= 1 ? 'disabled' : ''} onclick="changePage('\${containerId}', \${page - 1})">上一页</button>
                    <span style="font-size: 13px;">每页</span>
                    <select class="page-select" onchange="changePageSize('\${containerId}', this.value)">
                        <option value="15" \${pageSize === 15 ? 'selected' : ''}>15 条</option>
                        <option value="20" \${pageSize === 20 ? 'selected' : ''}>20 条</option>
                        <option value="50" \${pageSize === 50 ? 'selected' : ''}>50 条</option>
                        <option value="100" \${pageSize === 100 ? 'selected' : ''}>100 条</option>
                    </select>
                    <button class="page-btn" \${page >= totalPages ? 'disabled' : ''} onclick="changePage('\${containerId}', \${page + 1})">下一页</button>
                    <button class="page-btn" \${page >= totalPages ? 'disabled' : ''} onclick="changePage('\${containerId}', \${totalPages})">尾页</button>
                </div>
            \`;

            window['cb_' + containerId] = onPageChange;
        }

        function changePage(containerId, targetPage) {
            const cb = window['cb_' + containerId];
            const ps = containerId === 'repeated-pagination' ? curRepeatedPageSize : curSlowPageSize;
            if (cb) cb(targetPage, ps);
        }

        function changePageSize(containerId, newSize) {
            const cb = window['cb_' + containerId];
            if (cb) cb(1, parseInt(newSize, 10));
        }

        async function loadTraceData() {
            const traceId = document.getElementById('trace-input').value.trim();
            if (!traceId) return;
            const res = await fetch('/api/trace?traceId=' + encodeURIComponent(traceId));
            const json = await res.json();
            if (json.success) {
                const data = json.data;
                const tbody = document.getElementById('trace-tbody');
                const summary = document.getElementById('trace-summary');
                
                if (data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">未查找到该 TraceID 的 SQL 记录</td></tr>';
                    summary.innerText = '';
                    return;
                }

                const totalCost = data.reduce((acc, curr) => acc + (curr.exec_time_ms || 0), 0);
                summary.innerText = \`Trace [ \${traceId} ] 包含 \${data.length} 条 SQL 执行记录，累计 SQL 耗时: \${totalCost.toFixed(2)} ms\`;

                tbody.innerHTML = data.map((r, i) => {
                    const fullSql = r.full_sql || r.sql_template || '';
                    const briefSql = compressSqlColumns(fullSql);
                    const hasAbbr = briefSql !== fullSql;
                    const elementId = 'trace-sql-' + i;

                    return \`
                    <tr>
                        <td>\${i + 1}</td>
                        <td>\${r.log_time}</td>
                        <td><span class="\${r.exec_time_ms > 50 ? 'tag-slow' : ''}">\${r.exec_time_ms} ms</span></td>
                        <td>\${r.result_rows}</td>
                        <td>
                            <div class="sql-box-wrapper">
                                \${hasAbbr ? \`<button class="sql-toggle-btn" onclick="toggleSql('\${elementId}')" id="btn-\${elementId}">🔍 展开完整列名</button>\` : ''}
                                <div class="sql-code" id="\${elementId}" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
                                <button class="copy-btn" onclick="copyText(\\\`\${escapeJs(fullSql)}\\\`)">复制</button>
                            </div>
                        </td>
                    </tr>
                \`;
                }).join('');
            }
        }

        function jumpToTrace(traceId) {
            document.getElementById('trace-input').value = traceId;
            switchTab('trace');
            loadTraceData();
        }

        async function loadDiagnostics() {
            const res = await fetch('/api/diagnostics');
            const json = await res.json();
            if (json.success) {
                const tbody = document.getElementById('diagnose-tbody');
                if (json.data.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--accent-green);">🎉 优秀！未检测到同一 Trace 内重复执行次数 >= 5 的 N+1 查询告警</td></tr>';
                    return;
                }
                tbody.innerHTML = json.data.map((r, i) => \`
                    <tr>
                        <td>\${i + 1}</td>
                        <td><a class="trace-link" onclick="jumpToTrace('\${r.trace_id}')">\${r.trace_id}</a></td>
                        <td><span class="tag-slow">\${r.repeat_count} 次</span></td>
                        <td>\${r.total_time_ms} ms</td>
                        <td>
                            <div class="sql-code">\${escapeHtml(r.sql_template)}</div>
                            <button class="copy-btn" onclick="copyText(\\\`\${escapeJs(r.sql_template)}\\\`)">复制</button>
                        </td>
                    </tr>
                \`).join('');
            }
        }

        async function runCustomSql() {
            const sql = document.getElementById('sql-query').value.trim();
            if (!sql) return;
            const res = await fetch('/api/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql })
            });
            const json = await res.json();
            const thead = document.getElementById('custom-query-thead');
            const tbody = document.getElementById('custom-query-tbody');

            if (!json.success) {
                thead.innerHTML = '';
                tbody.innerHTML = \`<tr><td style="color: var(--accent-red);">SQL 执行失败: \${escapeHtml(json.error)}</td></tr>\`;
                return;
            }

            const data = json.data;
            if (data.length === 0) {
                thead.innerHTML = '';
                tbody.innerHTML = '<tr><td style="text-align: center;">Query executed successfully, but returned 0 rows.</td></tr>';
                return;
            }

            const keys = Object.keys(data[0]);
            thead.innerHTML = '<tr>' + keys.map(k => \`<th>\${escapeHtml(k)}</th>\`).join('') + '</tr>';
            tbody.innerHTML = data.map(row => 
                '<tr>' + keys.map(k => \`<td>\${escapeHtml(String(row[k] !== undefined ? row[k] : ''))}</td>\`).join('') + '</tr>'
            ).join('');
        }

        function escapeHtml(str) {
            if (!str) return '';
            return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
        }

        function escapeJs(str) {
            if (!str) return '';
            return JSON.stringify(str).slice(1, -1);
        }

        function copyText(text) {
            navigator.clipboard.writeText(text);
            alert('SQL 已成功复制到剪贴板！');
        }

        window.onload = init;
    </script>
</body>
</html>`;
}

module.exports = { createServer, compressSqlColumns };
