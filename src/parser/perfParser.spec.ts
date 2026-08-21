import { describe, it, expect } from 'vitest';
import { parseActionLine, calculatePerfTraceMetrics } from './perfParser';

describe('Performance ActionRecorder Parser Specs', () => {
  it('parseActionLine 应当正确解析制表符分隔的性能动作行并换算微秒为毫秒', () => {
    const raw = '> 0\t125430\t1200\t500\tMidVEFilter.doFilter';
    const parsed = parseActionLine(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.level).toBe(0);
    expect(parsed?.time_us).toBe(125430);
    expect(parsed?.time_ms).toBe(125.43);
    expect(parsed?.self_time_ms).toBe(1.2);
    expect(parsed?.gap_time_ms).toBe(0.5);
    expect(parsed?.action_name).toBe('MidVEFilter.doFilter');
  });

  it('calculatePerfTraceMetrics 应当正确构建层级栈与四维耗时统计', () => {
    const actions = [
      {
        level: 0,
        time_us: 100000,
        self_time_us: 10000,
        gap_time_us: 0,
        time_ms: 100,
        self_time_ms: 10,
        gap_time_ms: 0,
        action_name: 'MidVEFilter.doFilter',
        sql_text: '',
      },
      {
        level: 1,
        time_us: 80000,
        self_time_us: 5000,
        gap_time_us: 0,
        time_ms: 80,
        self_time_ms: 5,
        gap_time_ms: 0,
        action_name: 'com.boke.service.OrderService',
        sql_text: '',
      },
      {
        level: 2,
        time_us: 30000,
        self_time_us: 30000,
        gap_time_us: 0,
        time_ms: 30,
        self_time_ms: 30,
        gap_time_ms: 0,
        action_name: 'QueryDatabase/SelectOrder',
        sql_text: 'SELECT * FROM orders',
      },
      {
        level: 2,
        time_us: 10000,
        self_time_us: 10000,
        gap_time_us: 0,
        time_ms: 10,
        self_time_ms: 10,
        gap_time_ms: 0,
        action_name: 'DB commit',
        sql_text: '',
      },
    ];

    const result = calculatePerfTraceMetrics('trace-001', '2026-08-20 10:00:00.000', 'T-1', 'app.log', 10, actions);
    expect(result.trace.trace_id).toBe('trace-001');
    expect(result.trace.total_time_ms).toBe(100);
    expect(result.trace.sql_time_ms).toBe(30);
    expect(result.trace.commit_time_ms).toBe(10);
    expect(result.trace.biz_time_ms).toBe(60); // 100 - 30 - 10
    expect(result.trace.service_name).toBe('com.boke.service.OrderService');
    expect(result.trace.sql_count).toBe(1);
    expect(result.actions[2].parent_id).toBe(1);
  });
});
