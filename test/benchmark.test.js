const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const SqlLogDatabase = require('../db');
const { parseLogFile } = require('../parser');

test('🚀 性能基准测试 1：10 万条结构化 SQL 记录 DuckDB Multi-row Chunk 内存装载吞吐率基准断言', async () => {
    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    const TOTAL_RECORDS = 100000;
    const records = new Array(TOTAL_RECORDS);

    for (let i = 0; i < TOTAL_RECORDS; i++) {
        records[i] = {
            id: i + 1,
            log_time: '2026-08-12 10:00:00.000',
            trace_id: `t-bench-${i % 100}`,
            thread_name: `th-${i % 8}`,
            exec_time_ms: (i % 50) + 1,
            result_rows: (i % 10),
            db_manager: 'com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog',
            sql_template: `SELECT id, name, val FROM table_${i % 200} WHERE id = ? AND type = ?`,
            sql_params: `[param1_${i}, param2_${i}]`,
            full_sql: `SELECT id, name, val FROM table_${i % 200} WHERE id = ${i} AND type = 'test'`
        };
    }

    const start = Date.now();
    await db.insertBatch(records);
    const elapsed = Date.now() - start;

    const summary = await db.getTotalSummary();
    assert.strictEqual(Number(summary.total_sqls), TOTAL_RECORDS);

    const throughput = Math.round((TOTAL_RECORDS / elapsed) * 1000);
    console.log(`\n    ⚡ DuckDB 内存装载基准: 插入 ${TOTAL_RECORDS.toLocaleString()} 条记录耗时: ${elapsed} ms (吞吐率: ${throughput.toLocaleString()} 条/秒)`);

    // 性能基线断言：10 万条记录插入耗时必须在 12 秒内
    assert.strictEqual(elapsed < 12000, true, `10 万条 SQL 插入耗时 (${elapsed}ms) 超过 12 秒基线`);
});

test('🚀 性能基准测试 2：10 万条在库 SQL 数据的 DuckDB GROUP BY 高维内存聚合与 Top-N 查询耗时断言', async () => {
    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    const TOTAL_RECORDS = 100000;
    const records = new Array(TOTAL_RECORDS);

    for (let i = 0; i < TOTAL_RECORDS; i++) {
        records[i] = {
            id: i + 1,
            log_time: '2026-08-12 10:00:00.000',
            trace_id: `t-bench-${i % 500}`,
            thread_name: `th-${i % 8}`,
            exec_time_ms: (i % 100) + 1,
            result_rows: 1,
            db_manager: 'com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog',
            sql_template: `SELECT * FROM entity_${i % 50} WHERE code = ?`,
            sql_params: `['code_${i}']`,
            full_sql: `SELECT * FROM entity_${i % 50} WHERE code = 'code_${i}'`
        };
    }
    await db.insertBatch(records);

    // 测试频次榜聚合查询性能
    const startRepeated = Date.now();
    const repeated = await db.getTopRepeated(1, 20);
    const elapsedRepeated = Date.now() - startRepeated;

    // 测试慢 SQL 分页查询性能
    const startSlow = Date.now();
    const slow = await db.getTopSlow(1, 20);
    const elapsedSlow = Date.now() - startSlow;

    assert.strictEqual(repeated.rows.length, 20);
    assert.strictEqual(slow.rows.length, 20);

    console.log(`    ⚡ DuckDB 高维频次榜 GROUP BY 聚合查询耗时: ${elapsedRepeated} ms`);
    console.log(`    ⚡ DuckDB 慢 SQL 全表 ORDER BY 排序查询耗时: ${elapsedSlow} ms`);

    // 性能基线断言：DuckDB 在库 10 万条数据聚合必须在 100ms 内响应
    assert.strictEqual(elapsedRepeated < 100, true, `GROUP BY 频次榜查询耗时 (${elapsedRepeated}ms) 超过 100ms 基线`);
    assert.strictEqual(elapsedSlow < 100, true, `慢 SQL 全表排序查询耗时 (${elapsedSlow}ms) 超过 100ms 基线`);
});

test('🚀 性能基准测试 3：50 万行纯文本日志流式状态机解析速度测试', async () => {
    const tempFilePath = path.join(__dirname, 'temp_bench_500k.log');

    // 动态生成 50 万行日志
    const lines = [];
    for (let i = 0; i < 250000; i++) {
        lines.push(`2026-08-12 10:00:${String(i % 60).padStart(2, '0')}.000 INFO [DevNode] [] [] [] [t-bench-${i % 100}] [] [] [th-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog`);
        lines.push(`>SQL执行信息:影响行数:[1 rows] 执行时间:[${(i % 50) + 1}ms]\n>SQL语句:[select * from test_table_${i % 10}]`);
    }
    fs.writeFileSync(tempFilePath, lines.join('\n'), 'utf-8');

    const fileStat = fs.statSync(tempFilePath);
    const fileSizeMB = (fileStat.size / (1024 * 1024)).toFixed(2);

    let parsedCount = 0;
    const start = Date.now();
    const result = await parseLogFile(tempFilePath, () => {
        parsedCount++;
    });
    const elapsed = Date.now() - start;

    fs.unlinkSync(tempFilePath);

    assert.strictEqual(parsedCount, 250000);
    const lineThroughput = Math.round((result.totalLines / elapsed) * 1000);
    const mbPerSec = ((fileStat.size / (1024 * 1024)) / (elapsed / 1000)).toFixed(2);

    console.log(`    ⚡ 流式状态机解析 ${fileSizeMB} MB (${result.totalLines.toLocaleString()} 行文本) 耗时: ${elapsed} ms (吞吐率: ${lineThroughput.toLocaleString()} 行/秒, ${mbPerSec} MB/秒)`);

    // 性能基线断言：50 万行状态机解析耗时必须小于 3000ms
    assert.strictEqual(elapsed < 3000, true, `50万行文本状态机解析耗时 (${elapsed}ms) 超过 3000ms 基线`);
});
