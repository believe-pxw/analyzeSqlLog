# 项目架构与代码结构文档 (ARCHITECTURE)

> 本文档供 AI 和开发者快速理解项目全貌，修改代码前请先阅读。

## 1. 目录结构 (标准 TypeScript 工业级工程架构)

```
analyzeSqlLog/
├── bin/
│   └── parselog.js            # CLI 可执行文件入口 (指向 dist/cli.js)
├── src/                       # 🌟 核心 TypeScript 源码
│   ├── index.ts               # 模块公开 API 导出入口
│   ├── cli.ts                 # CLI 命令行入口与主流程控制
│   ├── types/                 # 🌟 全局 TS 领域模型与类型契约
│   │   ├── log.ts             # 13 维应用日志元数据 (LogHeader, AppLogRecord)
│   │   ├── sql.ts             # SQL 记录、聚合模型与 N+1 诊断模型
│   │   ├── perf.ts            # ActionRecorder 性能树节点与四维耗时大盘
│   │   ├── api.ts             # RESTful API 响应契约与分页参数
│   │   └── index.ts
│   ├── parser/                # 🌟 解析器子系统
│   │   ├── header.ts          # 13 维日志头极速提取器
│   │   ├── header.spec.ts     # 对应规格测试
│   │   ├── sqlParser.ts       # SQL 状态机、文本清洗与多列名折叠
│   │   ├── sqlParser.spec.ts  # 对应规格测试
│   │   ├── perfParser.ts      # ActionRecorder 性能树解析与微秒换算
│   │   ├── perfParser.spec.ts # 对应规格测试
│   │   ├── worker.ts          # Worker Threads 多核并行解析引擎
│   │   └── index.ts           # 解析器统一调度入口 (parseLogs, parseLogFile)
│   ├── db/                    # 🌟 DuckDB 内存分析与 DAO 分层
│   │   ├── connection.ts      # DuckDB 实例生命周期与串行调度器
│   │   ├── schema.ts          # 内存表结构 DDL 与高性能索引
│   │   ├── sqlDao.ts          # SQL 频次榜/慢SQL/N+1循环/Trace聚合查询
│   │   ├── perfDao.ts         # 性能树/四维耗时大盘/Top 5 热点排序
│   │   ├── appLogDao.ts       # 13 维纯净应用日志多维检索与 Span 分布
│   │   ├── db.spec.ts         # 数据库层规格测试
│   │   └── index.ts           # SqlLogDatabase 统一对外门面类
│   └── server/                # 🌟 HTTP 服务与 API 控制器
│       ├── static.ts          # 静态前端资源托管 (dist/web/)
│       └── index.ts           # RESTful API 路由分发与端口自动递增
├── web/                       # 🌟 现代 Vue 3 + TypeScript 前端子工程
│   ├── index.html             # 单页入口 HTML 模板
│   ├── vite.config.ts         # Vite 前端构建配置 (打包至 dist/web)
│   └── src/
│       ├── main.ts            # Vue 应用启动入口
│       ├── App.vue            # 根组件 (Header + 8 大 Tab 切换与全局度量条)
│       ├── types.ts           # 前端数据结构定义
│       ├── api.ts             # 统一 API 客户端封装
│       ├── components/        # 公共通用组件 (CostBadge, Pagination, StackedBar, Toast)
│       └── views/             # 8 大核心功能 Tab 视图
│           ├── PerfTreeTab.vue     # ⚡ 性能链路树与深度剖析 (含递归树)
│           ├── PerfTreeNode.vue    # 递归树节点组件 (支持动态展开与自耗时高亮)
│           ├── AppLogsTab.vue      # 📜 纯净日志透视 (支持级别/Span过滤与堆栈折叠)
│           ├── TraceSummaryTab.vue # 🌐 Trace 聚合大盘
│           ├── DiagnosticsTab.vue  # 🔁 事务内重复 SQL (N+1) 循环诊断
│           ├── RepeatedSqlTab.vue  # 📊 SQL 频次榜
│           ├── SlowSqlTab.vue      # 🐢 慢 SQL 排行
│           ├── TraceDetailTab.vue  # 🔗 Trace 链路时间线分析
│           └── SqlDetailTab.vue    # 📋 SQL 模板调用明细
├── tests/                     # 🌟 端到端与基准测试
│   ├── fixtures/              # 真实日志测试样本 (.log / .gz)
│   ├── e2e/
│   │   └── fullflow.spec.ts   # CLI 解析 → DB 装载 → HTTP API → 前端静态分发全链路规格测试
│   └── benchmark/
│       └── throughput.spec.ts # DuckDB 向量装载与高维内存聚合吞吐基准测试
├── dist/                      # 编译与打包产物
│   ├── cli.js / index.js / worker.js
│   └── web/                   # Vue 3 编译后的纯静态单页资产
├── tsconfig.json              # TypeScript 严格模式编译配置 (strict: true)
├── vitest.config.ts           # Vitest 极速测试框架配置
├── tsup.config.ts             # 后端极速构建打包配置
└── package.json
```

---

## 2. 数据流与系统架构

```
[原始日志文件/目录 (含 .log / .gz)]
        │
        ▼
  src/cli.ts ──→ parseLogs(targetPath, onRecord, onPerfTrace, onAppLog)
        │                 │
        │       ┌─────────┴───────────┐
        │       │  Worker Thread 1    │  ← src/parser/worker.ts (多核并行模式)
        │       │  Worker Thread 2    │     每个 Worker 独立流式解析分配的文件
        │       │  Worker Thread N    │     批量 postMessage 回主线程
        │       └─────────┬───────────┘
        │                 │ 异步批处理装载
        │                 ▼
        │       db.insertBatch() / db.insertPerfBatch() / db.insertAppLogsBatch()
        │                 │
        │                 ▼
        │       DuckDB 内存数据库 (sqllogs, perf_traces, perf_actions, app_logs)
        │       (JSON 临时缓冲 → read_json_auto 向量化极速装载)
        │                 │
        ▼                 ▼
  createServer(db, parseStats, 3000)
        │
        ├── 静态托管 GET /                  → 分发 dist/web/ 静态单页应用 (Vue 3)
        ├── GET /api/summary              → 全局概览统计 (总耗时、总记录数、扫描指标)
        ├── GET /api/perf-trace-list      → 性能链路树请求列表 (四维耗时正交大盘)
        ├── GET /api/perf-tree            → 单笔请求完整性能剖析树 + Top 5 自耗时热点 + SQL 关联
        ├── GET /api/app-logs             → 13 维全量应用日志流 (多维过滤与 Span 分布)
        ├── GET /api/trace-summary-list   → Trace 聚合大盘 (按 TraceID 分组，总耗时降序)
        ├── GET /api/diagnostics          → 事务内重复 SQL (N+1) 循环诊断
        ├── GET /api/top-repeated         → SQL 频次榜 (参数化模板 GROUP BY 聚合)
        ├── GET /api/top-slow             → 慢 SQL 排行 (全表 ORDER BY exec_time_ms DESC)
        ├── GET /api/trace                → Trace 链路全时序还原
        ├── GET /api/by-template          → 按 SQL 模板精确查询调用 (支持 traceId+dbManager 联合过滤)
        └── GET /api/decompress-gz        → 解压 .gz 文件并返回临时解压路径
```

---

## 3. 核心子系统详解

### 3.1 解析器子系统 (`src/parser/`)
* **13 维日志头提取 (`header.ts`)**：严格依据 `LOG_FORMAT_SPEC.md` 规范提取毫秒时间戳、纳秒时钟序号 (`NanoTime`)、日志级别、基础设施标识 (`ServiceName`/`InstanceName`/`IpAddress`/`HostName`)、分布式链路标识 (`TraceId`/`SpanId`/`ParentSpanId`)、线程名、类全限定名 (`LoggerName`) 以及日志正文。
* **SQL 状态机与清洗 (`sqlParser.ts`)**：支持解析执行耗时 (`parseTimeToMs`)、清理换行与前缀 (`cleanSqlText`)，并将多于 5 个字段的冗长 select 语句安全折叠为 `select ... from` (`compressSqlColumns`)。
* **性能动作树提取 (`perfParser.ts`)**：解析 `ActionRecorder` 格式行，换算微秒耗时为毫秒，计算树形层级、父子节点关联与正交四维耗时（Java业务耗时、SQL执行耗时、事务提交耗时、间隙耗时）。
* **多核并行引擎 (`worker.ts`)**：基于 Node.js Worker Threads 实现文件级多核并行流式解析，通过批处理通信减少主子线程 IPC 开销。

### 3.2 数据库与分析层 (`src/db/`)
* **内存数据库门面 (`index.ts - SqlLogDatabase`)**：封装底层 DuckDB 连接，对外提供统一的数据装载与分析接口。
* **向量化批量装载 (`sqlDao.ts` / `perfDao.ts` / `appLogDao.ts`)**：利用 JSON 临时文件机制结合 DuckDB `read_json_auto` SIMD 向量化引擎，吞吐率达 100,000+ 条/秒。
* **Promise 串行调度器 (`connection.ts`)**：保障底层 DuckDB C++ 引擎在多批次数据并发写入时的事务安全。

### 3.3 现代前端子系统 (`web/`)
* **工程架构**：基于 Vue 3 + TypeScript + Vite 构建，单页应用编译产物输出至 `dist/web/`。
* **递归树组件 (`PerfTreeNode.vue`)**：支持无限层级性能链路树的响应式渲染、逐级展开/折叠、自耗时动态阈值实时高亮展开以及关联 SQL 快速预览。
* **八大核心 Tab**：
  1. ⚡ 性能链路树 (`PerfTreeTab.vue`)
  2. 📜 纯净日志透视 (`AppLogsTab.vue`)
  3. 🌐 Trace 聚合大盘 (`TraceSummaryTab.vue`)
  4. 🔁 事务内重复 SQL (`DiagnosticsTab.vue`)
  5. 📊 SQL 频次榜 (`RepeatedSqlTab.vue`)
  6. 🐢 慢 SQL 排行 (`SlowSqlTab.vue`)
  7. 🔗 Trace 链路分析 (`TraceDetailTab.vue`)
  8. 📋 SQL 调用明细 (`SqlDetailTab.vue`)

---

## 4. 自动化测试体系

项目采用 **Vitest + `*.spec.ts` 行为规格说明规范**，包含单元测试、端到端集成测试与性能基准测试：

1. **单元规格测试 (就近放置原则)**：
   * `src/parser/header.spec.ts`：13 维日志头提取与旧格式容错断言；
   * `src/parser/sqlParser.spec.ts`：耗时转换、文本清洗与多列名折叠断言；
   * `src/parser/perfParser.spec.ts`：性能动作行解析与四维耗时计算断言；
   * `src/db/db.spec.ts`：DuckDB 内存表初始化、数据批量装载与聚合查询断言。
2. **端到端集成测试 (`tests/e2e/fullflow.spec.ts`)**：
   * 基于 `test/fixtures` 真实日志样本，完整验证日志扫描、DuckDB 装载、全量 RESTful API 路由以及 Vue 3 静态页面分发。
3. **性能基准测试 (`tests/benchmark/throughput.spec.ts`)**：
   * 10 万条 SQL 记录内存装载吞吐率基准；
   * 5 万条记录高维多组 GROUP BY 复杂聚合性能基准。
