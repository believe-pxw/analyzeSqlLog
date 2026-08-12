const http = require('http');
const url = require('url');

function safeJsonStringify(obj) {
    return JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? Number(value) : value
    );
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
                    const limit = parsedUrl.query.limit || 30;
                    const rows = await dbInstance.getTopRepeated(limit);
                    return res.end(safeJsonStringify({ success: true, data: rows }));
                }

                if (pathname === '/api/top-slow' && method === 'GET') {
                    const limit = parsedUrl.query.limit || 30;
                    const rows = await dbInstance.getTopSlow(limit);
                    return res.end(safeJsonStringify({ success: true, data: rows }));
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
            padding: 20px 28px;
            background: var(--panel-bg);
            box-shadow: var(--shadow);
            border: 1px solid var(--border);
            border-radius: 12px;
            margin-bottom: 24px;
        }

        .title { display: flex; align-items: center; gap: 12px; }
        .title h1 { font-size: 22px; font-weight: 700; color: #0284c7; }
        .badge { background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 6px; font-size: 13px; font-weight: 600; border: 1px solid #bae6fd; }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }

        .stat-card {
            background: var(--panel-bg);
            border: 1px solid var(--border);
            box-shadow: var(--shadow);
            border-radius: 12px;
            padding: 20px;
            display: flex;
            flex-direction: column;
        }
        .stat-card .label { font-size: 13px; color: var(--text-muted); font-weight: 500; }
        .stat-card .value { font-size: 26px; font-weight: 700; margin-top: 6px; color: var(--text); }

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

        .toolbar {
            display: flex;
            gap: 12px;
            margin-bottom: 16px;
        }
        .search-input {
            flex: 1;
            background: #ffffff;
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 10px 14px;
            color: var(--text);
            font-size: 14px;
            box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
        }
        .search-input:focus { outline: none; border-color: var(--accent); ring: 2px rgba(2, 132, 199, 0.2); }
        
        .btn {
            background: var(--accent);
            color: #ffffff;
            border: none;
            padding: 10px 20px;
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

        <div class="stats-grid" id="stats-container">
            <div class="stat-card"><span class="label">分析 SQL 总数</span><span class="value" id="stat-total-sqls">-</span></div>
            <div class="stat-card"><span class="label">SQL 归一模板数</span><span class="value" id="stat-distinct-templates">-</span></div>
            <div class="stat-card"><span class="label">最高慢 SQL 耗时</span><span class="value" id="stat-max-cost" style="color: var(--accent-red);">-</span></div>
            <div class="stat-card"><span class="label">独立 Trace 动作数</span><span class="value" id="stat-total-traces" style="color: var(--accent-green);">-</span></div>
        </div>

        <div class="tabs">
            <button class="tab-btn active" onclick="switchTab('repeated')">📊 SQL 频次榜 (Top Repeated)</button>
            <button class="tab-btn" onclick="switchTab('slow')">🐢 慢 SQL 排行 (Top Slow)</button>
            <button class="tab-btn" onclick="switchTab('trace')">🔗 Trace 链路分析</button>
            <button class="tab-btn" onclick="switchTab('diagnose')">💡 N+1 冗余诊断</button>
            <button class="tab-btn" onclick="switchTab('query')">🔍 自由 DuckDB SQL 控制台</button>
        </div>

        <!-- 频次榜 Panel -->
        <div id="panel-repeated" class="panel active">
            <div class="toolbar">
                <input type="text" id="search-repeated" class="search-input" placeholder="搜索 SQL 模板关键词（如表名 BK_... / ECO_...）" oninput="filterRepeatedTable()">
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
            </div>
        </div>

        <!-- 慢 SQL Panel -->
        <div id="panel-slow" class="panel">
            <div class="toolbar">
                <input type="text" id="search-slow" class="search-input" placeholder="搜索慢 SQL 语句..." oninput="filterSlowTable()">
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
                    
                    if (d.parseStats) {
                        document.getElementById('parse-time').innerText = \`扫描 \${d.parseStats.totalFiles} 个文件, \${d.parseStats.totalLines} 行日志, 提取 \${d.parseStats.totalRecords} 条 SQL (耗时 \${d.parseStats.costMs} ms)\`;
                    }
                }
            } catch(e) {}

            loadRepeated();
            loadSlow();
            loadDiagnostics();
        }

        function switchTab(name) {
            document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
            
            event.target.classList.add('active');
            document.getElementById('panel-' + name).classList.add('active');
        }

        async function loadRepeated() {
            const res = await fetch('/api/top-repeated?limit=50');
            const json = await res.json();
            if (json.success) {
                rawRepeatedData = json.data;
                renderRepeatedTable(rawRepeatedData);
            }
        }

        function renderRepeatedTable(data) {
            const tbody = document.getElementById('repeated-tbody');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align: center;">未找到符合条件的 SQL</td></tr>';
                return;
            }
            tbody.innerHTML = data.map((r, i) => \`
                <tr>
                    <td>\${i + 1}</td>
                    <td><span class="tag-freq">\${r.count} 次</span></td>
                    <td>\${r.total_time_ms} ms</td>
                    <td>\${r.avg_time_ms} ms</td>
                    <td>\${r.max_time_ms} ms</td>
                    <td>\${r.trace_count}</td>
                    <td>
                        <div class="sql-code">\${escapeHtml(r.sql_template)}</div>
                        <button class="copy-btn" onclick="copyText(\\\`\${escapeJs(r.sql_template)}\\\`)">复制 SQL 模板</button>
                    </td>
                </tr>
            \`).join('');
        }

        function filterRepeatedTable() {
            const q = document.getElementById('search-repeated').value.toLowerCase();
            const filtered = rawRepeatedData.filter(d => (d.sql_template || '').toLowerCase().includes(q));
            renderRepeatedTable(filtered);
        }

        async function loadSlow() {
            const res = await fetch('/api/top-slow?limit=50');
            const json = await res.json();
            if (json.success) {
                rawSlowData = json.data;
                renderSlowTable(rawSlowData);
            }
        }

        function renderSlowTable(data) {
            const tbody = document.getElementById('slow-tbody');
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align: center;">未找到符合条件的慢 SQL</td></tr>';
                return;
            }
            tbody.innerHTML = data.map((r, i) => \`
                <tr>
                    <td>\${i + 1}</td>
                    <td><span class="tag-slow">\${r.exec_time_ms} ms</span></td>
                    <td><a class="trace-link" onclick="jumpToTrace('\${r.trace_id}')">\${r.trace_id}</a></td>
                    <td>\${r.log_time}</td>
                    <td>\${r.result_rows}</td>
                    <td>
                        <div class="sql-code">\${escapeHtml(r.full_sql || r.sql_template)}</div>
                        <button class="copy-btn" onclick="copyText(\\\`\${escapeJs(r.full_sql || r.sql_template)}\\\`)">复制完整 SQL</button>
                    </td>
                </tr>
            \`).join('');
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

                tbody.innerHTML = data.map((r, i) => \`
                    <tr>
                        <td>\${i + 1}</td>
                        <td>\${r.log_time}</td>
                        <td><span class="\${r.exec_time_ms > 50 ? 'tag-slow' : ''}">\${r.exec_time_ms} ms</span></td>
                        <td>\${r.result_rows}</td>
                        <td>
                            <div class="sql-code">\${escapeHtml(r.full_sql || r.sql_template)}</div>
                            <button class="copy-btn" onclick="copyText(\\\`\${escapeJs(r.full_sql || r.sql_template)}\\\`)">复制</button>
                        </td>
                    </tr>
                \`).join('');
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

module.exports = { createServer };
