# 项目架构与代码结构文档 (ARCHITECTURE)

> 本文档供 AI 和开发者快速理解项目全貌，修改代码前请先阅读。

## 目录结构 (标准 TypeScript 工业级工程架构)

```
analyzeSqlLog/
├── bin/
│   └── parselog.js            # CLI 可执行文件入口 (指向 dist/cli.js)
├── src/                       # 🌟 核心 TypeScript 源码
│   ├── index.ts               # 库导出入口
│   ├── cli.ts                 # CLI 命令行入口与主流程
│   ├── types/                 # 🌟 全局 TS 领域模型 (13维日志/SQL/性能树/API)
│   │   ├── log.ts
│   │   ├── sql.ts
│   │   ├── perf.ts
│   │   ├── api.ts
│   │   └── index.ts
│   ├── parser/                # 🌟 解析器子系统 (职责单一)
│   │   ├── header.ts          # 13 维日志头极速提取器
│   │   ├── header.spec.ts     # 对应规格测试
│   │   ├── sqlParser.ts       # SQL 状态机与文本清洗/列名折叠
│   │   ├── sqlParser.spec.ts  # 对应规格测试
│   │   ├── perfParser.ts      # ActionRecorder 性能树解析与微秒换算
│   │   ├── perfParser.spec.ts # 对应规格测试
│   │   ├── worker.ts          # Worker Threads 多核并行解析引擎
│   │   └── index.ts           # 解析器统一调度入口
│   ├── db/                    # 🌟 DuckDB 内存分析与 DAO 分层
│   │   ├── connection.ts      # DuckDB 实例生命周期与串行调度
│   │   ├── schema.ts          # 表结构 DDL 定义
│   │   ├── sqlDao.ts          # SQL 频次榜/慢SQL/N+1/Trace聚合
│   │   ├── perfDao.ts         # 性能树/四维耗时大盘/Top 5 热点
│   │   ├── appLogDao.ts       # 13 维应用日志多维检索
│   │   ├── db.spec.ts         # 数据库层规格测试
│   │   └── index.ts           # SqlLogDatabase 统一对外门面
│   └── server/                # 🌟 HTTP 服务与 API 控制器
│       ├── static.ts          # 静态前端资源托管 (dist/web/)
│       └── index.ts           # RESTful API 控制器与端口管理
├── web/                       # 🌟 现代 Vue 3 + TypeScript 前端子工程
│   ├── index.html             # 单页入口 HTML
│   ├── vite.config.ts         # Vite 前端构建配置 (打包至 dist/web)
│   └── src/
│       ├── main.ts            # Vue 应用入口
│       ├── App.vue            # 根组件 (Header + 8 大 Tab 切换与全局度量条)
│       ├── types.ts           # 前端类型契约
│       ├── api.ts             # API 客户端封装
│       ├── components/        # 公共通用组件 (CostBadge, Pagination, StackedBar, Toast)
│       └── views/             # 8 大核心功能 Tab 视图
│           ├── PerfTreeTab.vue     # ⚡ 性能链路树 (含递归树)
│           ├── PerfTreeNode.vue    # 递归树节点组件
│           ├── AppLogsTab.vue      # 📜 纯净日志透视
│           ├── TraceSummaryTab.vue # 🌐 Trace 聚合大盘
│           ├── DiagnosticsTab.vue  # 🔁 事务内重复 SQL (N+1)
│           ├── RepeatedSqlTab.vue  # 📊 SQL 频次榜
│           ├── SlowSqlTab.vue      # 🐢 慢 SQL 排行
│           ├── TraceDetailTab.vue  # 🔗 Trace 链路分析
│           └── SqlDetailTab.vue    # 📋 SQL 模板调用明细
├── tests/                     # 🌟 端到端与基准测试
│   ├── fixtures/              # 真实日志样本 (.log / .gz)
│   ├── e2e/
│   │   └── fullflow.spec.ts   # CLI 解析 → DB 装载 → HTTP API → 前端静态分发全链路规格测试
│   └── benchmark/
│       └── throughput.spec.ts # DuckDB 向量装载与高维内存聚合吞吐基准测试
├── dist/                      # 编译打包产物
│   ├── cli.js / index.js / worker.js
│   └── web/                   # Vue 3 编译后的纯静态资源
├── tsconfig.json              # TypeScript 严格模式编译配置
├── vitest.config.ts           # Vitest 极速测试框架配置
├── tsup.config.ts             # 后端极速构建打包配置
└── package.json
```

---

## 核心设计与重构亮点

| 维度 | 重构前 (旧单文件巨石) | 重构后 (TS 工业级 + Vue 3) |
| :--- | :--- | :--- |
| **语言与类型** | 纯 JavaScript，无类型检查，字段易拼错 | 严格模式 TypeScript，13 维日志与性能树全面 Interface 强约束 |
| **前端架构** | 120KB 巨型硬编码字符串 + innerHTML 手搓拼接 | 独立 Vue 3 + Vite 工程，响应式数据绑定，递归树组件，极速构建 |
| **模块解耦** | `parser.js` 900+ 行、`db.js` 1100+ 行 | `src/parser/`、`src/db/` 单一职责子模块，单文件 100~200 行 |
| **测试框架** | 原生 `node:test`，测试集中于单文件 | `Vitest` + `*.spec.ts` 规范，就近单元测试 + E2E + 性能基准 |
| **构建体验** | 无构建工具链 | `tsup` 30ms 秒级打包后端，`Vite` 350ms 秒级打包前端 |
