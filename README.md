# ⚡ 极速 SQL 日志分析器 (SQL Log Analyzer)

一款针对 ERP / YES 平台定制的高性能、极速 SQL 日志分析与可视化工具。基于 **Node.js 24** 与 **DuckDB 嵌入式内存分析引擎** 构建，能够在 1 秒内完成数十万行海量日志的结构化解析与聚合分析。

---

## 🌟 核心特性

1. **极致解析速度**：流式状态机解析，11万+ 行日志解析仅需 **0.7 秒**。
2. **多维聚合分析**：
   - 📊 **SQL 频次榜 (Top Repeated)**：归一参数化 SQL 模板，按出现次数降序，统计总耗时、平均耗时与最大耗时。
   - 🐢 **慢 SQL 排行 (Top Slow)**：按单次执行耗时降序，定位最拖慢系统的 SQL。
   - 🔗 **TraceID 链路追踪**：一键拉出特定 TraceID（如 `hcpc9te51703753lmmmmybe-0`）生命周期内执行的所有 SQL 序列。
   - 💡 **N+1 冗余诊断**：自动识别单次请求中重复执行 $\ge 5$ 次的同一 SQL 模板。
   - 🔍 **自由 DuckDB SQL 控制台**：允许在 Web 页面中自由编写任意 DuckDB SQL 查询日志。
3. **精准日志清洗与断句**：自动清洗多行 SQL 中的 `>` 换行符前缀与 Logback 打印包裹的尾部 `]`，严防普通日志行污染。
4. **高雅纯洁的极简白 UI**：现代 Light Mode Web 面板，支持关键词实时搜索过滤与一键复制 SQL。

---

## 📁 目录结构

```
analyzeSqlLog/
├── index.js          # 命令行入口脚本 (CLI Main)
├── parser.js         # 高性能流式日志解析器 (清洗 > 前缀 & 断句防污染)
├── db.js             # DuckDB 嵌入式内存数据库连接与分析查询库
├── server.js         # REST API 服务与极简白 Web Dashboard 控制台
├── package.json      # 项目依赖与 npm scripts 配置
├── README.md         # 项目文档说明
└── test/
    └── parser.test.js # 单元自动化测试用例
```

---

## 🚀 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 运行分析器

#### 默认运行（自动扫描系统默认日志目录）
```bash
npm start
```
*或直接运行：*
```bash
node index.js
```

#### 分析任意指定的日志文件或日志目录
```bash
node index.js "D:\Users\boke\Desktop\source\bokeerp\erp-backend\logs"
```

运行后，终端控制台将瞬间输出分析摘要，并**自动在默认浏览器中打开可视面板**（例如：`http://localhost:3000`）。

---

## 🧪 运行单元测试

项目内置了完整的单元测试用例，覆盖：
- 耗时单位解析（`ms`, `s`, `m`）
- 多行 SQL 前缀 `>` 清洗与尾部多余 `]` 剔除
- 混杂普通日志时的断句割裂防污染测试
- DuckDB 内存聚合查询逻辑测试

运行测试：
```bash
npm test
```

---

## 📄 许可证

ISC
