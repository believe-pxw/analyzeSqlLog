# 项目架构与代码结构文档 (ARCHITECTURE)

> 本文档供 AI 和开发者快速理解项目全貌，修改代码前请先阅读。

## 目录结构

```
analyzeSqlLog/
├── index.js          # 入口文件：CLI 参数解析 → 日志解析 → DuckDB 装载 → HTTP 服务启动
├── parser.js         # 核心解析器：流式状态机 + Worker Threads 多核并行
├── db.js             # 数据库层：DuckDB 纯内存存储、聚合查询、JSON 流式批量导入
├── server.js         # HTTP 服务 + 完整前端 SPA（API 路由 + 内嵌 HTML/CSS/JS Dashboard）
├── AGENTS.md         # AI 开发行为规范（测试纪律、提交规范）
├── ARCHITECTURE.md   # 本文档（项目架构与代码结构）
├── package.json      # 依赖：duckdb ^1.2.0（唯一运行时依赖）
└── test/
    ├── parser.test.js    # 测试用例（编号 1~23，含性能基准测试）
    └── fixtures/         # 测试用真实日志文件
```

---

## 数据流架构

```
[日志文件/目录]
     │
     ▼
 index.js ──→ parseLogs(targetPath, onRecord)
     │              │
     │    ┌─────────┴───────────┐
     │    │  Worker Thread 1    │  ← parser.js (子线程模式)
     │    │  Worker Thread 2    │     每个 Worker 独立解析分配的文件
     │    │  Worker Thread N    │     每 10,000 条 postMessage 回主线程
     │    └─────────┬───────────┘
     │              │ onRecord 回调
     │              ▼
     │    db.insertBatch(records)  ← 每 10,000 条触发一次
     │              │
     │              ▼
     │    DuckDB 内存数据库
     │    (JSON 临时文件 → read_json_auto 向量化导入)
     │              │
     ▼              ▼
 createServer(db, parseStats, 3000)
     │
     ├── GET /              → getDashboardHtml() 返回完整 SPA 页面
     ├── GET /api/summary   → 概览统计
     ├── GET /api/top-slow  → 慢 SQL 排行
     ├── GET /api/top-repeated → SQL 频次榜
     ├── GET /api/trace     → Trace 链路查询
     ├── GET /api/diagnostics → N+1 循环诊断
     ├── GET /api/by-template → 按 SQL 模板查询所有调用明细
     └── GET /api/decompress-gz → 解压 .gz 文件返回解压路径
```

---

## 核心模块详解

### 1. index.js — 入口

```
入口流程：
1. 解析 CLI 参数 process.argv[2] → targetPath（可选，默认当前目录）
2. new SqlLogDatabase(':memory:') → db.initSchema()
3. parseLogs(targetPath, onRecord) → 流式解析
4. onRecord 回调中缓冲 10,000 条 → db.insertBatch()
5. createServer(db, parseStats, 3000) → 启动 HTTP 服务 + 自动打开浏览器
```

**命令行用法：**
```bash
node index.js [日志文件或目录路径]
```

---

### 2. parser.js — 日志解析器

**导出函数：**
| 函数 | 签名 | 说明 |
|------|------|------|
| `parseLogs` | `(targetPath, onRecord)` | 主入口，自动多核并行或单线程解析 |
| `parseLogFile` | `(filePath, onRecord, startRecordId = 0)` | 单文件流式解析 |
| `parseTimeToMs` | `(timeStr)` | 耗时字符串转毫秒数（支持 `ms/s/m` + `TimeCostLevel` 格式） |
| `cleanSqlText` | `(text)` | 清理 SQL 文本（去 `>` 前缀、换行符、尾部 `]`） |

**状态机：**
- `captureState` 枚举值：`null` | `'sql_template'` | `'full_sql'`
- 逐行处理，遇到 `isLogHeader()` 判定为新记录 Header → 刷出上一条 → 创建新 `currentRecord`

**解析出的记录结构 (currentRecord)：**
```javascript
{
  id: Number,             // 全局递增唯一 ID
  log_time: String,       // 日志时间戳 (前23位: "2026-08-12 13:44:26.001")
  trace_id: String,       // 链路追踪 ID
  thread_name: String,    // 线程名称
  exec_time_ms: Number,   // SQL 执行耗时(毫秒)
  result_rows: Number,    // 影响/结果行数
  db_manager: String,     // DB Manager / 事务句柄名
  sql_template: String,   // SQL 参数化模板 (占位符 ?)
  sql_params: String,     // SQL 绑定的参数值
  full_sql: String,       // 拼接后的完整 SQL 语句
  line_number: Number,    // 该 SQL 记录在源日志文件中的 Header 起始行号 (1-indexed)
  source_file: String     // 源日志文件的绝对路径
}
```

**Worker Threads 并行策略：**
- 条件：文件数 > 1 且 CPU 核心数 > 1 且处于主线程
- 分发：按 CPU 核心数均分文件列表给各 Worker
- 通信：Worker 每 10,000 条记录 `postMessage({ type: 'batch', records })` 回主线程
- 降级：单文件或单核时自动走单线程串行

**支持的文件格式：**
- 目录扫描：`.log`, `.txt`, `.gz`, `.log.gz`（文件名须含 `server-info` 或 `server-error`）
- `.gz` 文件：自动使用 `zlib.createGunzip()` 管道解压后流式解析

---

### 3. db.js — 数据库层

**Class: `SqlLogDatabase`**

| 方法 | 签名 | 说明 |
|------|------|------|
| `constructor` | `(dbPath = ':memory:')` | 初始化 DuckDB 实例 |
| `initSchema` | `()` | 创建 sqllogs 表和索引 |
| `insertBatch` | `(records)` | 通过 Promise 链串行化批量插入 |
| `_doInsertBatch` | `(records)` | 内部实现：JSON 临时文件 → `read_json_auto` 向量化导入 |
| `query` | `(sql, params = [])` | 通用查询 |
| `getTotalSummary` | `()` | 概览统计（总数、模板数、最大耗时等） |
| `getTopRepeated` | `(page, pageSize, traceId, excludeBackground)` | SQL 频次 GROUP BY 聚合排行 |
| `getTopSlow` | `(page, pageSize, traceId, excludeBackground)` | 慢 SQL 排行 (ORDER BY exec_time_ms DESC) |
| `getByTraceId` | `(traceId, page, pageSize)` | 按 TraceID 查询链路数据 |
| `getByTemplate` | `(sqlTemplate, page, pageSize)` | 按 SQL 模板精确查询所有调用明细 |
| `getDiagnostics` | `(traceId)` | N+1 循环检测（同 dbManager+traceId 内重复 ≥ 5 次） |
| `close` | `()` | 关闭数据库连接 |

**表结构 `sqllogs`：**
```sql
CREATE TABLE sqllogs (
  id            BIGINT PRIMARY KEY,
  log_time      VARCHAR,
  trace_id      VARCHAR,
  thread_name   VARCHAR,
  exec_time_ms  DOUBLE,
  result_rows   INT,
  db_manager    VARCHAR,
  sql_template  VARCHAR,
  sql_params    VARCHAR,
  full_sql      VARCHAR,
  line_number   INT,          -- SQL Header 所在的源文件行号
  source_file   VARCHAR       -- 源日志文件绝对路径
);
-- 索引
CREATE INDEX idx_trace_id  ON sqllogs(trace_id);
CREATE INDEX idx_exec_time ON sqllogs(exec_time_ms);
```

**批量插入机制 (JSON stream)：**
1. JS 数组 → `JSON.stringify` → 写入 `os.tmpdir()` 临时 JSON 文件
2. DuckDB 执行 `INSERT INTO sqllogs SELECT ... FROM read_json_auto(tmpPath)` (C++ SIMD 向量化引擎极速导入)
3. `finally` 块中 `fs.unlinkSync` 清理临时文件

**insertChain Promise 链：**
- `this.insertChain = this.insertChain.then(...)` 将所有插入操作串行化
- 解决 DuckDB 底层 C++ 并发写入的 `TransactionContext` 事务冲突

---

### 4. server.js — HTTP 服务 + 前端 SPA

**导出函数：**
| 函数 | 签名 | 说明 |
|------|------|------|
| `createServer` | `(dbInstance, parseStats, port = 3000)` | 创建 HTTP 服务器 |
| `compressSqlColumns` | `(sql)` | 将 SELECT 多列名 SQL 折叠为 `SELECT ... FROM` |

**API 路由：**

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/` | - | 返回完整 Dashboard HTML |
| GET | `/api/summary` | - | 概览统计数据 |
| GET | `/api/top-repeated` | `page, pageSize, traceId, excludeBackground` | SQL 频次榜 |
| GET | `/api/top-slow` | `page, pageSize, traceId, excludeBackground` | 慢 SQL 排行 |
| GET | `/api/trace` | `traceId, page, pageSize` | Trace 链路查询 |
| GET | `/api/diagnostics` | `traceId, page, pageSize` | 事务内重复 SQL (N+1) 循环诊断 |
| GET | `/api/by-template` | `sqlTemplate, page, pageSize` | 按 SQL 模板查所有调用 |
| GET | `/api/decompress-gz` | `filePath` | 解压 .gz 到临时目录 |

**前端 SPA Tab 面板：**

| Tab (data-tab) | 标题 | 说明 |
|----------------|------|------|
| `diagnose` | 🔁 事务内重复 SQL (N+1) 诊断 | 默认首页，基于 dbManager 句柄检测同一事务连接内重复 SQL |
| `slow` | 🐢 慢 SQL 排行 | 按耗时降序，含 VSCode 跳转 |
| `trace` | 🔗 Trace 链路分析 | 按 TraceID 查询时间线，含 VSCode 跳转 |
| `repeated` | 📊 SQL 频次榜 | 按 SQL 模板聚合次数，含「查看调用」联动 |
| `detail` | 📋 SQL 调用明细 | 由频次榜/诊断面板「查看调用」跳转触发，含 VSCode 跳转 |
| `overview` | 📈 概览统计分析 | 统计卡片（总数/模板数/最大耗时等） |

**前端关键交互：**
- 频次榜/诊断面板「🔍 查看调用」→ `jumpToDetail(sqlTemplate, contextInfo)` → 携带来源、TraceID、dbManager 事务句柄 Hash、循环/执行次数等完整上下文参数跳转到 `detail` Tab 并显示（使用 `skipAutoLoad` 标记消除双重请求与抖动，不强制修改用户当前视口滚动位置）
- 明细头部（.detail-header）：完整呈现过滤上下文标签（准确标注来源于 📊 SQL 频次榜 或 🔁 事务内重复 SQL (N+1) 诊断，TraceID 支持直接点击跳转到 Trace 面板）
- 灵活阈值过滤：诊断面板支持手填重复次数阈值（`<input type="number" id="inp-min-repeat">`），慢 SQL 面板支持手填最小耗时阈值（`<input type="number" id="inp-min-cost">`）
- 消除跳转抖动：CSS `html { overflow-y: scroll; }` 锁死纵向滚动条槽位；`.table-container` 设为 `min-height: 360px` 稳定框架高度；跨面板按钮跳转使用 `switchTab(name, true)` 且不强制触置顶滚动，保持当前 Viewport 绝对平稳不晃动
- .gz 文件跳转：先调 `/api/decompress-gz` 解压 → 再用 `vscode://file/` 打开解压后文件
- SQL 展开/收起：左键点击切换 `data-brief` / `data-full`（表格与明细头部 SQL 卡片均支持）
- SQL 右键复制：自定义 Context Menu → 复制到剪贴板（包含明细头部右上角`📋 复制完整 SQL 模板`按钮）

**⚠️ 重要的代码约束（server.js 编辑须知）：**
- `getDashboardHtml()` 返回的是 Node.js 的**模板字符串**，内含完整的前端 JS 代码
- 前端 JS 中的 `${}` 和反引号 `` ` `` 必须用反斜杠转义为 `\${}` 和 `` \` ``
- 否则 Node.js 会在服务端解析这些变量，而不是将它们传递到浏览器端
- 示例：前端 `fetch(\`/api/xxx?page=\${page}\`)` 在 server.js 源码中必须写成 `fetch(\\`/api/xxx?page=\\${page}\\`)`

---

### 5. test/parser.test.js — 测试

- **共 25 个测试用例**，编号 `1` ~ `25`
- 前 3 个为性能基准测试（10万条插入、聚合查询、50万行解析）
- 测试 24：自动化校验 `server.js` 渲染的前端 HTML/JS 绝对零语法错误，并增加全量 `<table>` 与 `</table>` 标签闭合配对计数断言及 6 大 Panel 节点完备性校验
- **测试 25：基于 `test/fixtures` 真实日志构建的 Web 页面全流程端到端集成测试（结合 HTTP API 真实响应与前端 DOM 渲染），严格断言每个 Tab 页面（频次榜、慢SQL、明细、Trace链路等）100% 均能成功渲染出 <tr>...</tr> 真实数据节点与交互按钮**
- 运行命令：`npm test`

---

## 关键设计决策

| 决策 | 说明 |
|------|------|
| **DuckDB 纯内存** | 无持久化磁盘文件，每次启动重新解析装载，保证数据一致性 |
| **JSON 临时文件导入** | 绕过 Node.js ↔ DuckDB C++ 绑定的序列化开销，利用 DuckDB SIMD 向量化引擎 |
| **Promise 链串行插入** | 避免 DuckDB 并发写入事务冲突 |
| **Worker Threads** | 多核 CPU 并行解析日志文件，显著提升解析速度 |
| **内嵌 SPA** | 整个前端页面内联在 server.js 的模板字符串中，零前端构建依赖 |
| **零外部运行时依赖** | 仅依赖 `duckdb`，无 Express/Koa 等框架 |
