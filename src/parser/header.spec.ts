import { describe, it, expect } from 'vitest';
import { parseLogHeader, isLogHeader } from './header';

describe('Log Header Parser Specs (13-Dimensional Metadata)', () => {
  it('用例 39: 对照 LOG_FORMAT_SPEC.md 标准规范样例 13 维元数据精确解析', () => {
    const sampleLog =
      '2026-08-20 09:59:15.894 8722201732575698 INFO [DevNode] [011682c72bab4d12b91de2e07887d66c-5ff5ffbcc6-8nk2q:8089] [10.233.107.109] [011682c72bab4d12b91de2e07887d66c-5ff5ffbcc6-8nk2q] [c8JR5yiv6kFEiRc_7rUzJ-1787191155419] [u67dkopl1704388ocwf3vny-6737] [-] [http-nio-8089-exec-5] com.bokesoft.yigo.mid.service.provider.ServiceProviderFactory 服务清单hashCode: 6d03eba6, values=DictService';

    expect(isLogHeader(sampleLog)).toBe(true);

    const parsed = parseLogHeader(sampleLog);
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(parsed.logTime).toBe('2026-08-20 09:59:15.894');
      expect(parsed.nanoTime).toBe('8722201732575698');
      expect(parsed.level).toBe('INFO');
      expect(parsed.serviceName).toBe('DevNode');
      expect(parsed.instanceName).toBe('011682c72bab4d12b91de2e07887d66c-5ff5ffbcc6-8nk2q:8089');
      expect(parsed.ipAddress).toBe('10.233.107.109');
      expect(parsed.hostName).toBe('011682c72bab4d12b91de2e07887d66c-5ff5ffbcc6-8nk2q');
      expect(parsed.traceId).toBe('c8JR5yiv6kFEiRc_7rUzJ-1787191155419');
      expect(parsed.spanId).toBe('u67dkopl1704388ocwf3vny-6737');
      expect(parsed.parentSpanId).toBe('-');
      expect(parsed.threadName).toBe('http-nio-8089-exec-5');
      expect(parsed.loggerName).toBe('com.bokesoft.yigo.mid.service.provider.ServiceProviderFactory');
      expect(parsed.message).toBe('服务清单hashCode: 6d03eba6, values=DictService');
    }
  });

  it('用例 40: parseLogHeader 对旧格式日志与缺省方括号的安全兼容容错断言', () => {
    // 旧格式 1：无 nanoTime，直接为 level
    const legacyLog1 =
      '2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-legacy-1] [] [] [w-1] com.bokesoft.TestClass 业务执行成功';
    expect(isLogHeader(legacyLog1)).toBe(true);
    const parsed1 = parseLogHeader(legacyLog1);
    expect(parsed1).not.toBeNull();
    if (parsed1) {
      expect(parsed1.logTime).toBe('2026-08-12 10:00:00.000');
      expect(parsed1.level).toBe('INFO');
      expect(parsed1.serviceName).toBe('DevNode');
      expect(parsed1.traceId).toBe('t-legacy-1');
      expect(parsed1.threadName).toBe('w-1');
      expect(parsed1.loggerName).toBe('com.bokesoft.TestClass');
      expect(parsed1.message).toBe('业务执行成功');
    }

    // 格式 2：方括号不足 8 个
    const shortLog = '2026-08-12 10:00:00.000 ERROR [DevNode] [instance-1] [192.168.1.1] 出现全局异常';
    const parsed2 = parseLogHeader(shortLog);
    expect(parsed2).not.toBeNull();
    if (parsed2) {
      expect(parsed2.level).toBe('ERROR');
      expect(parsed2.serviceName).toBe('DevNode');
      expect(parsed2.instanceName).toBe('instance-1');
      expect(parsed2.ipAddress).toBe('192.168.1.1');
      expect(parsed2.traceId).toBe('-');
    }
  });

  it('用例 9: GeneralDBManager 类名日志 TraceID 与 时间提取测试', () => {
    const logHeader =
      '2026-08-12 16:04:22.515 684794180481300 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [Main_9ckgsuc21703760lag6ndr3-0] [9ckgsuc21703760lag6ndr3-1] [-] [main] com.bokesoft.yes.mid.connection.dbmanager.GeneralDBManager';

    expect(isLogHeader(logHeader)).toBe(true);
    const parsed = parseLogHeader(logHeader);
    expect(parsed).not.toBeNull();
    if (parsed) {
      expect(parsed.logTime).toBe('2026-08-12 16:04:22.515');
      expect(parsed.traceId).toBe('Main_9ckgsuc21703760lag6ndr3-0');
      expect(parsed.loggerName).toBe('com.bokesoft.yes.mid.connection.dbmanager.GeneralDBManager');
    }
  });
});
