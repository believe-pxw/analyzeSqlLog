import { describe, it, expect } from 'vitest';
import { parseActionLine } from './perfParser';
import { parseLogFile } from './index';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('Performance Parser Specs (ActionRecorder)', () => {
  it('用例 31: parseActionLine 性能动作行解析与单位微秒换算测试', () => {
    const line1 = '>0\t69196372\t25262856\t0\tMidVEFilter.doFilter';
    const res1 = parseActionLine(line1);
    expect(res1).not.toBeNull();
    if (res1) {
      expect(res1.level).toBe(0);
      expect(res1.time_ms).toBe(69196.37);
      expect(res1.self_time_ms).toBe(25262.86);
      expect(res1.gap_time_ms).toBe(0);
      expect(res1.action_name).toBe('MidVEFilter.doFilter');
    }

    const line2 = '> 1\t9729706\t7906867\t747\tloadObject/MM_PurchaseOrder';
    const res2 = parseActionLine(line2);
    expect(res2).not.toBeNull();
    if (res2) {
      expect(res2.level).toBe(1);
      expect(res2.time_ms).toBe(9729.71);
      expect(res2.self_time_ms).toBe(7906.87);
      expect(res2.gap_time_ms).toBe(0.75);
      expect(res2.action_name).toBe('loadObject/MM_PurchaseOrder');
    }

    expect(parseActionLine('>===================')).toBeNull();
    expect(parseActionLine('>Level\tTime(0.001ms)\t...')).toBeNull();
    expect(parseActionLine('')).toBeNull();
  });

  it('用例 32: 基于 sample-perf.log 真实日志验证 ActionRecorder 流式解析与多行 SQL 关联及父子关系计算', async () => {
    const samplePerfLog = path.resolve(__dirname, '../../test/fixtures/perf/sample-perf.log');
    if (!fs.existsSync(samplePerfLog)) return;

    const collectedTraces: any[] = [];
    const parseRes = await parseLogFile(samplePerfLog, () => {}, 0, (perfTrace) => {
      collectedTraces.push(perfTrace);
    });

    expect(parseRes.totalPerfTraces).toBeGreaterThan(0);
    expect(collectedTraces.length).toBe(1);

    const { trace, actions } = collectedTraces[0];
    expect(trace.trace_id).toBe('43tv9pop1703907v2p9dss1-40');
    expect(trace.root_action).toBe('MidVEFilter.doFilter');
    expect(trace.service_name.includes('MM_PurchaseOrder')).toBe(true);
    expect(trace.total_time_ms).toBe(69196.37);
    expect(trace.self_time_ms).toBe(25262.86);
    expect(trace.sql_count).toBeGreaterThan(5000);
    expect(actions.length).toBeGreaterThan(5100);

    const rootNode = actions.find((a: any) => a.level === 0);
    expect(rootNode.node_id).toBe(0);
    expect(rootNode.parent_id).toBe(-1);

    const level1Nodes = actions.filter((a: any) => a.level === 1);
    expect(level1Nodes.length).toBeGreaterThan(0);
    level1Nodes.forEach((n: any) => expect(n.parent_id).toBe(0));

    const sqlNode = actions.find((a: any) => a.action_name.startsWith('QueryDatabase/') && a.sql_text);
    expect(sqlNode).toBeDefined();
    expect(sqlNode.sql_text.length).toBeGreaterThan(0);
    expect(sqlNode.action_category).toBe('sql');
  });

  it('用例 36: 验证多请求共享同一 Session TraceID 时独立拆分、Level 1 首节点作为唯一 service_name 及 Top 5 热点不串通', async () => {
    const mockLogLines = [
      '2026-08-14 10:56:16.397 839106962650900 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [session-token-123456] [span-req-1] [-] [http-nio-8089-exec-4] com.bokesoft.erp.performance.ActionRecorder',
      '>================================================================================',
      '>Level\tTime(0.001ms)\tSelfTime(0.001ms)\tGapTime(0.001ms)\tActionName',
      '> 0\t12178726\t12178726\t0\tMidVEFilter.doFilter',
      '> 1\t1000\t800\t200\tWebMetaService/GetFormVersion/mmconfig/MM_PurchaseOrder',
      '> 2\t600\t600\t0\tQueryDatabase/SELECT_VERSION',
      '>================================================================================',
      '',
      '2026-08-14 10:56:18.647 839109212650900 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [session-token-123456] [span-req-2] [-] [http-nio-8089-exec-9] com.bokesoft.erp.performance.ActionRecorder',
      '>================================================================================',
      '>Level\tTime(0.001ms)\tSelfTime(0.001ms)\tGapTime(0.001ms)\tActionName',
      '> 0\t2062690\t2062690\t0\tMidVEFilter.doFilter',
      '> 1\t1500000\t500000\t100\tRichDocument/BuildScopeTree/RichDocument/BuildScopeTree',
      '> 2\t1000000\t1000000\t0\tQueryDatabase/SELECT_TREE',
      '>================================================================================',
    ].join('\n');

    const tempDir = path.join(os.tmpdir(), 'perf-multi-test-' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });
    const tempLog = path.join(tempDir, 'DevNode-server-info-multi.log');
    fs.writeFileSync(tempLog, mockLogLines, 'utf-8');

    const collectedTraces: any[] = [];
    try {
      const parseRes = await parseLogFile(tempLog, () => {}, 0, (perfTrace) => {
        collectedTraces.push(perfTrace);
      });

      expect(parseRes.totalPerfTraces).toBe(2);
      expect(collectedTraces.length).toBe(2);

      const req1 = collectedTraces[0];
      expect(req1.trace.trace_id).toBe('session-token-123456');
      expect(req1.trace.service_name).toBe('WebMetaService/GetFormVersion/mmconfig/MM_PurchaseOrder');
      expect(req1.trace.total_time_ms).toBe(12178.73);
      expect(req1.actions.length).toBe(3);

      const req2 = collectedTraces[1];
      expect(req2.trace.trace_id).toBe('span-req-2');
      expect(req2.trace.service_name).toBe('RichDocument/BuildScopeTree/RichDocument/BuildScopeTree');
      expect(req2.trace.total_time_ms).toBe(2062.69);
      expect(req2.actions.length).toBe(3);
    } finally {
      try {
        fs.unlinkSync(tempLog);
        fs.rmdirSync(tempDir);
      } catch (e) {}
    }
  });
});
