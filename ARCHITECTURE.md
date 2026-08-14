# 项目架构与代码结构文档 (ARCHITECTURE)

> 本文档供 AI 和开发者快速理解项目全貌，修改代码前请先阅读。

## 目录结构

```
analyzeSqlLog/
├── index.js              # 入口文件：CLI 参数解析 → 日志解析 → DuckDB 装载 → HTTP 服务启动
├── parser.js             # 核心解析器：流式状态机 + Worker Threads 多核并行
├── db.js                 # 数据库层：DuckDB 纯内存存储、聚合查询、JSON 流式批量导入
├── server.js             # HTTP 服务 + 完整前端 SPA（API 路由 + 内嵌 HTML/CSS/JS Dashboard）
├── AGENTS.md             # AI 开发行为规范（测试纪律、提交规范）
├── ARCHITECTURE.md       # 本文档（项目架构与代码结构）
├── README.md             # 用户使用手册与功能特性介绍
├── package.json          # 依赖：duckdb ^1.2.0（唯一运行时依赖）
└── test/
    ├── benchmark.test.js # 性能基准测试（3 项基准：向量插入、GROUP BY 聚合、大文本解析速度）
    ├── parser.test.js    # 功能与集成测试（编号 1~30，包含解析、状态机、多核、DB、E2E DOM 等）
    └── fixtures/         # 测试用真实日志文件（含 .log 与 .gz）
```

---

## 数据流架构

```
[日志文件/目录 (含 .log / .gz)]
     │
     ▼
 index.js ──→ parseLogs(targetPath, onRecord)
     │              │
     │    ┌─────────┴───────────┐
     │    │  Worker Thread 1    │  ← parser.js (子线程模式)
     │    │  Worker Thread 2    │     每个 Worker 独立解析分配的文件
     │    │  Worker Thread N    │     每 10,000 条 postMessage 回主线程
     │    └─────────┬───────────┘
     │              │ onRecord 异步背压回调
     │              ▼
     │    db.insertBatch(records)  ← 每 10,000 条触发一次 (Promise 链式串行)
     │              │
     │              ▼
     │    DuckDB 内存数据库
     │    (JSON 临时文件 → read_json_auto 向量化导入)
     │              │
     ▼              ▼
 createServer(db, parseStats, 3000)
     │
     ├── GET /                     → getDashboardHtml() 返回完整 SPA 页面
     ├── GET /api/summary          → 概览统计 (总数、耗时、模板数等)
     ├── GET /api/trace-summary-list → Trace 聚合大盘 (按 Trace 分组，总耗时降序)
     ├── GET /api/diagnostics      → 事务内重复 SQL (N+1) 循环诊断
     ├── GET /api/top-repeated     → SQL 频次榜 (参数化模板 GROUP BY 聚合)
     ├── GET /api/top-slow         → 慢 SQL 排行 (全表 ORDER BY exec_time_ms DESC)
     ├── GET /api/trace            → Trace 链路全序列还原 (分页或全量)
     ├── GET /api/by-template      → 按 SQL 模板精确查询调用 (支持 traceId+dbManager 过滤)
     └── GET /api/decompress-gz    → 解压 .gz 文件并返回解压路径用于 VSCode 定位
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
| `parseTimeToMs` | `(timeStr)` | 耗时字符串转毫秒数（支持 `ms/s/m` + `TimeCostLevel` 扩展格式） |
| `cleanSqlText` | `(text)` | 清理 SQL 文本（去 `>` 前缀、换行符、尾部 `]`） |

**状态机机制：**
- `captureState` 枚举值：`null` | `'sql_template'` | `'full_sql'`
- 逐行扫描日志，遇到 `isLogHeader()` 判定为新记录 Header → 刷出上一条并触发 `onRecord` → 创建新 `currentRecord`
- 支持处理一条日志内包含连续多个 SQL 执行块的场景，保证零覆盖、零断句割裂防污染。

**解析出的记录结构 (currentRecord)：**
```javascript
{
  id: Number,             // 全局递增唯一 ID
  log_time: String,       // 日志时间戳 (前23位: "2026-08-12 13:44:26.001")
  trace_id: String,       // 链路追踪 ID
  thread_name: String,    // 线程名称
  exec_time_ms: Number,   // SQL 执行耗时 (毫秒)
  result_rows: Number,    // 影响/结果行数
  db_manager: String,     // DB Manager / 事务句柄名 (如 com.bokesoft.yes.mid...MySqlDBManager@15fcc93b)
  sql_template: String,   // SQL 参数化模板 (占位符 ?)
  sql_params: String,     // SQL 绑定的参数值
  full_sql: String,       // 拼接后的完整 SQL 语句
  line_number: Number,    // 该 SQL 记录在源日志文件中的 Header 起始行号 (1-indexed)
  source_file: String     // 源日志文件的绝对路径
}
```

**Worker Threads 并行策略：**
- 条件：扫描文件数 > 1 且 CPU 核心数 > 1 且处于主线程
- 分发：按 CPU 核心数均分文件列表给各个 Worker 子线程
- 通信：Worker 每 10,000 条记录通过 `parentPort.postMessage({ type: 'batch', records })` 发送给主线程
- 降级：单文件或单核环境下自动走单线程串行流式解析

**支持的文件格式：**
- 目录扫描：递归扫描深度子目录下的 `.log`, `.txt`, `.gz`, `.log.gz`（文件名包含 `server-info` 或 `server-error`）
- `.gz` 压缩文件：自动接入 `zlib.createGunzip()` 管道解压流式处理

---

### 3. db.js — 数据库层

**Class: `SqlLogDatabase`**

| 方法 | 签名 | 说明 |
|------|------|------|
| `constructor` | `(dbPath = ':memory:')` | 初始化 DuckDB 实例 |
| `initSchema` | `()` | 创建 sqllogs 表和索引 |
| `insertBatch` | `(records)` | 通过 Promise 链串行化批量插入 |
| `_doInsertBatch` | `(records)` | 内部实现：JSON 临时文件 → `read_json_auto` 向量化导入 |
| `query` | `(sql, params = [])` | 通用 SQL 查询封装 |
| `getTotalSummary` | `()` | 全库概览统计（总 SQL 数、模板数、最大耗时、总耗时、Trace 数等） |
| `getTraceSummaryList` | `(page, pageSize, keyword, minCostMs)` | Trace 聚合大盘（按 TraceID 分组，按累计总耗时降序 + SQL 计数降序） |
| `getTopRepeated` | `(page, pageSize, keyword)` | SQL 频次榜（全库 SQL 模板 GROUP BY 聚合，支持全库关键词搜索） |
| `getTopSlow` | `(page, pageSize, traceId, minCostMs, keyword)` | 慢 SQL 排行 (ORDER BY exec_time_ms DESC) |
| `getByTraceId` | `(traceId, page, pageSize)` | 按 TraceID 查询链路数据（原生时间线，包含全链路总耗时与平均耗时度量） |
| `getByTemplate` | `(sqlTemplate, page, pageSize, traceId, dbManager)` | 按 SQL 模板查询所有调用明细（支持 traceId+dbManager 联合精准过滤） |
| `getDiagnostics` | `(traceId, page, pageSize, minRepeatCount, keyword)` | N+1 循环检测（同一 dbManager 事务句柄内重复执行 ≥ N 次） |
| `close` | `()` | 关闭数据库连接并释放底层 C++ 资源 |

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
1. JS 数组 → `JSON.stringify` → 写入 `os.tmpdir()` 临时 JSON 文件；
2. DuckDB 执行 `INSERT INTO sqllogs SELECT ... FROM read_json_auto(tmpPath)`（利用 DuckDB C++ 向量化解析器导入）；
3. 在 `finally` 块中立即调用 `fs.unlinkSync` 清理临时文件。

**insertChain Promise 链：**
- `this.insertChain = this.insertChain.then(...)` 将所有插入操作严格串行化，彻底消除 DuckDB 底层 C++ 引擎的并发写入 `TransactionContext` 冲突。

---

### 4. server.js — HTTP 服务 + 前端 SPA

**导出函数：**
| 函数 | 签名 | 说明 |
|------|------|------|
| `createServer` | `(dbInstance, parseStats, port = 3000)` | 创建 HTTP 服务器并挂载全部 API 路由与 Dashboard SPA |
| `compressSqlColumns` | `(sql)` | 智能将超多列的 `SELECT col1, col2... FROM` 折叠为 `select ... from` |

**API 路由列表：**

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/` | - | 返回完整 Dashboard 前端页面 |
| GET | `/api/summary` | - | 概览统计数据 |
| GET | `/api/trace-summary-list` | `page, pageSize, keyword, minCostMs` | Trace 聚合大盘（总耗时降序） |
| GET | `/api/diagnostics` | `traceId, page, pageSize, minRepeatCount, keyword` | 事务内重复 SQL (N+1) 诊断 |
| GET | `/api/top-repeated` | `page, pageSize, keyword` | SQL 频次榜 |
| GET | `/api/top-slow` | `page, pageSize, traceId, minCostMs, keyword` | 慢 SQL 排行 |
| GET | `/api/trace` | `traceId, page, pageSize` | Trace 链路查询（按日志时间先后排序） |
| GET | `/api/by-template` | `sqlTemplate, page, pageSize, traceId, dbManager` | 按 SQL 模板查询调用（支持 TraceID+事务句柄联合过滤） |
| GET | `/api/decompress-gz` | `filePath` | 解压 `.gz` 到临时目录并返回解压后路径 |

**前端 SPA 六大 Tab 面板：**

| Tab (data-tab) | 标题 | 说明 |
|----------------|------|------|
| `trace-summary`| 🌐 Trace 聚合大盘 | 按 TraceID 聚合分组，累计总耗时优先降序，支持一键穿透至链路/N+1/慢SQL |
| `diagnose`     | 🔁 事务内重复 SQL (N+1) | 默认首页，基于 dbManager 检测同一事务连接内重复 SQL，支持手填阈值与穿透 |
| `repeated`     | 📊 SQL 频次榜 | 全库参数化 SQL 模板聚合，汇总频次与耗时，支持一键查看调用 |
| `slow`         | 🐢 慢 SQL 排行 | 按单条耗时降序，支持阈值过滤与一键唤起 VSCode 定位 |
| `trace`        | 🔗 Trace 链路分析 | 按 TraceID 还原时间线序列，支持链路内即时搜索与 VSCode 定位 |
| `detail`       | 📋 SQL 调用明细 | 由频次榜/诊断面板「查看调用」跳转触发，展示指定模板的所有调用，含 VSCode 跳转 |

**前端关键交互：**
- **频次榜/诊断面板「🔍 查看调用」**：`jumpToDetail(sqlTemplate, contextInfo)` → 携带来源、TraceID、dbManager 事务句柄 Hash、循环/执行次数等完整上下文参数跳转到 `detail` Tab 并显示
- **明细头部（.detail-header）**：完整呈现过滤上下文标签（准确标注来源于 📊 SQL 频次榜 或 🔁 事务内重复 SQL (N+1) 诊断，TraceID 支持直接点击跳转到 Trace 面板）
- **输入防抖与失焦触发**：输入框支持 250ms 防抖 (`oninput`)、失焦立即触发 (`onblur` / `onchange`) 与回车即时触发 (`Enter`)
- **表格紧凑排版**：高精度时间戳（`YYYY-MM-DD HH:mm:ss.SSS`）采用 `.col-time` 单行不折行样式，表格内边距为 `5px 8px`
- **顶部联动统计条**：指标按 **总耗时 -> 总次数 -> 事务数 -> 最高单条耗时** 顺序排列，随当前 Tab 过滤条件动态联动计算
- **VSCode 一键跳转**：点击 `📂 file:line` 直接唤起 VSCode（`.gz` 压缩日志自动在后台调用 `/api/decompress-gz` 解压后打开）
- **SQL 展开与复制**：左键 0ms 切换折叠/展开，右键弹出自定义菜单快速复制完整 SQL

---

### 5. 自动化测试套件

项目拥有 **33 项全自动化测试**，运行 `npm test` 验证：

1. **`test/benchmark.test.js` (3 项性能基准测试)**：
   - 🚀 基准 1：10 万条结构化 SQL 记录 DuckDB Multi-row Chunk 内存装载吞吐率（~95,000+ 条/秒）；
   - 🚀 基准 2：10 万条在库 SQL 的 DuckDB GROUP BY 高维内存聚合与 Top-N 查询耗时（< 50ms）；
   - 🚀 基准 3：50 万行 (57MB) 纯文本日志流式状态机解析速度（~250,000+ 行/秒）。
2. **`test/parser.test.js` (30 项功能与集成测试)**：
   - 用例 1~16：耗时转换、SQL 文本清洗、状态机防割裂、DuckDB 内存分页、文件名过滤、真实 fixtures 读取比对、多列名压缩折叠、TraceID 提取、时间与耗时双向排序、递归子目录扫描、异步背压、Worker Threads 多核并行；
   - 用例 17~24：真实大日志性能装载、Trace 链路大分页、HTTP 服务路由响应、`.gz` 压缩解压、UPDATE 语句过滤、行号与路径落库检索、前端 HTML/JS 语法完备性；
   - 用例 25：基于 `test/fixtures` 真实日志构建的 HTTP API 与 DOM 渲染全流程端到端 E2E 测试；
   - 用例 26~30：以真实 DuckDB 数据库为标准验证 SELECT @@ 语句与连续 SQL 提取、TraceID+dbManager 联合过滤、Trace 聚合大盘多维聚合、慢 SQL/Trace 链路总耗时度量、N+1 动态上下文统计准确性。

---

## 关键设计决策

| 决策 | 说明 |
|------|------|
| **DuckDB 纯内存引擎** | 无持久化磁盘文件开销，每次启动重新极速解析装载，保证数据绝对一致 |
| **JSON 临时文件导入** | 绕过 Node.js ↔ DuckDB C++ 绑定的逐行序列化开销，利用 DuckDB SIMD 向量化引擎批量装载 |
| **Promise 链串行插入** | 解决 DuckDB 底层 C++ 引擎并发写入事务冲突 |
| **Worker Threads** | 多核 CPU 并行切块解析日志文件，充分利用多核算力 |
| **单行不换行与紧凑 UI** | 解决高精度时间戳导致表格行高膨胀问题，提升开发者单屏代码审阅效率 |
| **内嵌 SPA Dashboard** | 整个前端页面内联在 server.js 中，零前端构建依赖，开箱即用 |
| **零外部运行时依赖** | 仅依赖 `duckdb`，无 Express/Koa 等厚重框架 |
