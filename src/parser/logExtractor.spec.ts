import { describe, it, expect } from 'vitest';
import { extractLogLines } from './logExtractor';
import path from 'path';
import fs from 'fs';

describe('Log Extractor Specs (按需切片提取日志正文与堆栈)', () => {
  const sampleLog = [
    '2026-08-20 09:59:15.894 8722201732575698 INFO [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-1] [span-1] [-] [http-1] com.bokesoft.service.AuthService 用户登录成功',
    '2026-08-20 09:59:16.100 8722201732579999 ERROR [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-1] [span-2] [span-1] [http-1] com.bokesoft.service.OrderService 发生异常',
    '>java.lang.NullPointerException: Order item cannot be null',
    '>\tat com.bokesoft.service.OrderService.process(OrderService.java:45)',
    '2026-08-20 09:59:17.000 8722201732588888 INFO [DevNode] [pod-1:8089] [10.0.0.1] [host-1] [trace-2] [span-3] [-] [http-2] com.bokesoft.service.DictService 加载字典完成'
  ].join('\n');

  it('1. 精准提取 trace-1 所在的第 1~4 行区间，包含多行异常堆栈', async () => {
    const tempFile = path.join(__dirname, 'test_extractor_temp.log');
    fs.writeFileSync(tempFile, sampleLog, 'utf-8');

    try {
      const records = await extractLogLines(tempFile, 1, 4);
      expect(records.length).toBe(2);

      // 第 1 条
      expect(records[0].trace_id).toBe('trace-1');
      expect(records[0].message).toBe('用户登录成功');

      // 第 2 条
      expect(records[1].trace_id).toBe('trace-1');
      expect(records[1].level).toBe('ERROR');
      expect(records[1].stack_trace).toContain('NullPointerException');
      expect(records[1].stack_trace).toContain('OrderService.java:45');
    } finally {
      fs.unlinkSync(tempFile);
    }
  });

  it('2. 精准提取 trace-2 所在的第 5 行', async () => {
    const tempFile = path.join(__dirname, 'test_extractor_temp2.log');
    fs.writeFileSync(tempFile, sampleLog, 'utf-8');

    try {
      const records = await extractLogLines(tempFile, 5, 5);
      expect(records.length).toBe(1);
      expect(records[0].trace_id).toBe('trace-2');
      expect(records[0].message).toBe('加载字典完成');
    } finally {
      fs.unlinkSync(tempFile);
    }
  });
});
