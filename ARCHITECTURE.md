# 项目架构与代码结构文档 (ARCHITECTURE)

> 本文档供 AI 和开发者快速理解项目全貌，修改代码前请先阅读。

## 目录结构

```
analyzeSqlLog/
├── index.js              # 入口文件：CLI 参数解析 → 日志解析 → DuckDB 装载 → HTTP 服务启动
├── parser.js             # 核心解析器：流式状态机 + Worker Threads 多核并行 + ActionRecorder 性能日志解析
├── db.js                 # 数据库层：DuckDB 纯内存存储、聚合查询、JSON 流式批量导入、性能调用树组装
├── server.js             # HTTP 服务 + 完整前端 SPA（API 路由 + 内嵌 HTML/CSS/JS Dashboard）
├── AGENTS.md             # AI 开发行为规范（测试纪律、提交规范）
├── ARCHITECTURE.md       # 本文档（项目架构与代码结构）
├── README.md             # 用户使用手册与功能特性介绍
├── package.json          # CLI 命令 parselog、sqllog，依赖 duckdb ^1.2.0
└── test/
    ├── benchmark.test.js # 性能基准测试（3 项基准：向量插入、GROUP BY 聚合、大文本解析速度）
    ├── parser.test.js    # 功能与集成测试（编号 1~38，包含解析、状态机、多核、DB、性能树、E2E DOM 等）
    └── fixtures/         # 测试用真实日志文件（含 .log 与 .gz）
```

---

## 数据流架构

```
[日志文件/目录 (含 .log / .gz)]
     │
     ▼
 index.js ──→ parseLogs(targetPath, onRecord, onPerfTrace)
     │              │
     │    ┌─────────┴───────────┐
     │    │  Worker Thread 1    │  ← parser.js (子线程模式)
     │    │  Worker Thread 2    │     每个 Worker 独立解析分配的文件
     │    │  Worker Thread N    │     每 10,000 条 postMessage 回主线程
     │    └─────────┬───────────┘
     │              │ onRecord / onPerfTrace 异步背压回调
     │              ▼
     │    db.insertBatch(records) / db.insertPerfBatch(traces, actions)
     │              │
     │              ▼
     │    DuckDB 内存数据库 (sqllogs, perf_traces, perf_actions)
     │    (JSON 临时文件 → read_json_auto 向量化导入)
     │              │
     ▼              ▼
 createServer(db, parseStats, 3000)
     │
     ├── GET /                     → getDashboardHtml() 返回完整 SPA 页面
     ├── GET /api/summary          → 概览统计 (总数、耗时、模板数等)
     ├── GET /api/perf-trace-list  → 性能链路树请求列表 (多维四维耗时大盘)
     ├── GET /api/perf-tree        → 单笔请求完整性能剖析树 + Top 5 自耗时热点 + SQL 关联
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
3. parseLogs(targetPath, onRecord, 0, onPerfTrace) → 流式解析
4. onRecord 回调中缓冲 10,000 条 → db.insertBatch()；onPerfTrace 缓冲 50 条 → db.insertPerfBatch()
5. createServer(db, parseStats, 3000) → 启动 HTTP 服务 + 自动打开浏览器
```

**命令行用法：**
```bash
parselog [日志文件或目录路径]
# 或使用兼容别名
sqllog [日志文件或目录路径]
```

---

### 2. parser.js — 日志解析器

**导出函数：**
| 函数 | 签名 | 说明 |
|------|------|------|
| `parseLogs` | `(targetPath, onRecord, onPerfTrace)` | 主入口，自动多核并行或单线程解析 |
| `parseLogFile` | `(filePath, onRecord, startRecordId = 0, onPerfTrace = null)` | 单文件流式解析（同时支持 SQL 日志与 ActionRecorder 性能日志） |
| `parseActionLine` | `(line)` | 解析 ActionRecorder 性能日志单行，换算微秒耗时为毫秒 |
| `parseTimeToMs` | `(timeStr)` | 耗时字符串转毫秒数（支持 `ms/s/m` + `TimeCostLevel` 扩展格式） |
| `cleanSqlText` | `(text)` | 清理 SQL 文本（去 `>` 前缀、换行符、尾部 `]`） |

**多请求会话隔离机制：**
- 当同一个日志线程/Trace 中出现多次独立的 `MidVEFilter.doFilter` 请求执行块时，解析器自动为每次独立请求分配唯一的 Trace Key（`trace_id_#2`, `trace_id_#3`...），并在多请求共享同一 Session TraceID 时以第一层业务 Service 作为唯一归类，确保 Top 5 自耗时热点与方法树不串通。

---

### 3. db.js — 数据库层

**Class: `SqlLogDatabase`**

| 方法 | 签名 | 说明 |
|------|------|------|
| `constructor` | `(dbPath = ':memory:')` | 初始化 DuckDB 实例 |
| `initSchema` | `()` | 创建 sqllogs, perf_traces, perf_actions 表和索引 |
| `insertBatch` | `(records)` | 通过 Promise 链串行化批量插入 SQL 记录 |
| `insertPerfBatch` | `(traces, actions)` | 批量插入 Performance Trace 树记录 |
| `getPerformanceTraceList` | `(page, pageSize, keyword, minCostMs, serviceName)` | 性能链路树请求列表（支持按耗时降序、服务名与关键字过滤） |
| `getPerformanceTree` | `(traceId)` | 组装单笔请求的树形调用链路、四维耗时与 Top 5 自身耗时热点排序 |
| `getTraceSummaryList` | `(page, pageSize, keyword, minCostMs)` | Trace 聚合大盘（按 TraceID 分组，按累计总耗时降序） |
| `getDiagnostics` | `(traceId, page, pageSize, minRepeatCount, keyword)` | N+1 循环检测（同一 dbManager 事务句柄内重复执行 ≥ N 次） |
| `close` | `()` | 关闭数据库连接并释放底层 C++ 资源 |

**表结构：**
- `sqllogs`：存储常规 SQL 记录（耗时、模板、参数、完整 SQL、行号、绝对路径）；
- `perf_traces`：存储单次请求性能摘要（总耗时、根自耗时、Java耗时、SQL耗时、提交耗时、首层服务名等）；
- `perf_actions`：存储方法树中每个动作节点（层级、父子节点ID、总耗时、自身净耗时、间隙、关联SQL）。

---

### 4. server.js — HTTP 服务 + 前端 SPA

**API 路由列表：**

| 方法 | 路径 | 参数 | 说明 |
|------|------|------|------|
| GET | `/` | - | 返回完整 Dashboard 前端页面 |
| GET | `/api/summary` | - | 全局概览统计数据 |
| GET | `/api/perf-trace-list` | `page, pageSize, keyword, minCostMs, service` | 性能链路树请求列表大盘 |
| GET | `/api/perf-tree` | `traceId` | 单笔请求的完整方法调用树、Top 5 自耗时热点与关联 SQL |
| GET | `/api/trace-summary-list` | `page, pageSize, keyword, minCostMs` | Trace 聚合大盘（总耗时降序） |
| GET | `/api/diagnostics` | `traceId, page, pageSize, minRepeatCount, keyword` | 事务内重复 SQL (N+1) 诊断 |
| GET | `/api/top-repeated` | `page, pageSize, keyword` | SQL 频次榜 |
| GET | `/api/top-slow` | `page, pageSize, traceId, minCostMs, keyword` | 慢 SQL 排行 |
| GET | `/api/trace` | `traceId, page, pageSize` | Trace 链路查询（按日志时间先后排序） |
| GET | `/api/by-template` | `sqlTemplate, page, pageSize, traceId, dbManager` | 按 SQL 模板查询调用（支持 TraceID+事务句柄联合过滤） |
| GET | `/api/decompress-gz` | `filePath` | 解压 `.gz` 到临时目录并返回解压后路径 |

**前端 SPA 七大 Tab 面板：**

| Tab (data-tab) | 标题 | 说明 |
|----------------|------|------|
| `perf`         | ⚡ 性能链路树 | 全链路方法级性能剖析树，支持自耗时动态阈值过滤展开、分级彩色徽章与四维正交归一大盘 |
| `trace-summary`| 🌐 Trace 聚合大盘 | 按 TraceID 聚合分组，累计总耗时优先降序，支持一键穿透至链路/N+1/慢SQL |
| `diagnose`     | 🔁 事务内重复 SQL (N+1) | 默认首页，基于 dbManager 检测同一事务连接内重复 SQL，支持手填阈值与穿透 |
| `repeated`     | 📊 SQL 频次榜 | 全库参数化 SQL 模板聚合，汇总频次与耗时，支持一键查看调用 |
| `slow`         | 🐢 慢 SQL 排行 | 按单条耗时降序，支持阈值过滤与一键唤起 VSCode 定位 |
| `trace`        | 🔗 Trace 链路分析 | 按 TraceID 还原时间线序列，支持链路内即时搜索与 VSCode 定位 |
| `detail`       | 📋 SQL 调用明细 | 由频次榜/诊断面板「查看调用」跳转触发，展示指定模板的所有调用，含 VSCode 跳转 |

**性能链路树前端核心交互机制：**
- **自耗时 (Self Time) 动态过滤**：纯前端内存计算，支持实时输入阈值 `inp-perf-self-time`，微秒级递归向上展开命中节点的全链路祖先树，并赋予黄色高亮背景（`#fef3c7`）；
- **自耗时分级彩色徽章**：自耗时列采用 `cost-badge` 分级彩色渲染（$\ge 500\text{ms}$ 🔴 红、$\ge 50\text{ms}$ 🟡 黄、$\ge 10\text{ms}$ 🟣 紫、$< 10\text{ms}$ 🔵 蓝）；
- **四维正交卡片**：请求总耗时 = 🟪 Java 业务纯耗时 + 🟦 数据库 SQL 执行 + 🟩 事务提交阶段，数据 100% 正交严谨；
- **分层按需秒开（方案 1）**：Level 0/1 默认展开，深层分支按需展开，5ms 瞬间完成万级节点 DOM 挂载。

---

### 5. 自动化测试套件

项目内置 **41 项全自动化测试**，运行 `npm test` 验证：

1. **`test/benchmark.test.js` (3 项性能基准测试)**：
   - 🚀 基准 1：10 万条结构化 SQL 记录 DuckDB Multi-row Chunk 内存装载吞吐率（~95,000+ 条/秒）；
   - 🚀 基准 2：10 万条在库 SQL 的 DuckDB GROUP BY 高维内存聚合与 Top-N 查询耗时（< 50ms）；
   - 🚀 基准 3：50 万行 (57MB) 纯文本日志流式状态机解析速度（~250,000+ 行/秒）。
2. **`test/parser.test.js` (38 项功能与集成测试)**：
   - 用例 1~16：耗时转换、SQL 文本清洗、状态机防割裂、DuckDB 内存分页、文件名过滤、真实 fixtures 读取比对、多列名压缩折叠、TraceID 提取、时间与耗时双向排序、递归子目录扫描、异步背压、Worker Threads 多核并行；
   - 用例 17~24：真实大日志性能装载、Trace 链路大分页、HTTP 服务路由响应、`.gz` 压缩解压、UPDATE 语句过滤、行号与路径落库检索、前端 HTML/JS 语法完备性；
   - 用例 25：基于 `test/fixtures` 真实日志构建的 HTTP API 与 DOM 渲染全流程端到端 E2E 测试；
   - 用例 26~30：以真实 DuckDB 数据库为标准验证 SELECT @@ 语句与连续 SQL 提取、TraceID+dbManager 联合过滤、Trace 聚合大盘多维聚合、慢 SQL/Trace 链路总耗时度量、N+1 动态上下文统计准确性；
   - 用例 31~38：性能动作行解析、ActionRecorder 流式解析与 SQL 关联、DuckDB 向量化存储与查询、深度调用树组装与 Top 5 自耗时热点、端到端 HTTP API 与前端 Tab 渲染、多请求 TraceID 隔离与 Service 归类、SQL 控件多列折叠与分层折叠按需渲染、自耗时动态过滤展开与概览卡片正交归一断言。

---

## 关键设计决策

| 决策 | 说明 |
|------|------|
| **DuckDB 纯内存引擎** | 无持久化磁盘文件开销，每次启动重新极速解析装载，保证数据绝对一致 |
| **JSON 临时文件导入** | 绕过 Node.js ↔ DuckDB C++ 绑定的逐行序列化开销，利用 DuckDB SIMD 向量化引擎批量装载 |
| **Promise 链串行插入** | 解决 DuckDB 底层 C++ 引擎并发写入事务冲突 |
| **前端内存纯本地过滤** | 性能树的自耗时过滤与慢链路展开完全在前端内存中完成，零网络往返延迟，打字即时联动 |
| **分层按需秒开渲染** | 默认折叠深层节点，万级节点 5ms 瞬间加载渲染，避免大量 DOM 阻塞 |
| **内嵌 SPA Dashboard** | 整个前端页面内联在 server.js 中，零前端构建依赖，开箱即用 |
| **零外部运行时依赖** | 仅依赖 `duckdb`，无 Express/Koa 等厚重框架 |
