const http = require('http');
const url = require('url');

function safeJsonStringify(obj) {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? Number(value) : value
    );
}

/**
 * 强健的列名精简算法：无论大写小写、换行缩进，将 SELECT 与 FROM 之间的冗长列名区间 100% 替换为 select ... from
 */
function compressSqlColumns(sql) {
    if (!sql) return '';
    const str = sql.trim();
    const lower = str.toLowerCase();
    
    const selectIdx = lower.indexOf('select');
    const fromIdx = lower.indexOf('from');

    if (selectIdx !== -1 && fromIdx !== -1 && fromIdx > selectIdx) {
        const selectPart = str.substring(0, selectIdx + 6);
        const cols = str.substring(selectIdx + 6, fromIdx);
        const fromTail = str.substring(fromIdx);

        if (cols.includes(',') || cols.trim().length > 15) {
            return selectPart + ' ... ' + fromTail.trim();
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
                    const traceId = parsedUrl.query.traceId || '';
                    const rows = await dbInstance.getDiagnostics(traceId);
                    return res.end(safeJsonStringify({ success: true, data: rows }));
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
            border: none;
            color: var(--text-muted);
            padding: 6px 14px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            transition: all 0.15s;
        }
        .tab-btn:hover { color: var(--accent); background: #f1f5f9; }
        .tab-btn.active { color: var(--accent); background: #e0f2fe; border: 1px solid #bae6fd; }

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
            user-select: all; /* 浏览器原生 0 延迟瞬间全选 */
            -webkit-user-select: all;
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
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="title">
                <h1>SQL 日志分析器</h1>
                <span class="badge">DuckDB 纯内存极速分析版</span>
            </div>
            <div id="parse-time" style="font-size: 12px; color: var(--text-muted);">数据加载完成</div>
        </header>

        <!-- Tab 菜单：顺序为 N+1诊所第一 -> 慢SQL -> Trace链路 -> SQL频次榜 (倒数第二) -> 概览 (倒数第一) -->
        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('diagnose')">💡 N+1 事务循环诊所</button>
            <button class="tab-btn" onclick="switchTab('slow')">🐢 慢 SQL 排行</button>
            <button class="tab-btn" onclick="switchTab('trace')">🔗 Trace 链路分析</button>
            <button class="tab-btn" onclick="switchTab('repeated')">📊 SQL 频次榜</button>
            <button class="tab-btn" onclick="switchTab('overview')">📈 概览统计分析</button>
        </div>

        <!-- 1. N+1 诊断 Panel (默认 Active) -->
        <div id="panel-diagnose" class="panel active">
            <div class="diagnose-banner">
                <strong>💡 事务粒度 N+1 冗余诊断说明：</strong> 基于日志中 <code>dbManager</code> 内存对象句柄（如 <code>MySqlDBManager@7b2aa7e0</code>），抓取【同一数据库事务内】重复执行 $\ge 5$ 次的 SQL。
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
                            <th>SQL 模板 (点击 0ms 秒开展开/收起，自动原生全选)</th>
                        </tr>
                    </thead>
                    <tbody id="diagnose-tbody"><tr><td colspan="7" style="text-align: center;">加载中...</td></tr></tbody>
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
                            <th>完整执行 SQL (点击 0ms 秒开展开/收起，自动原生全选)</th>
                        </tr>
                    </thead>
                    <tbody id="slow-tbody"><tr><td colspan="6" style="text-align: center;">加载中...</td></tr></tbody>
                </table>
                <div class="pagination-bar" id="slow-pagination"></div>
            </div>
        </div>

        <!-- 3. Trace 链路 Panel -->
        <div id="panel-trace" class="panel">
            <div class="toolbar">
                <input type="text" id="trace-input" class="search-input" style="max-width: 300px;" placeholder="输入 TraceID (如 Main_9ckgsuc...)" onchange="loadTraceData()">
                <input type="text" id="search-trace-sql" class="search-input" placeholder="在当前 Trace 中按 SQL 语句/关键词过滤 (如 select / EMM_...)" oninput="filterTraceTable()">
                <button class="btn" onclick="loadTraceData()">搜索 Trace 链路</button>
            </div>
            <div id="trace-summary" style="margin-bottom: 8px; font-size: 13px; color: var(--accent); font-weight: 600;"></div>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th style="width: 50px;">序号</th>
                            <th style="width: 150px;">时间</th>
                            <th style="width: 90px;">耗时 (ms)</th>
                            <th style="width: 80px;">影响行数</th>
                            <th>执行 SQL 语句 (点击 0ms 秒开展开/收起，自动原生全选)</th>
                        </tr>
                    </thead>
                    <tbody id="trace-tbody"><tr><td colspan="5" style="text-align: center;">请输入 TraceID 进行查询</td></tr></tbody>
                </table>
            </div>
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
                            <th>SQL 参数化模板 (点击 0ms 秒开展开/收起，自动原生全选)</th>
                        </tr>
                    </thead>
                    <tbody id="repeated-tbody"><tr><td colspan="7" style="text-align: center;">加载中...</td></tr></tbody>
                </table>
                <div class="pagination-bar" id="repeated-pagination"></div>
            </div>
        </div>

        <!-- 5. 独立概览统计 Tab Panel (倒数第一) -->
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

        function switchTab(name) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            
            event.target.classList.add('active');
            document.getElementById('panel-' + name).classList.add('active');
        }

        /**
         * 100% 精准的列名精简算法：查找 SELECT 与 FROM 替换为 select ... from
         */
        function compressSqlColumns(sql) {
            if (!sql) return '';
            const str = sql.trim();
            const lower = str.toLowerCase();

            const selectIdx = lower.indexOf('select');
            const fromIdx = lower.indexOf('from');

            if (selectIdx !== -1 && fromIdx !== -1 && fromIdx > selectIdx) {
                const selectPart = str.substring(0, selectIdx + 6);
                const cols = str.substring(selectIdx + 6, fromIdx);
                const fromPart = str.substring(fromIdx);

                if (cols.includes(',') || cols.trim().length > 15) {
                    return selectPart + ' ... ' + fromPart.trim();
                }
            }
            return str;
        }

        /**
         * 0ms 瞬间切换：无任何防抖延时，单击即刻毫秒级展开/收起
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

                return \`
                <tr>
                    <td>\${offset + i + 1}</td>
                    <td><span class="tag-freq">\${r.count} 次</span></td>
                    <td>\${r.total_time_ms} ms</td>
                    <td>\${r.avg_time_ms} ms</td>
                    <td>\${r.max_time_ms} ms</td>
                    <td>\${r.trace_count}</td>
                    <td>
                        <div class="sql-code" onclick="handleSqlClick(this)" title="点击 0ms 秒开展开/收起，原生自动全选" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
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

                return \`
                <tr>
                    <td>\${offset + i + 1}</td>
                    <td><span class="tag-slow">\${r.exec_time_ms} ms</span></td>
                    <td><a class="trace-link" onclick="jumpToTrace('\${r.trace_id}')">\${r.trace_id}</a></td>
                    <td>\${r.log_time}</td>
                    <td>\${r.result_rows}</td>
                    <td>
                        <div class="sql-code" onclick="handleSqlClick(this)" title="点击 0ms 秒开展开/收起，原生自动全选" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
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
                rawTraceData = json.data;
                renderTraceTable(rawTraceData);
            }
        }

        function renderTraceTable(data) {
            const tbody = document.getElementById('trace-tbody');
            const summary = document.getElementById('trace-summary');
            const traceId = document.getElementById('trace-input').value.trim();

            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align: center;">未查找到符合条件的 SQL 记录</td></tr>';
                summary.innerText = '';
                return;
            }

            const totalCost = data.reduce((acc, curr) => acc + (curr.exec_time_ms || 0), 0);
            summary.innerText = \`Trace [ \${traceId} ] 共查到 \${data.length} 条符合条件的 SQL 记录，累计 SQL 耗时: \${totalCost.toFixed(2)} ms\`;

            tbody.innerHTML = data.map((r, i) => {
                const fullSql = r.full_sql || r.sql_template || '';
                const briefSql = compressSqlColumns(fullSql);

                return \`
                <tr>
                    <td>\${i + 1}</td>
                    <td>\${r.log_time}</td>
                    <td><span class="\${r.exec_time_ms > 50 ? 'tag-slow' : ''}">\${r.exec_time_ms} ms</span></td>
                    <td>\${r.result_rows}</td>
                    <td>
                        <div class="sql-code" onclick="handleSqlClick(this)" title="点击 0ms 秒开展开/收起，原生自动全选" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
                    </td>
                </tr>
            \`;
            }).join('');
        }

        function filterTraceTable() {
            const q = document.getElementById('search-trace-sql').value.toLowerCase();
            if (!rawTraceData) return;
            const filtered = rawTraceData.filter(r => 
                (r.full_sql || '').toLowerCase().includes(q) || 
                (r.sql_template || '').toLowerCase().includes(q)
            );
            renderTraceTable(filtered);
        }

        function jumpToTrace(traceId) {
            document.getElementById('trace-input').value = traceId;
            switchTab('trace');
            loadTraceData();
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
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--accent-green);">🎉 优秀！未检测到符合条件的同一事务连接 (dbManager 句柄) 内重复执行次数 >= 5 的 N+1 循环问题</td></tr>';
                return;
            }
            tbody.innerHTML = data.map((r, i) => {
                const isSevere = r.repeat_count >= 20;
                const tagClass = isSevere ? 'tag-slow' : 'tag-freq';
                const tagText = isSevere ? '🔥 严重 N+1 (' + r.repeat_count + '次)' : '⚠️ 疑似 N+1 (' + r.repeat_count + '次)';
                const suggestion = isSevere ? '改写为 IN(...) 批量查询' : '增加二级缓存/批处理';
                
                const dbManagerStr = (r.db_manager || '').split('.').pop() || r.db_manager;
                const fullSql = r.sql_template || '';
                const briefSql = compressSqlColumns(fullSql);

                return \`
                <tr>
                    <td>\${i + 1}</td>
                    <td><a class="trace-link" onclick="jumpToTrace('\${r.trace_id}')">\${r.trace_id}</a></td>
                    <td><code style="background: #f1f5f9; padding: 2px 5px; border-radius: 4px; font-weight: 600; color: #475569;">\${escapeHtml(dbManagerStr)}</code></td>
                    <td><span class="\${tagClass}">\${tagText}</span></td>
                    <td>\${r.total_time_ms} ms</td>
                    <td style="color: #0284c7; font-weight: 600;">\${suggestion}</td>
                    <td>
                        <div class="sql-code" onclick="handleSqlClick(this)" title="点击 0ms 秒开展开/收起，原生自动全选" data-full="\${escapeHtml(fullSql)}" data-brief="\${escapeHtml(briefSql)}">\${escapeHtml(briefSql)}</div>
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

        window.onload = init;
    </script>
</body>
</html>`;
}

module.exports = { createServer, compressSqlColumns };
