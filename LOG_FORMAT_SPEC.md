# Yigo / BokeERP 日志格式与链路追踪字段规范

本文档详细解析系统中标准应用日志（Log4j2 / Logback）中各字段的组成、生成原理及底层源码参考。

---

## 1. 日志样例与字段结构拆解

### 示例日志
```text
2026-08-20 09:59:15.894 8722201732575698 INFO [DevNode] [011682c72bab4d12b91de2e07887d66c-5ff5ffbcc6-8nk2q:8089] [10.233.107.109] [011682c72bab4d12b91de2e07887d66c-5ff5ffbcc6-8nk2q] [c8JR5yiv6kFEiRc_7rUzJ-1787191155419] [u67dkopl1704388ocwf3vny-6737] [-] [http-nio-8089-exec-5] com.bokesoft.yigo.mid.service.provider.ServiceProviderFactory 服务清单hashCode: 6d03eba6, values=DictService
```

### 字段逐项对照表

| 序号 | 字段位置 / 方括号索引 | 示例日志中的值 | 对应底层字段 (`LogInfo`) | 含义与生成原理 |
| :--- | :--- | :--- | :--- | :--- |
| **1** | 时间戳 | `2026-08-20 09:59:15.894` | `Time` | 毫秒级标准日期时间 (`yyyy-MM-dd HH:mm:ss.SSS`) |
| **2** | 纳秒序号 | `8722201732575698` | `NanoTime` | `System.nanoTime()` 高精度时钟序号，用于高并发下日志的精确微秒/纳秒排序与耗时分析 |
| **3** | 日志级别 | `INFO` | `Level` | 日志级别（`INFO`、`DEBUG`、`WARN`、`ERROR` 等） |
| **4** | `[方括号 1]` | `[DevNode]` | `ServiceName` | 服务/微服务名称（配置中的 `SERVICE_NAME`） |
| **5** | `[方括号 2]` | `[011682c72bab4d12b91de2e07887d66c-5ff5ffbcc6-8nk2q:8089]` | `InstanceName` | **服务实例标识 (Instance ID)**。<br>K8s/容器部署下为 `<Pod名称>:<端口>`；单机部署下为 `<主机名/IP>:<端口>` |
| **6** | `[方括号 3]` | `[10.233.107.109]` | `IpAddress` | 容器/节点内部网卡 IP 地址（Pod IP） |
| **7** | `[方括号 4]` | `[011682c72bab4d12b91de2e07887d66c-5ff5ffbcc6-8nk2q]` | `HostName` | **容器/主机名 (Hostname)**。<br>在 Kubernetes 集群中默认即 Pod 名称 |
| **8** | `[方括号 5]` | `[c8JR5yiv6kFEiRc_7rUzJ-1787191155419]` | `TraceId` | **全局链路追踪 ID (Trace ID)**。<br>对应 B3 协议 `x-b3-traceid`，贯穿整条请求链路的唯一 ID |
| **9** | `[方括号 6]` | `[u67dkopl1704388ocwf3vny-6737]` | `SpanId` | **当前跨度 ID (Span ID)**。<br>对应 B3 协议 `x-b3-spanid`，表示当前方法/RPC执行阶段的工作单元 ID |
| **10** | `[方括号 7]` | `[-]` | `ParentSpanId` | **父跨度 ID (Parent Span ID)**。<br>对应 B3 协议 `x-b3-parentspanid`。若为根请求（入口端点），无上级调用，则占位为 `-` |
| **11** | `[方括号 8]` | `[http-nio-8089-exec-5]` | `Thread` | 当前处理请求的线程名称（如 Tomcat HTTP 线程、定时任务线程等） |
| **12** | 类名 | `com.bokesoft.yigo.mid...ServiceProviderFactory` | `LoggerName` | 打印日志的类全限定名 |
| **13** | 正文 | `服务清单hashCode: 6d03eba6, values=DictService` | `Msg` | 日志正文内容（多行会自动转为 `\n>` 格式） |

---

## 2. 几个类似 UUID / 哈希字符串的本质与区别

在日志中容易混淆的几段长字符串，实际上分为两类：**基础设施标识（K8s Pod）** 和 **应用层链路追踪（B3 Trace）**。

### 2.1 基础设施层：Kubernetes Pod 名称
- **出现位置**：`[方括号 2]`、`[方括号 4]`
- **示例**：`011682c72bab4d12b91de2e07887d66c-5ff5ffbcc6-8nk2q`
- **结构与原理**：
  - `011682c72bab4d12b91de2e07887d66c`：微服务 Deployment / 服务标识 Hash
  - `5ff5ffbcc6`：Pod 模板哈希（ReplicaSet Hash）
  - `8nk2q`：K8s 为每个 Pod 实例分配的 5 位随机字符串
  - 在 `[方括号 2]` 中追加了 `:8089` 服务监听端口，组合成集群内唯一的 `InstanceName`。

### 2.2 应用与链路追踪层：Zipkin / B3 链路 ID
- **出现位置**：`[方括号 5]`、`[方括号 6]`、`[方括号 7]`
- **Trace ID (`c8JR5yiv6kFEiRc_7rUzJ-1787191155419`)**：
  - 前端或外部网关发起一次请求时生成，存入 MDC（`x-b3-traceid`）。
  - 无论在后端经由几台机器、调用几个服务，此 ID 保持一致，用于检索全链路所有日志。
- **Span ID (`u67dkopl1704388ocwf3vny-6737`)**：
  - 代表本次调用的局部执行段落（Span），存入 MDC（`x-b3-spanid`）。
- **Parent Span ID (`-`)**：
  - 代表父级 Span 的 ID。入口请求无父级，故为 `-`。

---

## 3. 底层 Java 参考实现源码

该日志格式由 `ops-log-extension` 插件定义，核心类为 `YigoAppLog4jLayout` 和 `LogUtil`。

### 3.1 `Log4jLayout.java`
```java
package com.bokesoft.yigoee.opsadmin.log.log4j;

import com.bokesoft.yigoee.opsadmin.log.struct.LogInfo;
import com.bokesoft.yigoee.opsadmin.log.util.LogUtil;
import org.apache.commons.lang3.StringUtils;
import org.apache.logging.log4j.Level;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.config.plugins.Plugin;
import org.apache.logging.log4j.core.layout.AbstractStringLayout;
import org.apache.logging.log4j.util.ReadOnlyStringMap;

@Plugin(name = "YigoAppLog4jLayout", category = "Core", elementType = "layout", printObject = true)
public class Log4jLayout extends AbstractStringLayout {
    private static String serviceName;

    @Override
    public String toSerializable(LogEvent event) {
        // 从 LogEvent 获取 MDC 上下文
        ReadOnlyStringMap contextData = event.getContextData();

        String traceId = "-";
        String spanId = "-";
        String parentSpanId = "-";
        if (null != contextData && !contextData.isEmpty()) {
            traceId = contextData.getValue(LogUtil.X_B3_TRACEID);         // "x-b3-traceid"
            if (null == traceId) traceId = "-";

            spanId = contextData.getValue(LogUtil.X_B3_SPANID);           // "x-b3-spanid"
            if (null == spanId) spanId = "-";

            parentSpanId = contextData.getValue(LogUtil.X_B3_PARENTSPANID); // "x-b3-parentspanid"
            if (null == parentSpanId) parentSpanId = "-";
        }

        LogInfo yigoAppLog = LogUtil.buildYigoAppLog(serviceName, event.getThreadName(), event.getLevel().toString(),
                event.getLoggerName(), event.getMessage().getFormattedMessage(), event.getThrown(), traceId, spanId, parentSpanId);
        return LogUtil.getContent(getStringBuilder(), yigoAppLog);
    }
}
```

### 3.2 `LogUtil.java`（核心字符串拼接逻辑）
```java
package com.bokesoft.yigoee.opsadmin.log.util;

import com.bokesoft.yigoee.opsadmin.log.struct.LogInfo;

public class LogUtil {
    public static final String X_B3_PARENTSPANID = "x-b3-parentspanid";
    public static final String X_B3_TRACEID = "x-b3-traceid";
    public static final String X_B3_SPANID = "x-b3-spanid";

    public static String getContent(StringBuilder builder, LogInfo yigoAppLog) {
        builder.append(yigoAppLog.getTime()).append(" ");
        builder.append(yigoAppLog.getNanoTime()).append(" ");
        builder.append(yigoAppLog.getLevel()).append(" ");
        builder.append("[").append(yigoAppLog.getServiceName()).append("] ");   // [1] ServiceName
        builder.append("[").append(yigoAppLog.getInstanceName()).append("] ");  // [2] InstanceName
        builder.append("[").append(yigoAppLog.getIpAddress()).append("] ");     // [3] IpAddress
        builder.append("[").append(yigoAppLog.getHostName()).append("] ");      // [4] HostName
        builder.append("[").append(yigoAppLog.getTraceId()).append("] ");       // [5] TraceId
        builder.append("[").append(yigoAppLog.getSpanId()).append("] ");        // [6] SpanId
        builder.append("[").append(yigoAppLog.getParentSpanId()).append("] ");  // [7] ParentSpanId
        builder.append("[").append(yigoAppLog.getThread()).append("] ");        // [8] Thread
        builder.append(dealNormalField(yigoAppLog.getLoggerName())).append(" ");
        builder.append(relpaceLineBreak(yigoAppLog.getMsg()));
        builder.append("\n");
        return builder.toString();
    }
}
```

---

## 4. `analyzeSqlLog` 日志解析器对照（`parser.js`）

在 `parser.js` 中，各方括号索引 (`bracketCount`) 提取逻辑对应如下：

```javascript
// parser.js 中提取方括号索引逻辑
for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 91) { // '['
        start = i + 1;
    } else if (c === 93 && start !== -1) { // ']'
        bracketCount++;
        if (bracketCount === 1) {
            serviceName = line.substring(start, i);
        } else if (bracketCount === 2) {
            instanceName = line.substring(start, i);
        } else if (bracketCount === 3) {
            ipAddress = line.substring(start, i);
        } else if (bracketCount === 4) {
            hostName = line.substring(start, i);
        } else if (bracketCount === 5) {
            traceId = line.substring(start, i);     // Trace ID
        } else if (bracketCount === 6) {
            spanId = line.substring(start, i);      // Span ID
        } else if (bracketCount === 7) {
            parentSpanId = line.substring(start, i);// Parent Span ID
        } else if (bracketCount === 8) {
            threadName = line.substring(start, i);  // 线程名
            break;
        }
        start = -1;
    }
}
```
