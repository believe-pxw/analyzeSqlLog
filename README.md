# ⚡ 极速 SQL 日志分析器 (sqllog CLI)

一款针对 ERP / YES 平台定制的高性能、极速 SQL 日志分析与可视化诊断工具。基于 **Node.js** 与 **DuckDB 纯内存分析引擎** 构建，能够在 1 秒内完成数十万行海量日志的结构化解析与聚合诊断。

---

## 🚀 团队快速安装与使用

### ⚙️ 环境要求

- **Node.js**：建议使用 **Node.js 24** 或更高版本（推荐 v24+）

---

### 1. 🌟【最推荐·团队内部】直接通过 GitHub 全局安装 (无需发布 npm)

团队成员只要电脑安装了 Node.js，**无需发布到 npm**，在终端运行以下命令即可完成安装：

```bash
npm install -g git+https://github.com/believe-pxw/analyzeSqlLog.git --allow-git=all --allow-scripts=duckdb
```

**使用方法**：
在电脑任意存放日志的目录，直接在终端敲：
```bash
sqllog .
```
或者分析指定的日志目录/日志文件：
```bash
sqllog "D:\Users\boke\Desktop\source\bokeerp\erp-backend\logs"
```
程序会自动拉起 DuckDB 纯内存引擎解析，并在默认浏览器中自动弹出极简控制台面板（如 `http://localhost:3000`）！

---

### 2. 📦 开发者源码本地运行

```bash
# 克隆仓库
git clone https://github.com/believe-pxw/analyzeSqlLog.git
cd analyzeSqlLog

# 安装依赖
npm install

# 本地运行
node index.js "D:\path\to\logs"
```

---

## 🌟 核心功能与五大分析面板

系统采用极致紧凑的视觉设计与响应式布局，提供以下五大核心分析面板：

| 面板 | 名称 | 核心功能与亮点 |
| :--- | :--- | :--- |
| **Tab 1** | **💡 N+1 事务循环诊所** | **(默认首页)** 基于日志中 `dbManager` 内存对象句柄（如 `MySqlDBManager@7b2aa7e0`），精准定位在**【同一数据库事务内】**重复执行 $\ge 5$ 次的冗余 SQL 模板，避免跨事务误判，提供 `IN(...)` 批量化与缓存重构建议。 |
| **Tab 2** | **🐢 慢 SQL 排行** | 按单次执行耗时降序排列，快速找出拖慢系统响应的瓶颈 SQL。支持一键点击 TraceID 瞬间下钻。 |
| **Tab 3** | **🔗 Trace 链路分析** | 完整还原单次请求生命周期内的全部 SQL 执行序列。支持**【时间列】**与**【耗时列】**经典表头极简点击排序（时间升序/降序、耗时降序/升序）。 |
| **Tab 4** | **📊 SQL 频次榜** | 对全局参数化 SQL 模板进行归一化频次统计，统计总耗时、平均耗时与最大耗时。 |
| **Tab 5** | **📈 概览统计分析** | 汇聚分析 SQL 总数、归一模板数、最高慢 SQL 耗时、独立 Trace 动作数与总耗时。 |

---

## 🖥️ 极速流畅的交互设计

1. **🖱️ 0ms 瞬间折叠/展开**：
   - 针对包含上百列的超长 `SELECT` 语句，算法自动将冗长列名缩略为 `select ... from <原表与条件>`；
   - **左键点击 SQL 框**：0ms 纯粹秒切展开完整 SQL 与收起缩略 SQL；
   - 采用 `\bfrom\b` 单词界定符，绝对不把列名中含有的 `Formula` / `FromDate` 等字符误解为 SQL 的 `FROM` 语句；
   - 后端 Node.js API 接口直接计算并透传 `brief_sql`，避免任何转义导致失效。
2. **📋 桌面级极简右键菜单**：
   - **右键点击任何 SQL 框**：自动弹出位置精准的自定义极简右键菜单，提供 **【📋 复制完整 SQL】** 单一最核心选项，一键写入剪贴板并附带顶部飘飞提示。

---

## 🧪 单元测试集成保固

项目内置了完整的单元自动化测试用例，覆盖：
- 耗时单位解析（`ms`, `s`, `m`, `TimeCostLevel` 扩展格式）
- 多行 SQL 前缀 `>` 清洗与尾部多余 `]` 剔除
- 混杂普通日志时的断句割裂防污染测试
- DuckDB 内存聚合与后端分页测试
- 超长多列名与 `Formula` 边界 SQL 精确折叠算法测试
- Trace 链路按时间列/耗时列表头排序测试

运行测试：
```bash
npm test
```
*（当前 13 项单元测试 100% 绿灯 PASS）*

---

## 📄 许可证

ISC
