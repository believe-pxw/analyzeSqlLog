/**
 * 依据 LOG_FORMAT_SPEC.md 规范定义的标准 13 维应用日志元数据
 * 格式: Time NanoTime Level [ServiceName] [InstanceName] [IpAddress] [HostName] [TraceId] [SpanId] [ParentSpanId] [Thread] LoggerName Msg
 */
export interface LogHeader {
  logTime: string;          // 毫秒时间戳 (YYYY-MM-DD HH:mm:ss.SSS)
  nanoTime: string;         // System.nanoTime() 纳秒时钟序号 (缺失时为 '')
  level: string;            // 日志级别 (INFO, ERROR, WARN, DEBUG)
  serviceName: string;      // 服务名 (方括号 1，如 DevNode)
  instanceName: string;     // 实例名/Pod:端口 (方括号 2)
  ipAddress: string;        // Pod IP (方括号 3)
  hostName: string;         // 主机名 (方括号 4)
  traceId: string;          // 全局链路追踪 ID (方括号 5)
  spanId: string;           // 链路跨度 ID (方括号 6)
  parentSpanId: string;     // 父跨度 ID (方括号 7)
  threadName: string;       // 线程名 (方括号 8)
  loggerName: string;       // 类全限定名
  message: string;          // 日志消息正文
}

/**
 * 存储落库与检索的应用日志记录
 */
export interface AppLogRecord {
  id?: number;
  log_time: string;
  nano_time: string;
  level: string;
  service_name: string;
  instance_name: string;
  ip_address: string;
  host_name: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  thread_name: string;
  logger_name: string;
  has_stack?: boolean;
  stack_trace?: string;
  source_file: string;
  line_number: number;
  is_sql?: boolean;
  exec_time_ms?: number;
  result_rows?: number;
}
