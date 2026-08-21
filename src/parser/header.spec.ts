import { describe, it, expect } from 'vitest';
import { isLogHeader, parseLogHeader } from './header';

describe('Log Header Parser Specs (13 维日志元数据提取)', () => {
  it('应当正确识别有效与无效的日志行首', () => {
    expect(isLogHeader('2026-08-20 09:59:15.894 8722201732575698 INFO [DevNode]')).toBe(true);
    expect(isLogHeader('2026-08-20 09:59:15.894 INFO [DevNode]')).toBe(true);
    expect(isLogHeader('   at com.boke.service.UserService.getUser(UserService.java:45)')).toBe(false);
    expect(isLogHeader('Caused by: java.lang.NullPointerException')).toBe(false);
    expect(isLogHeader('')).toBe(false);
  });

  it('应当精准解析 LOG_FORMAT_SPEC.md 规范样例中的标准 13 维字段', () => {
    const rawLine = '2026-08-20 09:59:15.894 8722201732575698 INFO [DevNode] [011682c781600868f0376d8b022200000000000000000000-8nk2q:8089] [10.233.107.109] [011682c781600868f0376d8b022200000000000000000000-8nk2q] [c8JR5yiv6kFEiRc_7rUzJ-1787191155419] [c8JR5yiv6kFEiRc_7rUzJ-1787191155419.0.1.1] [c8JR5yiv6kFEiRc_7rUzJ-1787191155419.0.1] [T-345] com.boke.trade.service.OrderService - Processing order submit req';
    
    const parsed = parseLogHeader(rawLine);
    expect(parsed.logTime).toBe('2026-08-20 09:59:15.894');
    expect(parsed.nanoTime).toBe('8722201732575698');
    expect(parsed.level).toBe('INFO');
    expect(parsed.serviceName).toBe('DevNode');
    expect(parsed.instanceName).toBe('011682c781600868f0376d8b022200000000000000000000-8nk2q:8089');
    expect(parsed.ipAddress).toBe('10.233.107.109');
    expect(parsed.hostName).toBe('011682c781600868f0376d8b022200000000000000000000-8nk2q');
    expect(parsed.traceId).toBe('c8JR5yiv6kFEiRc_7rUzJ-1787191155419');
    expect(parsed.spanId).toBe('c8JR5yiv6kFEiRc_7rUzJ-1787191155419.0.1.1');
    expect(parsed.parentSpanId).toBe('c8JR5yiv6kFEiRc_7rUzJ-1787191155419.0.1');
    expect(parsed.threadName).toBe('T-345');
    expect(parsed.loggerName).toBe('com.boke.trade.service.OrderService');
    expect(parsed.message).toBe('- Processing order submit req');
  });

  it('应当优雅兼容无 nanoTime 的旧格式日志', () => {
    const oldLine = '2026-08-20 09:59:15.894 INFO [DevNode] [inst-1] [127.0.0.1] [host-1] [trace-123] [span-1] [span-0] [http-nio-8080-exec-1] com.boke.web.Controller - Request started';
    
    const parsed = parseLogHeader(oldLine);
    expect(parsed.logTime).toBe('2026-08-20 09:59:15.894');
    expect(parsed.nanoTime).toBe('');
    expect(parsed.level).toBe('INFO');
    expect(parsed.serviceName).toBe('DevNode');
    expect(parsed.traceId).toBe('trace-123');
    expect(parsed.threadName).toBe('http-nio-8080-exec-1');
    expect(parsed.loggerName).toBe('com.boke.web.Controller');
  });
});
