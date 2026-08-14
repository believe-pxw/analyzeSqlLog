const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { parseLogs, parseLogFile, parseTimeToMs, cleanSqlText } = require('../parser');
const SqlLogDatabase = require('../db');
const { compressSqlColumns, createServer } = require('../server');

test('1. parseTimeToMs 耗时转换测试 (支持 TimeCostLevel 扩展格式)', () => {
    assert.strictEqual(parseTimeToMs('0ms'), 0);
    assert.strictEqual(parseTimeToMs('12ms'), 12);
    assert.strictEqual(parseTimeToMs('1.5s'), 1500);
    assert.strictEqual(parseTimeToMs('2m'), 120000);
    assert.strictEqual(parseTimeToMs('3165ms/TimeCostLevel100ms200ms500ms1s2s'), 3165);
    assert.strictEqual(parseTimeToMs('920ms/TimeCostLevel100ms200ms500ms'), 920);
    assert.strictEqual(parseTimeToMs('428ms/TimeCostLevel100ms200ms'), 428);
});

test('2. cleanSqlText 清理换行符 > 前缀与尾部 ] 字符测试', () => {
    const rawSql = `select * from (select 
>                                    WF_Workitem.WorkItemID as WorkItemID,
>                                    WF_Workitem.WorkItemName as WorkItemName,
>                                    WF_Workitem.WorkItemState as WorkItemState
>                                    from WF_Workitem) ERPIndex ]`;

    const cleaned = cleanSqlText(rawSql);
    
    assert.strictEqual(cleaned.includes('>'), false);
    assert.strictEqual(cleaned.startsWith('select * from'), true);
    assert.strictEqual(cleaned.endsWith(']'), false);
});

test('3. 完整日志文件状态机与断句割裂防污染测试', async () => {
    const sampleLogContent = `2026-08-12 13:44:26.250 676397918000000 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [hcpc9te51703753lmmmmybe-0] [hcpc9te51703753lmmmmybe-1] [-] [Worker-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog 
>SQL执行信息:影响行数:[1 rows]      执行时间:[5ms] 	  dbManager：[com.bokesoft.yes.mid.connection.dbmanager.MySqlDBManager@26b4e672] 
>SQL语句:[select IPServerPort ,IPServerAddress,Code from BK_TaskGroup ]
2026-08-12 13:44:26.254 676397918540600 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [hcpc9te51703753lmmmmybe-0] [hcpc9te51703753lmmmmybe-1] [-] [Worker-2] com.bokesoft.erp.performance.Performance DB commit
2026-08-12 13:44:26.254 676397918956900 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [hcpc9te51703753lmmmmybe-0] [hcpc9te51703753lmmmmybe-1] [-] [Worker-2] com.bokesoft.erp.performance.Performance DB commit endActive action=-1
2026-08-12 13:44:26.254 676397919198700 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [hcpc9te51703753lmmmmybe-0] [hcpc9te51703753lmmmmybe-1] [-] [Worker-2] com.bokesoft.yes.mid.connection.dbmanager.GeneralDBManager 销毁dbManager：com.bokesoft.yes.mid.connection.dbmanager.MySqlDBManager@26b4e672
2026-08-12 13:44:26.255 676397919675000 DEBUG [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [hcpc9te51703753lmmmmybe-0] [hcpc9te51703753lmmmmybe-1] [-] [Worker-2] com.bokesoft.yes.erp.backgroundtask.ERPTaskJob >>>> 完成执行后台任务公式
2026-08-12 13:44:26.259 676397923816800 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [hcpc9te51703753lmmmmybe-0] [hcpc9te51703753lmmmmybe-1] [-] [Worker-2] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog 
>SQL执行信息:影响行数:[0 rows]      执行时间:[2ms] 	  dbManager：[com.bokesoft.yes.mid.connection.dbmanager.MySqlDBManager@26b4e672] 
>SQL语句:[select PeriodType,DayOfMonth,OID ,CurrentRunTime , TaskAddress  from BK_ScheduledTask  where ScheduledTaskID = ?]
>SQL参数:[#0:createScheduler]`;

    const tempFilePath = path.join(__dirname, 'test_temp.log');
    fs.writeFileSync(tempFilePath, sampleLogContent, 'utf-8');

    const records = [];
    await parseLogFile(tempFilePath, (r) => records.push(r));

    fs.unlinkSync(tempFilePath);

    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].sql_template, 'select IPServerPort ,IPServerAddress,Code from BK_TaskGroup');
    assert.strictEqual(records[0].exec_time_ms, 5);
    assert.strictEqual(records[0].trace_id, 'hcpc9te51703753lmmmmybe-0');
    assert.strictEqual(records[0].sql_template.includes('Performance'), false);
    assert.strictEqual(records[0].sql_template.includes('createScheduler'), false);

    assert.strictEqual(records[1].sql_template.includes('BK_ScheduledTask'), true);
    assert.strictEqual(records[1].sql_params, '#0:createScheduler');
});

test('4. DuckDB 内存聚合与后端分页测试', async () => {
    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    await db.insertBatch([
        { id: 1, log_time: '2026-08-12 10:00:00.000', trace_id: 't-1', thread_name: 'th-1', exec_time_ms: 10, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT * FROM test WHERE id = ?', sql_params: '#0:1', full_sql: 'SELECT * FROM test WHERE id = 1' },
        { id: 2, log_time: '2026-08-12 10:00:01.000', trace_id: 't-1', thread_name: 'th-1', exec_time_ms: 50, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT * FROM test WHERE id = ?', sql_params: '#0:2', full_sql: 'SELECT * FROM test WHERE id = 2' },
        { id: 3, log_time: '2026-08-12 10:00:02.000', trace_id: 't-2', thread_name: 'th-2', exec_time_ms: 100, result_rows: 5, db_manager: 'mysql', sql_template: 'UPDATE test SET name = ?', sql_params: '#0:a', full_sql: 'UPDATE test SET name = a' },
        { id: 4, log_time: '2026-08-12 10:00:03.000', trace_id: '-', thread_name: 'th-3', exec_time_ms: 5, result_rows: 1, db_manager: 'mysql', sql_template: 'update `SYS_Lock` set Slock=1 where UniqueKey=?', sql_params: '#0:a', full_sql: 'update `SYS_Lock` set Slock=1' }
    ]);

    const page1 = await db.getTopRepeated(1, 2, '', false);
    assert.strictEqual(page1.total, 3);
    assert.strictEqual(page1.rows.length, 2);
    assert.strictEqual(Number(page1.rows[0].count), 2);

    const page2 = await db.getTopRepeated(2, 2, '', false);
    assert.strictEqual(page2.total, 3);
    assert.strictEqual(page2.rows.length, 1);

    const slowPage1 = await db.getTopSlow(1, 2, '', false);
    assert.strictEqual(slowPage1.total, 4);
    assert.strictEqual(slowPage1.rows[0].exec_time_ms, 100);
});

test('5. parseLogs 只扫描文件名包含 server-info 或 server-error 的日志文件测试', async () => {
    const tempDir = path.join(__dirname, 'test_logs_dir');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const file1 = path.join(tempDir, 'DevNode-server-info.log');
    const file2 = path.join(tempDir, 'DevNode-server-error.log');
    const file3 = path.join(tempDir, 'DevNode-server-sqltime.log');

    fs.writeFileSync(file1, '2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-1] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[1 rows] 执行时间:[1ms]\n>SQL语句:[select 1]', 'utf-8');
    fs.writeFileSync(file2, '2026-08-12 10:00:01.000 ERROR [DevNode] [] [] [] [t-2] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[1 rows] 执行时间:[2ms]\n>SQL语句:[select 2]', 'utf-8');
    fs.writeFileSync(file3, '2026-08-12 10:00:02.000 INFO [DevNode] [] [] [] [t-3] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[1 rows] 执行时间:[3ms]\n>SQL语句:[select 3]', 'utf-8');

    const res = await parseLogs(tempDir, () => {});

    assert.strictEqual(res.totalFiles, 2);

    fs.unlinkSync(file1);
    fs.unlinkSync(file2);
    fs.unlinkSync(file3);
    fs.rmdirSync(tempDir);
});

test('6. 自动读取 test/fixtures 目录下的真实测试日志文件', async () => {
    const fixturesDir = path.join(__dirname, 'fixtures');
    if (fs.existsSync(fixturesDir)) {
        const records = [];
        const result = await parseLogs(fixturesDir, (r) => records.push(r));
        
        assert.strictEqual(result.totalFiles > 0, true);
        assert.strictEqual(records.length > 0, true);
    }
});

test('7. 针对 test/fixtures 下新增真实日志文件的 SQL 频次与最大耗时精确核验比对测试', async () => {
    const fixturesDir = path.join(__dirname, 'fixtures');
    if (!fs.existsSync(fixturesDir)) return;

    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    const records = [];
    await parseLogs(fixturesDir, (r) => records.push(r));
    await db.insertBatch(records);

    const summary = await db.getTotalSummary();
    const topRepeated = await db.getTopRepeated(1, 10, '', false);
    const topSlow = await db.getTopSlow(1, 10, '', false);

    assert.strictEqual(Number(summary.total_sqls), 2749);
    assert.strictEqual(Number(summary.total_traces), 205);
    
    assert.strictEqual(summary.max_exec_time_ms, 3165);

    assert.strictEqual(topRepeated.rows[0].sql_template, 'update `SYS_Lock` set Slock=1 where UniqueKey=?');
    assert.strictEqual(Number(topRepeated.rows[0].count), 540);

    assert.strictEqual(topRepeated.rows[1].sql_template, 'SELECT Role FROM SYS_OperatorRole Where SOID= ?');
    assert.strictEqual(Number(topRepeated.rows[1].count), 133);

    assert.strictEqual(topSlow.rows[0].exec_time_ms, 3165);
});

test('8. compressSqlColumns SQL多列名精简压缩算法原有用例测试', () => {
    const longSql1 = 'select OID, VerID, GroupID, CompanyCodeID, FiscalYearPeriod, Money_Debit, Money_Credit from EFI_VoucherNBalance_INCR order by GroupId';
    assert.strictEqual(compressSqlColumns(longSql1), 'select ... from EFI_VoucherNBalance_INCR order by GroupId');

    const shortSql = 'SELECT Role FROM SYS_OperatorRole Where SOID= ?';
    assert.strictEqual(compressSqlColumns(shortSql), shortSql);
});

test('9. GeneralDBManager 类名日志 TraceID 与 时间提取测试', async () => {
    const logContent = `2026-08-12 16:04:22.515 684794180481300 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [Main_9ckgsuc21703760lag6ndr3-0] [9ckgsuc21703760lag6ndr3-1] [-] [main] com.bokesoft.yes.mid.connection.dbmanager.GeneralDBManager 
>SQL执行信息:影响行数:[132669 rows]      执行时间:[3165ms/TimeCostLevel100ms200ms500ms1s2s] 	  dbManager：[com.bokesoft.yes.mid.connection.dbmanager.MySqlDBManager@19cce603] 
>SQL语句:[select COLUMN_NAME,TABLE_NAME,DATA_TYPE from information_schema.COLUMNS where TABLE_SCHEMA = ?]`;

    const tempFilePath = path.join(__dirname, 'test_general_db.log');
    fs.writeFileSync(tempFilePath, logContent, 'utf-8');

    const records = [];
    await parseLogFile(tempFilePath, (r) => records.push(r));
    fs.unlinkSync(tempFilePath);

    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].log_time, '2026-08-12 16:04:22.515');
    assert.strictEqual(records[0].trace_id, 'Main_9ckgsuc21703760lag6ndr3-0');
    assert.strictEqual(records[0].exec_time_ms, 3165);
});

test('10. 独立新增测试：全量复杂多列名 SQL 100% 精确折叠为 select ... from 测试', () => {
    const userSql1 = "select table_name,index_name,column_name from information_schema.STATISTICS where  TABLE_SCHEMA =   'bkdb5000'  order by table_name,index_name";
    assert.strictEqual(compressSqlColumns(userSql1), "select ... from information_schema.STATISTICS where  TABLE_SCHEMA =   'bkdb5000'  order by table_name,index_name");

    const userSql2 = "select `OID`,`SOID`,`POID`,`ConditionbaseValueFormula`,`AlternativeCalculationFormula` from EMM_PO_ConditionRecord where SOID=  1993072";
    assert.strictEqual(compressSqlColumns(userSql2), "select ... from EMM_PO_ConditionRecord where SOID=  1993072");
});

test('11. 独立新增测试：Trace 链路数据按耗时升降序逻辑校验', async () => {
    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    await db.insertBatch([
        { id: 1, log_time: '2026-08-12 10:00:00.000', trace_id: 't-sort', thread_name: 'th-1', exec_time_ms: 10, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT 1', sql_params: '', full_sql: 'SELECT 1' },
        { id: 2, log_time: '2026-08-12 10:00:01.000', trace_id: 't-sort', thread_name: 'th-1', exec_time_ms: 300, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT 2', sql_params: '', full_sql: 'SELECT 2' },
        { id: 3, log_time: '2026-08-12 10:00:02.000', trace_id: 't-sort', thread_name: 'th-1', exec_time_ms: 50, result_rows: 1, db_manager: 'mysql', sql_template: 'SELECT 3', sql_params: '', full_sql: 'SELECT 3' }
    ]);

    const traceRows = await db.getByTraceId('t-sort');
    assert.strictEqual(traceRows.length, 3);
    assert.strictEqual(traceRows[0].exec_time_ms, 10);

    // 内存降序排序测试
    const descSorted = [...traceRows].sort((a, b) => b.exec_time_ms - a.exec_time_ms);
    assert.strictEqual(descSorted[0].exec_time_ms, 300);
    assert.strictEqual(descSorted[1].exec_time_ms, 50);
    assert.strictEqual(descSorted[2].exec_time_ms, 10);
});

test('12. 独立新增测试：Trace 链路从耗时排序无感恢复原始日志时间顺序逻辑测试', () => {
    const rawData = [
        { id: 1, exec_time_ms: 10, full_sql: 'SQL 1' },
        { id: 2, exec_time_ms: 300, full_sql: 'SQL 2' },
        { id: 3, exec_time_ms: 50, full_sql: 'SQL 3' }
    ];

    const mapped = rawData.map((item, idx) => ({ ...item, _origIndex: idx }));

    const desc = [...mapped].sort((a, b) => b.exec_time_ms - a.exec_time_ms);
    assert.strictEqual(desc[0].full_sql, 'SQL 2');

    const restored = [...desc].sort((a, b) => a._origIndex - b._origIndex);
    assert.strictEqual(restored[0].full_sql, 'SQL 1');
    assert.strictEqual(restored[1].full_sql, 'SQL 2');
    assert.strictEqual(restored[2].full_sql, 'SQL 3');
});

test('13. 独立新增测试：【时间列】与【耗时列】经典表头交互双向排序断言', () => {
    const mapped = [
        { id: 10, exec_time_ms: 5, log_time: '2026-08-12 10:00:00', _origIndex: 0 },
        { id: 11, exec_time_ms: 200, log_time: '2026-08-12 10:00:01', _origIndex: 1 },
        { id: 12, exec_time_ms: 50, log_time: '2026-08-12 10:00:02', _origIndex: 2 }
    ];

    // 时间降序
    const timeDesc = [...mapped].sort((a, b) => b._origIndex - a._origIndex);
    assert.strictEqual(timeDesc[0].id, 12);
    assert.strictEqual(timeDesc[2].id, 10);

    // 时间升序
    const timeAsc = [...timeDesc].sort((a, b) => a._origIndex - b._origIndex);
    assert.strictEqual(timeAsc[0].id, 10);
    assert.strictEqual(timeAsc[2].id, 12);

    // 耗时降序
    const costDesc = [...mapped].sort((a, b) => b.exec_time_ms - a.exec_time_ms);
    assert.strictEqual(costDesc[0].id, 11);

    // 耗时升序
    const costAsc = [...mapped].sort((a, b) => a.exec_time_ms - b.exec_time_ms);
    assert.strictEqual(costAsc[0].id, 10);
});

test('14. 独立新增测试：parseLogs 递归深度扫描层级子目录 server-info/server-error 日志文件断言测试', async () => {
    const tempDir = path.join(__dirname, 'test_recursive_logs_dir');
    const subDir = path.join(tempDir, '2026-07');
    if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

    const file1 = path.join(tempDir, 'root-server-info.log');
    const file2 = path.join(subDir, 'sub-server-error.log');
    const file3 = path.join(subDir, 'ignored-other.log');

    fs.writeFileSync(file1, '2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-r1] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[1 rows] 执行时间:[1ms]\n>SQL语句:[select 100]', 'utf-8');
    fs.writeFileSync(file2, '2026-08-12 10:00:01.000 ERROR [DevNode] [] [] [] [t-r2] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[1 rows] 执行时间:[2ms]\n>SQL语句:[select 200]', 'utf-8');
    fs.writeFileSync(file3, '2026-08-12 10:00:02.000 INFO [DevNode] [] [] [] [t-r3] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[1 rows] 执行时间:[3ms]\n>SQL语句:[select 300]', 'utf-8');

    const records = [];
    const res = await parseLogs(tempDir, (r) => records.push(r));

    assert.strictEqual(res.totalFiles, 2);
    assert.strictEqual(records.length, 2);

    fs.unlinkSync(file1);
    fs.unlinkSync(file2);
    fs.unlinkSync(file3);
    fs.rmdirSync(subDir);
    fs.rmdirSync(tempDir);
});

test('15. 独立新增测试：onRecord 异步背压回调等待机制断言测试', async () => {
    const tempFilePath = path.join(__dirname, 'test_backpressure.log');
    fs.writeFileSync(tempFilePath, `2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-bp1] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[1 rows] 执行时间:[1ms]\n>SQL语句:[select 1]\n2026-08-12 10:00:01.000 INFO [DevNode] [] [] [] [t-bp2] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[1 rows] 执行时间:[2ms]\n>SQL语句:[select 2]`, 'utf-8');

    let isProcessing = false;
    let maxConcurrent = 0;

    await parseLogFile(tempFilePath, async () => {
        if (isProcessing) maxConcurrent++;
        isProcessing = true;
        await new Promise(r => setTimeout(r, 10));
        isProcessing = false;
    });

    fs.unlinkSync(tempFilePath);
    assert.strictEqual(maxConcurrent, 0);
});

test('16. 独立新增测试：Worker Threads 多核并行文件解析完整校验测试', async () => {
    const tempDir = path.join(__dirname, 'test_parallel_logs_dir');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const f1 = path.join(tempDir, 'p1-server-info.log');
    const f2 = path.join(tempDir, 'p2-server-error.log');

    fs.writeFileSync(f1, '2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-p1] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[1 rows] 执行时间:[10ms]\n>SQL语句:[select * from table1]', 'utf-8');
    fs.writeFileSync(f2, '2026-08-12 10:00:01.000 ERROR [DevNode] [] [] [] [t-p2] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[2 rows] 执行时间:[20ms]\n>SQL语句:[select * from table2]', 'utf-8');

    const records = [];
    const res = await parseLogs(tempDir, (r) => records.push(r));

    assert.strictEqual(res.totalFiles, 2);
    assert.strictEqual(records.length, 2);
    assert.strictEqual(records[0].id, 1);
    assert.strictEqual(records[1].id, 2);

    fs.unlinkSync(f1);
    fs.unlinkSync(f2);
    fs.rmdirSync(tempDir);
});

test('17. 独立新增测试：基于 test/fixtures 真实大日志文件的多核并行解析与 DuckDB Chunk 批量装载性能校验断言测试', async () => {
    const fixturesDir = path.join(__dirname, 'fixtures');
    if (!fs.existsSync(fixturesDir)) return;

    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    const start = Date.now();
    let batch = [];
    const BATCH_SIZE = 10000;

    const result = await parseLogs(fixturesDir, async (record) => {
        batch.push(record);
        if (batch.length >= BATCH_SIZE) {
            const toInsert = batch;
            batch = [];
            await db.insertBatch(toInsert);
        }
    });

    if (batch.length > 0) {
        await db.insertBatch(batch);
    }

    const elapsed = Date.now() - start;

    const summary = await db.getTotalSummary();
    assert.strictEqual(Number(summary.total_sqls), 2749);
    assert.strictEqual(Number(summary.total_traces), 205);
    assert.strictEqual(result.totalFiles >= 2, true);

    console.log(`\n    ⚡ test/fixtures 真实 17MB 日志文件全量解析与 DuckDB 装载耗时: ${elapsed} ms`);
});

test('18. 独立新增测试：Trace 链路后端大页面分页与单接口向下兼容断言测试', async () => {
    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    const sampleRecords = [];
    for (let i = 1; i <= 350; i++) {
        sampleRecords.push({
            id: i,
            log_time: `2026-08-12 10:00:${String(i % 60).padStart(2, '0')}.000`,
            trace_id: 't-page-test',
            thread_name: 'th-1',
            exec_time_ms: i * 2,
            result_rows: 1,
            db_manager: 'mysql',
            sql_template: `SELECT * FROM table_${i}`,
            sql_params: '',
            full_sql: `SELECT * FROM table_${i}`
        });
    }
    await db.insertBatch(sampleRecords);

    // 默认大页面 200 条/页
    const p1 = await db.getByTraceId('t-page-test', 1, 200);
    assert.strictEqual(p1.total, 350);
    assert.strictEqual(p1.rows.length, 200);
    assert.strictEqual(p1.page, 1);
    assert.strictEqual(p1.pageSize, 200);

    // 第 2 页 150 条
    const p2 = await db.getByTraceId('t-page-test', 2, 200);
    assert.strictEqual(p2.total, 350);
    assert.strictEqual(p2.rows.length, 150);
    assert.strictEqual(p2.page, 2);

    // 不传 page 参数，返回全量数组 (保持旧接口兼容)
    const allRows = await db.getByTraceId('t-page-test');
    assert.strictEqual(Array.isArray(allRows), true);
    assert.strictEqual(allRows.length, 350);
});

test('19. 独立新增测试：createServer HTTP 服务 WHATWG URL API 路由与查询参数响应测试', async () => {
    try {
        const db = new SqlLogDatabase(':memory:');
        await db.initSchema();
        await db.insertBatch([{
            id: 1,
            log_time: '2026-08-12 10:00:00.000',
            trace_id: 't-http-test',
            thread_name: 'th-1',
            exec_time_ms: 50,
            result_rows: 1,
            db_manager: 'mysql',
            sql_template: 'SELECT * FROM test_table WHERE id = ?',
            sql_params: '1',
            full_sql: 'SELECT * FROM test_table WHERE id = 1'
        }]);

        const server = createServer(db, { totalFiles: 1, totalLines: 10 }, 0);
        if (!server.listening) {
            await new Promise(resolve => server.once('listening', resolve));
        }
        const port = server.address().port;

        const resTop = await fetch(`http://127.0.0.1:${port}/api/top-repeated?page=1&pageSize=10`);
        const jsonTop = await resTop.json();
        assert.strictEqual(resTop.status, 200);
        assert.strictEqual(jsonTop.success, true);
        assert.strictEqual(jsonTop.data.length, 1);

        const resSlow = await fetch(`http://127.0.0.1:${port}/api/top-slow?page=1&pageSize=10`);
        const jsonSlow = await resSlow.json();
        assert.strictEqual(resSlow.status, 200);
        assert.strictEqual(jsonSlow.success, true);
        assert.strictEqual(jsonSlow.data.length, 1);

        const resTrace = await fetch(`http://127.0.0.1:${port}/api/trace?traceId=t-http-test&page=1`);
        const jsonTrace = await resTrace.json();
        assert.strictEqual(resTrace.status, 200);
        assert.strictEqual(jsonTrace.success, true);
        assert.strictEqual(jsonTrace.data.length, 1);

        server.close();
    } catch (err) {
        console.error('Test 19 Failed:', err);
        throw err;
    }
});

test('20. 独立新增测试：parseLogs 与 parseLogFile 兼容支持 .gz 压缩日志解压与 SQL 提取断言测试', async () => {
    const zlib = require('zlib');
    const tempDir = path.join(__dirname, 'test_gz_logs_dir');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

    const gzFile = path.join(tempDir, 'DevNode-server-info-06-01-2026-1.log.gz');
    const logContent = '2026-08-12 10:00:00.000 INFO [DevNode] [] [] [] [t-gz-1] [] [] [w-1] com.bokesoft.yes.mid.connection.dbmanager.PreparedStatementWithLog\n>SQL执行信息:影响行数:[3 rows] 执行时间:[15ms]\n>SQL语句:[select * from gz_table]';

    const buffer = zlib.gzipSync(Buffer.from(logContent, 'utf-8'));
    fs.writeFileSync(gzFile, buffer);

    const records = [];
    const res = await parseLogs(tempDir, (r) => records.push(r));

    assert.strictEqual(res.totalFiles, 1);
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0].trace_id, 't-gz-1');
    assert.strictEqual(records[0].exec_time_ms, 15);
    assert.strictEqual(records[0].sql_template, 'select * from gz_table');

    fs.unlinkSync(gzFile);
    fs.rmdirSync(tempDir);
});

test('21. 独立新增测试：getDiagnostics 自动过滤 UPDATE 语句断言测试', async () => {
    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    const testRecords = [];
    // 写入 6 条重复的 SELECT
    for (let i = 0; i < 6; i++) {
        testRecords.push({
            id: i + 1,
            log_time: '2026-08-12 10:00:00.000',
            trace_id: 't-diag-test',
            thread_name: 'th-1',
            exec_time_ms: 10,
            result_rows: 1,
            db_manager: 'MySqlDBManager@123',
            sql_template: 'SELECT * FROM user_table WHERE id = ?',
            sql_params: '1',
            full_sql: 'SELECT * FROM user_table WHERE id = 1'
        });
    }
    // 写入 10 条重复的 UPDATE
    for (let i = 0; i < 10; i++) {
        testRecords.push({
            id: i + 7,
            log_time: '2026-08-12 10:00:00.000',
            trace_id: 't-diag-test',
            thread_name: 'th-1',
            exec_time_ms: 20,
            result_rows: 1,
            db_manager: 'MySqlDBManager@123',
            sql_template: 'UPDATE summary_table SET money = money + ? WHERE group_id = ?',
            sql_params: '100, 1',
            full_sql: 'UPDATE summary_table SET money = money + 100 WHERE group_id = 1'
        });
    }

    await db.insertBatch(testRecords);

    const diagResult = await db.getDiagnostics('t-diag-test');
    assert.strictEqual(diagResult.total, 1);
    assert.strictEqual(diagResult.rows.length, 1);
    assert.strictEqual(diagResult.rows[0].sql_template, 'SELECT * FROM user_table WHERE id = ?');
    assert.strictEqual(Number(diagResult.rows[0].repeat_count), 6);
});



test('22. 独立新增测试：parseLogFile 解析记录包含正确的 line_number 和 source_file 字段', async () => {
    const fixtureFile = path.join(__dirname, 'fixtures', 'sample-server-info.log');
    if (!fs.existsSync(fixtureFile)) {
        // 如果 fixture 文件不存在，使用临时文件测试
        const tmpFile = path.join(__dirname, 'fixtures', '_tmp_linenum_test_server-info.log');
        const logLines = [
            '2026-08-12 10:00:01.001 [INFO] [xxx] [xxx] [xxx] [trace-A] [xxx] [xxx] [thread-1] [com.xxx.PreparedStatementWithLog]',
            '>SQL执行信息: 影响行数:[1 rows] 执行时间:[5ms]',
            '>dbManager：[TestDB]',
            '>SQL语句:[SELECT * FROM table_a WHERE id = ?]',
            '>SQL参数:[123]',
            '>完整SQL:[SELECT * FROM table_a WHERE id = 123]',
            '',
            '2026-08-12 10:00:02.002 [INFO] [xxx] [xxx] [xxx] [trace-B] [xxx] [xxx] [thread-2] [com.xxx.PreparedStatementWithLog]',
            '>SQL执行信息: 影响行数:[3 rows] 执行时间:[15ms]',
            '>dbManager：[TestDB2]',
            '>SQL语句:[SELECT * FROM table_b WHERE name = ?]',
            '>SQL参数:[test]',
            '>完整SQL:[SELECT * FROM table_b WHERE name = test]',
        ];
        fs.writeFileSync(tmpFile, logLines.join('\n'), 'utf-8');

        const records = [];
        await parseLogFile(tmpFile, (record) => {
            records.push(record);
        });

        // 清理临时文件
        fs.unlinkSync(tmpFile);

        assert.ok(records.length >= 2, `应至少解析出 2 条记录, 实际: ${records.length}`);

        // 验证 line_number 存在且为正整数
        for (const r of records) {
            assert.ok(typeof r.line_number === 'number', 'line_number 应为数字');
            assert.ok(r.line_number > 0, `line_number 应为正数, 实际: ${r.line_number}`);
        }

        // 第一条记录应在第1行（Header行），第二条在第8行
        assert.strictEqual(records[0].line_number, 1, '第一条记录应在第 1 行');
        assert.strictEqual(records[1].line_number, 8, '第二条记录应在第 8 行');

        // 验证 source_file 是绝对路径
        for (const r of records) {
            assert.ok(typeof r.source_file === 'string', 'source_file 应为字符串');
            assert.ok(path.isAbsolute(r.source_file), `source_file 应为绝对路径, 实际: ${r.source_file}`);
        }
    } else {
        const records = [];
        await parseLogFile(fixtureFile, (record) => {
            records.push(record);
        });

        assert.ok(records.length > 0, '应解析出记录');

        // 验证所有记录都有 line_number 和 source_file
        for (const r of records) {
            assert.ok(typeof r.line_number === 'number' && r.line_number > 0, `line_number 应为正整数, 实际: ${r.line_number}`);
            assert.ok(typeof r.source_file === 'string' && path.isAbsolute(r.source_file), `source_file 应为绝对路径, 实际: ${r.source_file}`);
        }

        // 验证第一条记录的行号应 >= 1
        assert.ok(records[0].line_number >= 1, '第一条记录行号应 >= 1');

        // 验证行号递增
        for (let i = 1; i < records.length; i++) {
            assert.ok(records[i].line_number > records[i-1].line_number, `第 ${i+1} 条记录行号应大于第 ${i} 条`);
        }
    }
});

test('23. 独立新增测试：DuckDB 存储和查询 line_number 与 source_file 字段断言', async () => {
    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    const testRecords = [];
    for (let i = 1; i <= 5; i++) {
        testRecords.push({
            id: i,
            log_time: `2026-08-12 10:00:0${i}.000`,
            trace_id: i <= 3 ? 'trace-X' : 'trace-Y',
            thread_name: 'thread-1',
            exec_time_ms: i * 10,
            result_rows: i,
            db_manager: 'TestDB',
            sql_template: 'SELECT * FROM test_table WHERE id = ?',
            sql_params: String(i),
            full_sql: `SELECT * FROM test_table WHERE id = ${i}`,
            line_number: i * 100,
            source_file: 'D:/logs/server-info.log'
        });
    }

    await db.insertBatch(testRecords);

    // 验证 getTopSlow 返回 line_number 和 source_file
    const slowResult = await db.getTopSlow(1, 5);
    assert.ok(slowResult.rows.length > 0, '应有慢SQL结果');
    assert.strictEqual(slowResult.rows[0].source_file, 'D:/logs/server-info.log');
    assert.ok(slowResult.rows[0].line_number > 0, 'line_number 应为正数');

    // 验证 getByTraceId 返回 line_number 和 source_file
    const traceResult = await db.getByTraceId('trace-X', 1, 10);
    assert.ok(traceResult.rows.length === 3, '应有3条 trace-X 记录');
    for (const r of traceResult.rows) {
        assert.strictEqual(r.source_file, 'D:/logs/server-info.log');
        assert.ok(r.line_number > 0);
    }

    // 验证 getByTemplate 查询
    const templateResult = await db.getByTemplate('SELECT * FROM test_table WHERE id = ?', 1, 10);
    assert.strictEqual(templateResult.total, 5, '应有5条匹配模板的记录');
    assert.strictEqual(templateResult.rows.length, 5);
    for (const r of templateResult.rows) {
        assert.strictEqual(r.source_file, 'D:/logs/server-info.log');
        assert.ok(r.line_number > 0);
    }

    // 验证 getByTemplate 空模板返回空结果
    const emptyResult = await db.getByTemplate('', 1, 10);
    assert.strictEqual(emptyResult.total, 0);
    assert.strictEqual(emptyResult.rows.length, 0);
});

test('24. 独立新增测试：校验 server.js 渲染出的前端 HTML 页面中内嵌 JavaScript 语法绝对正确', () => {
    const vm = require('vm');
    const { createServer } = require('../server');
    
    // 从 server.js 中获取渲染的 HTML 内容
    const serverFileContent = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
    const fnStart = serverFileContent.indexOf('function getDashboardHtml()');
    const fnEnd = serverFileContent.indexOf('module.exports');
    const fnCode = serverFileContent.slice(fnStart, fnEnd);
    
    // 动态评估 getDashboardHtml 函数
    const getDashboardHtml = new Function(fnCode + '\nreturn getDashboardHtml();');
    const html = getDashboardHtml();

    assert.ok(html && html.includes('<script>'), 'HTML 应包含 script 标签');

    const scriptStart = html.indexOf('<script>') + 8;
    const scriptEnd = html.indexOf('</script>');
    const jsCode = html.slice(scriptStart, scriptEnd);

    // 断言 6 大 Tab 面板在 HTML 中 100% 存在
    assert.ok(html.includes('id="panel-diagnose"'), '应包含 panel-diagnose 面板');
    assert.ok(html.includes('id="panel-slow"'), '应包含 panel-slow 面板');
    assert.ok(html.includes('id="panel-trace"'), '应包含 panel-trace 面板');
    assert.ok(html.includes('id="panel-repeated"'), '应包含 panel-repeated 面板');
    assert.ok(html.includes('id="panel-detail"'), '应包含 panel-detail 面板');
    assert.ok(html.includes('id="panel-trace-summary"'), '应包含 panel-trace-summary 面板');

    // 校验 HTML 中 <table> 与 </table> 标签 100% 闭合对称
    const openTables = (html.match(/<table\b/g) || []).length;
    const closeTables = (html.match(/<\/table>/g) || []).length;
    assert.strictEqual(openTables, closeTables, `HTML <table> 开始标签数(${openTables}) 应与 </table> 结束标签数(${closeTables}) 严格相等`);

    // 断言 vm.Script 解析前端生成的脚本不抛出 SyntaxError
    assert.doesNotThrow(() => {
        new vm.Script(jsCode);
    }, '前端生成的 JS 代码不应包含任何语法错误');
});

test('25. 独立新增测试：基于 test/fixtures 真实日志构建完整的 Web 页面与 API 端到端集成测试，断言每个页面均有数据输出', async () => {
    // 1. 初始化纯内存数据库
    const testDb = new SqlLogDatabase(':memory:');
    await testDb.initSchema();

    // 2. 解析 test/fixtures 真实测试日志并批量装载入库
    const fixturesDir = path.join(__dirname, 'fixtures');
    const records = [];
    await parseLogs(fixturesDir, async (record) => {
        records.push(record);
        if (records.length >= 10000) {
            await testDb.insertBatch(records.splice(0, records.length));
        }
    });
    if (records.length > 0) {
        await testDb.insertBatch(records);
    }

    const parseStats = { totalFiles: 2, totalLines: 1000, totalRecords: 500, costMs: 50 };

    // 3. 动态分配随机可用端口启动 HTTP 服务
    const server = createServer(testDb, parseStats, 0);
    const address = server.address();
    const port = address.port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // 校验 1: 主页 Dashboard HTML 接入
        const resHome = await fetch(`${baseUrl}/`);
        assert.strictEqual(resHome.status, 200);
        const htmlText = await resHome.text();
        assert.ok(htmlText.includes('SQL 日志'), '主页应包含标题');
        assert.ok(htmlText.includes('panel-repeated'), '主页应包含频次榜面板');
        assert.ok(htmlText.includes('panel-trace-summary'), '主页应包含 Trace 聚合大盘面板');

        // 校验 2: GET /api/summary 概览接口
        const resSummary = await fetch(`${baseUrl}/api/summary`);
        const jsonSummary = await resSummary.json();
        assert.strictEqual(jsonSummary.success, true);
        assert.ok(jsonSummary.data.total_sqls > 0, '概览解析 SQL 总数应大于 0');

        // 校验 3: GET /api/top-repeated SQL 频次榜接口 (断言有真实数据出来!)
        const resRepeated = await fetch(`${baseUrl}/api/top-repeated?page=1&pageSize=20`);
        const jsonRepeated = await resRepeated.json();
        assert.strictEqual(jsonRepeated.success, true);
        assert.ok(jsonRepeated.total > 0, `SQL 频次榜总数应大于 0, 实际: ${jsonRepeated.total}`);
        assert.ok(jsonRepeated.data.length > 0, `SQL 频次榜第一页应有数据记录, 实际: ${jsonRepeated.data.length}`);
        
        const sampleRecord = jsonRepeated.data[0];
        assert.ok(sampleRecord.sql_template, '频次榜记录应包含 sql_template');

        // 校验 4: GET /api/top-slow 慢 SQL 排行接口 (断言有真实数据出来!)
        const resSlow = await fetch(`${baseUrl}/api/top-slow?page=1&pageSize=20`);
        const jsonSlow = await resSlow.json();
        assert.strictEqual(jsonSlow.success, true);
        assert.ok(jsonSlow.total > 0, `慢 SQL 排行总数应大于 0, 实际: ${jsonSlow.total}`);
        assert.ok(jsonSlow.data.length > 0, `慢 SQL 第一页应有数据记录, 实际: ${jsonSlow.data.length}`);
        assert.ok(jsonSlow.totalCostMs > 0, '慢 SQL 接口应返回 totalCostMs');
        assert.ok(jsonSlow.maxCostMs > 0, '慢 SQL 接口应返回 maxCostMs');

        // 校验 5: GET /api/diagnostics N+1 循环诊断接口
        const resDiag = await fetch(`${baseUrl}/api/diagnostics?page=1&pageSize=20`);
        const jsonDiag = await resDiag.json();
        // 校验 6: GET /api/by-template SQL 调用明细接口 (断言有真实数据出来!)
        const testTemplate = sampleRecord.sql_template;
        const resDetail = await fetch(`${baseUrl}/api/by-template?sqlTemplate=${encodeURIComponent(testTemplate)}&page=1&pageSize=10`);
        const jsonDetail = await resDetail.json();
        assert.strictEqual(jsonDetail.success, true);
        assert.ok(jsonDetail.total > 0, `SQL 明细总数应大于 0, 实际: ${jsonDetail.total}`);
        assert.ok(jsonDetail.data.length > 0, `SQL 明细第一页应有数据, 实际: ${jsonDetail.data.length}`);
        assert.ok(jsonDetail.data[0].source_file, '明细数据应包含 source_file 绝对路径');
        assert.ok(jsonDetail.data[0].line_number > 0, '明细数据应包含有效 line_number 行号');
        assert.ok(jsonDetail.totalCostMs !== undefined, '明细接口应返回 totalCostMs');

        // 校验 7: GET /api/trace Trace 链路分析接口 (断言有真实数据出来!)
        const sampleTraceId = jsonDetail.data[0].trace_id;
        if (sampleTraceId && sampleTraceId !== '-') {
            const resTrace = await fetch(`${baseUrl}/api/trace?traceId=${encodeURIComponent(sampleTraceId)}&page=1&pageSize=50`);
            const jsonTrace = await resTrace.json();
            assert.strictEqual(jsonTrace.success, true);
            assert.ok(jsonTrace.total > 0, `Trace 链路总数应大于 0, 实际: ${jsonTrace.total}`);
            assert.ok(jsonTrace.data.length > 0, `Trace 链路列表应有数据, 实际: ${jsonTrace.data.length}`);
            assert.ok(jsonTrace.totalCostMs !== undefined, 'Trace 链路应返回 totalCostMs');
        }

        // 校验 8: GET /api/trace-summary-list Trace 聚合大盘接口
        const resTraceSum = await fetch(`${baseUrl}/api/trace-summary-list?page=1&pageSize=20`);
        const jsonTraceSum = await resTraceSum.json();
        assert.strictEqual(jsonTraceSum.success, true);
        assert.ok(jsonTraceSum.total > 0, `Trace 聚合大盘总数应大于 0, 实际: ${jsonTraceSum.total}`);
        assert.ok(jsonTraceSum.data.length > 0, `Trace 聚合大盘应有数据, 实际: ${jsonTraceSum.data.length}`);
        assert.ok(jsonTraceSum.data[0].sql_count > 0, 'Trace 聚合记录应包含 sql_count');
        assert.ok(jsonTraceSum.data[0].total_time_ms >= 0, 'Trace 聚合记录应包含 total_time_ms');

        // 校验 9: GET /api/decompress-gz 压缩包解压接口
        const gzFixture = path.join(fixturesDir, 'sample-server-info.log.gz');
        if (fs.existsSync(gzFixture)) {
            const resGz = await fetch(`${baseUrl}/api/decompress-gz?filePath=${encodeURIComponent(gzFixture)}`);
            const jsonGz = await resGz.json();
            assert.strictEqual(jsonGz.success, true);
            assert.ok(jsonGz.decompressedPath && fs.existsSync(jsonGz.decompressedPath), '解压后文件应真实存在');
        }

        // 校验 10: 前端 DOM 页面渲染全覆盖断言测试 (模拟真实 DOM 环境调用前端 render 函数)
        const mockDomMap = {
            'repeated-tbody': { innerHTML: '' },
            'slow-tbody': { innerHTML: '' },
            'diagnose-tbody': { innerHTML: '' },
            'detail-tbody': { innerHTML: '' },
            'trace-tbody': { innerHTML: '' },
            'trace-summary-tbody': { innerHTML: '' },
            'trace-summary-stat': { innerText: '' },
            'stat-total-sqls': { innerText: '' },
            'stat-max-cost': { innerText: '' },
            'stat-total-traces': { innerText: '' },
            'stat-total-time': { innerText: '' },
            'stat-context-label': { innerText: '' },
            'parse-time': { innerText: '' },
            'detail-header': { innerHTML: '' },
            'trace-summary': { innerText: '' },
            'slow-summary': { innerText: '' },
            'trace-input': { value: sampleTraceId || 'test-trace' },
            'trace-diagnose': { value: '' },
            'trace-slow': { value: '' },
            'inp-min-repeat': { value: '5' },
            'inp-min-cost': { value: '0' },
            'inp-trace-min-cost': { value: '0' },
            'search-repeated': { value: '' },
            'search-slow': { value: '' },
            'search-diagnose': { value: '' },
            'search-trace-summary': { value: '' },
            'search-trace-sql': { value: '' },
            'repeated-pagination': { innerHTML: '' },
            'slow-pagination': { innerHTML: '' },
            'diagnose-pagination': { innerHTML: '' },
            'detail-pagination': { innerHTML: '' },
            'trace-pagination': { innerHTML: '' },
            'trace-summary-pagination': { innerHTML: '' }
        };

        const mockDocument = {
            getElementById: (id) => mockDomMap[id] || null,
            querySelectorAll: () => [],
            addEventListener: () => {}
        };

        const vm = require('vm');
        const serverFileContent = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf-8');
        const fnStart = serverFileContent.indexOf('function getDashboardHtml()');
        const fnEnd = serverFileContent.indexOf('module.exports');
        const fnCode = serverFileContent.slice(fnStart, fnEnd);
        const getDashboardHtml = new Function(fnCode + '\nreturn getDashboardHtml();');
        const html = getDashboardHtml();
        const scriptStart = html.indexOf('<script>') + 8;
        const scriptEnd = html.indexOf('</script>');
        const jsCode = html.slice(scriptStart, scriptEnd);

        const sandbox = {
            document: mockDocument,
            window: { open: () => {} },
            navigator: { clipboard: { writeText: async () => {} } },
            fetch: globalThis.fetch,
            console
        };
        const context = vm.createContext(sandbox);
        vm.runInContext(jsCode, context);

        // A. 校验频次榜前端 DOM 真正渲染出 <tr>...</tr> 节点与查看调用按钮！
        context.renderRepeatedTable(jsonRepeated.data);
        const repeatedHtml = mockDomMap['repeated-tbody'].innerHTML;
        assert.ok(repeatedHtml.includes('<tr>'), '频次榜 DOM 必须包含 <tr> 渲染节点');
        assert.ok(repeatedHtml.includes('btn-view-calls'), '频次榜 DOM 必须包含查看调用按钮');

        // B. 校验慢 SQL 排行前端 DOM 渲染节点
        context.renderSlowTable(jsonSlow.data);
        const slowHtml = mockDomMap['slow-tbody'].innerHTML;
        assert.ok(slowHtml.includes('<tr>'), '慢 SQL DOM 必须包含 <tr> 渲染节点');

        // C. 校验 N+1 循环诊断前端 DOM 渲染节点
        context.renderDiagnoseTable(jsonDiag.data);
        const diagHtml = mockDomMap['diagnose-tbody'].innerHTML;
        assert.ok(diagHtml.includes('<tr>'), 'N+1 诊断 DOM 必须包含 <tr> 渲染节点');

        // D. 校验 Trace 聚合大盘前端 DOM 渲染节点
        context.renderTraceSummaryTable(jsonTraceSum.data);
        const traceSumHtml = mockDomMap['trace-summary-tbody'].innerHTML;
        assert.ok(traceSumHtml.includes('<tr>'), 'Trace 聚合大盘 DOM 必须包含 <tr> 渲染节点');

        // E. 校验前端动态上下文统计更新函数 updateContextStats
        context.updateContextStats({
            totalSqls: 1234,
            maxCostMs: 888,
            totalTraces: 56,
            totalCostMs: 99999
        }, '🔁 测试上下文');
        assert.strictEqual(mockDomMap['stat-total-sqls'].innerText, '1,234');
        assert.strictEqual(mockDomMap['stat-max-cost'].innerText, '888 ms');
        assert.strictEqual(mockDomMap['stat-total-traces'].innerText, '56');
        assert.strictEqual(mockDomMap['stat-total-time'].innerText, '99,999 ms');
        assert.strictEqual(mockDomMap['stat-context-label'].innerText, '🔁 测试上下文');
    } finally {
        if (server) {
            if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
            await new Promise(r => server.close(r));
        }
        await testDb.close();
    }
});

test('26. 独立新增测试：以真实 DuckDB 数据库为标准，验证 SELECT @@... 与连续 SQL 无损解析落库与全局检索', async () => {
    const sampleLog = `2026-08-13 15:52:40.193 770491858398800 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [Main_r64yutf91703842bcf68c80-0] [r64yutf91703842bcf68c80-1] [-] [main] com.bokesoft.yes.mid.connection.dbmanager.GeneralDBManager 
>SQL执行信息:影响行数:[1 rows]      执行时间:[45ms] 	  dbManager：[com.bokesoft.yes.mid.connection.dbmanager.MySqlDBManager@15fcc93b] 
>SQL语句:[SELECT @@lower_case_table_names] 
2026-08-13 15:52:40.193 770491858688400 INFO [DevNode] [2.0.1.10:8089] [2.0.1.10] [WIN-20241012NIM] [Main_r64yutf91703842bcf68c80-0] [r64yutf91703842bcf68c80-1] [-] [main] com.bokesoft.erp.performance.Performance SELECT @@lower_case_table_names endActive action=-1
>SQL执行信息:影响行数:[2 rows]      执行时间:[10ms] 	  dbManager：[com.bokesoft.yes.mid.connection.dbmanager.MySqlDBManager@15fcc93b] 
>SQL语句:[SELECT 1]`;

    const tmpLogDir = path.join(__dirname, 'temp_db_verify_dir');
    if (!fs.existsSync(tmpLogDir)) fs.mkdirSync(tmpLogDir, { recursive: true });
    const tmpLogPath = path.join(tmpLogDir, 'DevNode-server-info-test.log');
    fs.writeFileSync(tmpLogPath, sampleLog);

    const testDb = new SqlLogDatabase(':memory:');
    await testDb.initSchema();

    try {
        let batch = [];
        const res = await parseLogs(tmpLogDir, (record) => {
            batch.push(record);
            if (batch.length >= 10000) {
                const toInsert = batch;
                batch = [];
                return testDb.insertBatch(toInsert);
            }
        });
        if (batch.length > 0) {
            await testDb.insertBatch(batch);
        }

        // 1. 验证解析行数与总条数
        assert.strictEqual(res.totalRecords, 2, '流式解析总记录数应为 2');

        // 2. 以 DB 真实数据为标准，直查 sqllogs 全表
        const allDbRows = await testDb.query('SELECT * FROM sqllogs ORDER BY id ASC');
        assert.strictEqual(allDbRows.length, 2, 'DuckDB 中必须精确存在 2 条持久化 SQL 记录');

        // 3. 严格断言 SELECT @@lower_case_table_names 在 DB 中的各个字段
        const lowerCaseRecord = allDbRows.find(r => r.sql_template.includes('lower_case_table_names'));
        assert.ok(lowerCaseRecord, 'DuckDB 中必须能够查出 SELECT @@lower_case_table_names');
        assert.strictEqual(lowerCaseRecord.sql_template, 'SELECT @@lower_case_table_names');
        assert.strictEqual(lowerCaseRecord.full_sql, 'SELECT @@lower_case_table_names');
        assert.strictEqual(lowerCaseRecord.exec_time_ms, 45);
        assert.strictEqual(lowerCaseRecord.result_rows, 1);
        assert.strictEqual(lowerCaseRecord.trace_id, 'Main_r64yutf91703842bcf68c80-0');
        assert.strictEqual(lowerCaseRecord.db_manager, 'com.bokesoft.yes.mid.connection.dbmanager.MySqlDBManager@15fcc93b');

        // 4. 以 DB 业务查询方法为标准进行验证
        // A. 频次榜全库关键词搜索
        const repeatedSearch = await testDb.getTopRepeated(1, 20, 'lower_case');
        assert.strictEqual(repeatedSearch.total, 1, '通过 keyword="lower_case" 在频次榜中应能查出 1 条模板');
        assert.strictEqual(repeatedSearch.rows[0].sql_template, 'SELECT @@lower_case_table_names');

        // B. 慢 SQL 排行全库关键词搜索
        const slowSearch = await testDb.getTopSlow(1, 20, '', 0, 'lower_case');
        assert.strictEqual(slowSearch.total, 1, '通过 keyword="lower_case" 在慢 SQL 中应能查出 1 条记录');
        assert.strictEqual(slowSearch.rows[0].exec_time_ms, 45);

        // C. 按 TraceID 链路查询
        const traceRows = await testDb.getByTraceId('Main_r64yutf91703842bcf68c80-0', 1, 50);
        assert.strictEqual(traceRows.total, 2, 'Trace 链路中应包含该 Trace 下的全部 2 条 SQL');
        assert.strictEqual(traceRows.rows[0].sql_template, 'SELECT @@lower_case_table_names');
    } finally {
        await testDb.close();
        if (fs.existsSync(tmpLogPath)) fs.unlinkSync(tmpLogPath);
        if (fs.existsSync(tmpLogDir)) fs.rmdirSync(tmpLogDir);
    }
});

test('27. 独立新增测试：验证 getByTemplate 与 /api/by-template 支持 traceId + dbManager 精准联合过滤及总耗时统计', async () => {
    const testDb = new SqlLogDatabase(':memory:');
    await testDb.initSchema();

    // 构造跨 Trace、跨 dbManager 的同名 SQL 模板记录
    const records = [
        {
            log_time: '2026-08-13 10:00:00.000',
            trace_id: 'Trace_A',
            db_manager: 'MySqlDBManager@11111111',
            exec_time_ms: 10,
            result_rows: 1,
            sql_template: 'SELECT * FROM users WHERE id = ?',
            full_sql: 'SELECT * FROM users WHERE id = 1',
            source_file: '/app/logs/server-info.log',
            line_number: 100
        },
        {
            log_time: '2026-08-13 10:00:01.000',
            trace_id: 'Trace_A',
            db_manager: 'MySqlDBManager@11111111',
            exec_time_ms: 20,
            result_rows: 1,
            sql_template: 'SELECT * FROM users WHERE id = ?',
            full_sql: 'SELECT * FROM users WHERE id = 2',
            source_file: '/app/logs/server-info.log',
            line_number: 110
        },
        {
            log_time: '2026-08-13 10:00:02.000',
            trace_id: 'Trace_A',
            db_manager: 'MySqlDBManager@22222222', // 同 Trace 不同 dbManager 句柄
            exec_time_ms: 30,
            result_rows: 1,
            sql_template: 'SELECT * FROM users WHERE id = ?',
            full_sql: 'SELECT * FROM users WHERE id = 3',
            source_file: '/app/logs/server-info.log',
            line_number: 120
        },
        {
            log_time: '2026-08-13 10:00:03.000',
            trace_id: 'Trace_B', // 不同 Trace
            db_manager: 'MySqlDBManager@11111111',
            exec_time_ms: 40,
            result_rows: 1,
            sql_template: 'SELECT * FROM users WHERE id = ?',
            full_sql: 'SELECT * FROM users WHERE id = 4',
            source_file: '/app/logs/server-info.log',
            line_number: 130
        }
    ];

    await testDb.insertBatch(records);

    try {
        // 1. 无过滤：全库查询该模板
        const allRes = await testDb.getByTemplate('SELECT * FROM users WHERE id = ?', 1, 50);
        assert.strictEqual(allRes.total, 4, '无过滤时应查到全库 4 条调用');
        assert.strictEqual(allRes.totalCostMs, 100, '总耗时应为 10+20+30+40=100ms');
        assert.strictEqual(allRes.avgCostMs, 25, '平均耗时应为 25ms');

        // 2. 精准过滤：指定 traceId="Trace_A" + dbManager="MySqlDBManager@11111111"
        const filteredRes = await testDb.getByTemplate('SELECT * FROM users WHERE id = ?', 1, 50, 'Trace_A', 'MySqlDBManager@11111111');
        assert.strictEqual(filteredRes.total, 2, '精准过滤后必须精确为该事务连接内的 2 条记录');
        assert.strictEqual(filteredRes.rows.length, 2);
        assert.strictEqual(filteredRes.totalCostMs, 30, '过滤后总耗时应为 10+20=30ms');
        assert.strictEqual(filteredRes.avgCostMs, 15, '过滤后平均耗时应为 15ms');
        assert.strictEqual(filteredRes.rows[0].full_sql, 'SELECT * FROM users WHERE id = 1');
        assert.strictEqual(filteredRes.rows[1].full_sql, 'SELECT * FROM users WHERE id = 2');

        // 3. HTTP API 层验证
        const server = createServer(testDb, null, 0);
        const port = server.address().port;
        const apiUrl = `http://127.0.0.1:${port}/api/by-template?sqlTemplate=${encodeURIComponent('SELECT * FROM users WHERE id = ?')}&traceId=Trace_A&dbManager=${encodeURIComponent('MySqlDBManager@11111111')}`;
        
        const httpRes = await fetch(apiUrl);
        const json = await httpRes.json();
        assert.strictEqual(json.success, true);
        assert.strictEqual(json.total, 2);
        assert.strictEqual(json.totalCostMs, 30);
        assert.strictEqual(json.avgCostMs, 15);
        assert.strictEqual(json.data.length, 2);

        server.close();
    } finally {
        await testDb.close();
    }
});

test('28. 独立新增测试：验证 getTraceSummaryList 与 /api/trace-summary-list 按 TraceID 聚合分组大盘与多维过滤', async () => {
    const testDb = new SqlLogDatabase(':memory:');
    await testDb.initSchema();

    const records = [
        // Trace_1: 3条 SQL，总耗时 150ms，2 个连接句柄
        { log_time: '2026-08-13 12:00:00.000', trace_id: 'Trace_Alpha', db_manager: 'DBMgr@A1', exec_time_ms: 50, result_rows: 1, sql_template: 'SELECT 1', full_sql: 'SELECT 1', source_file: 'f.log', line_number: 1 },
        { log_time: '2026-08-13 12:00:01.000', trace_id: 'Trace_Alpha', db_manager: 'DBMgr@A1', exec_time_ms: 30, result_rows: 1, sql_template: 'SELECT 2', full_sql: 'SELECT 2', source_file: 'f.log', line_number: 2 },
        { log_time: '2026-08-13 12:00:02.000', trace_id: 'Trace_Alpha', db_manager: 'DBMgr@A2', exec_time_ms: 70, result_rows: 1, sql_template: 'SELECT 3', full_sql: 'SELECT 3', source_file: 'f.log', line_number: 3 },
        // Trace_2: 1条 SQL，总耗时 20ms，1 个连接句柄
        { log_time: '2026-08-13 13:00:00.000', trace_id: 'Trace_Beta', db_manager: 'DBMgr@B1', exec_time_ms: 20, result_rows: 1, sql_template: 'SELECT 4', full_sql: 'SELECT 4', source_file: 'f.log', line_number: 4 },
        // 无效 Trace: '-' 应被自动排除
        { log_time: '2026-08-13 14:00:00.000', trace_id: '-', db_manager: 'DBMgr@None', exec_time_ms: 10, result_rows: 1, sql_template: 'SELECT 5', full_sql: 'SELECT 5', source_file: 'f.log', line_number: 5 }
    ];

    await testDb.insertBatch(records);

    try {
        // 1. 全量大盘聚合查询
        const sumList = await testDb.getTraceSummaryList(1, 20);
        assert.strictEqual(sumList.total, 2, '有效 Trace 总数应为 2 (排除 -)');
        assert.strictEqual(sumList.rows.length, 2);

        // 验证第一条 (Trace_Alpha 耗时 150ms 排名第一)
        const alpha = sumList.rows[0];
        assert.strictEqual(alpha.trace_id, 'Trace_Alpha');
        assert.strictEqual(alpha.sql_count, 3);
        assert.strictEqual(alpha.total_time_ms, 150);
        assert.strictEqual(alpha.avg_time_ms, 50);
        assert.strictEqual(alpha.max_time_ms, 70);
        assert.strictEqual(alpha.tx_count, 2, '独立连接句柄数应为 2');
        assert.ok(alpha.start_time.startsWith('2026-08-13 12:00:00'), '首条执行时间应正确');

        // 2. 最小总耗时过滤 (minCostMs >= 50)
        const filteredCost = await testDb.getTraceSummaryList(1, 20, '', 50);
        assert.strictEqual(filteredCost.total, 1, '耗时>=50ms 的 Trace 只有 Trace_Alpha');
        assert.strictEqual(filteredCost.rows[0].trace_id, 'Trace_Alpha');

        // 3. 关键字过滤 (keyword="Beta")
        const filteredKw = await testDb.getTraceSummaryList(1, 20, 'Beta', 0);
        assert.strictEqual(filteredKw.total, 1);
        assert.strictEqual(filteredKw.rows[0].trace_id, 'Trace_Beta');

        // 4. HTTP API 层验证
        const server = createServer(testDb, null, 0);
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/trace-summary-list?page=1&pageSize=10&keyword=Alpha`);
        const json = await res.json();
        assert.strictEqual(json.success, true);
        assert.strictEqual(json.total, 1);
        assert.strictEqual(json.data[0].trace_id, 'Trace_Alpha');
        assert.strictEqual(json.data[0].total_time_ms, 150);

        server.close();
    } finally {
        await testDb.close();
    }
});

test('29. 独立新增测试：验证慢 SQL 排行与 Trace 链路分析总耗时大盘统计度量', async () => {
    const testDb = new SqlLogDatabase(':memory:');
    await testDb.initSchema();

    const records = [
        { log_time: '2026-08-13 15:00:00.000', trace_id: 'Trace_X', db_manager: 'DBMgr@1', exec_time_ms: 120, result_rows: 10, sql_template: 'SELECT 1', full_sql: 'SELECT 1', source_file: 'f.log', line_number: 1 },
        { log_time: '2026-08-13 15:00:01.000', trace_id: 'Trace_X', db_manager: 'DBMgr@1', exec_time_ms: 80, result_rows: 5, sql_template: 'SELECT 2', full_sql: 'SELECT 2', source_file: 'f.log', line_number: 2 },
        { log_time: '2026-08-13 15:00:02.000', trace_id: 'Trace_Y', db_manager: 'DBMgr@2', exec_time_ms: 40, result_rows: 1, sql_template: 'SELECT 3', full_sql: 'SELECT 3', source_file: 'f.log', line_number: 3 }
    ];

    await testDb.insertBatch(records);

    try {
        // 1. 慢 SQL 总耗时统计度量
        const slowRes = await testDb.getTopSlow(1, 20, '', 50); // 耗时>=50ms
        assert.strictEqual(slowRes.total, 2);
        assert.strictEqual(slowRes.totalCostMs, 200, '慢 SQL 累计耗时应为 120+80=200ms');
        assert.strictEqual(slowRes.maxCostMs, 120, '慢 SQL 最高耗时应为 120ms');

        // 2. Trace 链路总耗时与平均耗时统计度量
        const traceRes = await testDb.getByTraceId('Trace_X', 1, 50);
        assert.strictEqual(traceRes.total, 2);
        assert.strictEqual(traceRes.totalCostMs, 200, 'Trace_X 累计总耗时应为 200ms');
        assert.strictEqual(traceRes.avgCostMs, 100, 'Trace_X 平均耗时应为 100ms');
    } finally {
        await testDb.close();
    }
});

test('30. 独立新增测试：验证 N+1 诊断在过滤 TraceID / 循环次数 / 关键词等条件下的动态上下文统计准确性', async () => {
    const testDb = new SqlLogDatabase(':memory:');
    await testDb.initSchema();

    // 构造 2 个不同 Trace 的 N+1 场景
    // Trace_1: 循环 6 次 SELECT A (每次 10ms，总 60ms)
    // Trace_2: 循环 8 次 SELECT B (每次 20ms，总 160ms)
    const records = [];
    for (let i = 0; i < 6; i++) {
        records.push({
            log_time: `2026-08-13 10:00:0${i}.000`,
            trace_id: 'Trace_Diag_1',
            db_manager: 'DBMgr@Conn1',
            exec_time_ms: 10,
            result_rows: 1,
            sql_template: 'SELECT * FROM tab_a WHERE id = ?',
            full_sql: `SELECT * FROM tab_a WHERE id = ${i}`,
            source_file: 'a.log',
            line_number: i + 1
        });
    }
    for (let i = 0; i < 8; i++) {
        records.push({
            log_time: `2026-08-13 10:01:0${i}.000`,
            trace_id: 'Trace_Diag_2',
            db_manager: 'DBMgr@Conn2',
            exec_time_ms: 20,
            result_rows: 1,
            sql_template: 'SELECT * FROM tab_b WHERE id = ?',
            full_sql: `SELECT * FROM tab_b WHERE id = ${i}`,
            source_file: 'b.log',
            line_number: i + 1
        });
    }

    await testDb.insertBatch(records);

    try {
        // 1. 无过滤 N+1 诊断统计 (minRepeatCount = 5)
        const diagAll = await testDb.getDiagnostics('', 1, 20, 5, '');
        assert.strictEqual(diagAll.total, 2, '包含 2 个 N+1 事务组');
        assert.strictEqual(diagAll.totalSqls, 14, 'N+1 循环 SQL 总执行次数应为 6+8=14');
        assert.strictEqual(diagAll.totalCostMs, 220, 'N+1 循环累计总耗时应为 60+160=220ms');
        assert.strictEqual(diagAll.maxCostMs, 20, 'N+1 单条最高耗时应为 20ms');
        assert.strictEqual(diagAll.totalTraces, 2, '涉及独立 Trace 数应为 2');

        // 2. 针对 Trace_Diag_1 进行精准过滤
        const diagTrace1 = await testDb.getDiagnostics('Trace_Diag_1', 1, 20, 5, '');
        assert.strictEqual(diagTrace1.total, 1);
        assert.strictEqual(diagTrace1.totalSqls, 6, '过滤后该 Trace 下的 N+1 SQL 次数应精确为 6');
        assert.strictEqual(diagTrace1.totalCostMs, 60, '过滤后该 Trace 下的 N+1 总耗时应为 60ms');
        assert.strictEqual(diagTrace1.maxCostMs, 10, '过滤后最高单条耗时应为 10ms');
        assert.strictEqual(diagTrace1.totalTraces, 1, '涉及独立 Trace 数应为 1');

        // 3. 针对关键词 tab_b 过滤
        const diagKw = await testDb.getDiagnostics('', 1, 20, 5, 'tab_b');
        assert.strictEqual(diagKw.total, 1);
        assert.strictEqual(diagKw.totalSqls, 8);
        assert.strictEqual(diagKw.totalCostMs, 160);

        // 4. HTTP API 层集成测试
        const server = createServer(testDb, null, 0);
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/api/diagnostics?traceId=Trace_Diag_1&minRepeatCount=5`);
        const json = await res.json();
        assert.strictEqual(json.success, true);
        assert.strictEqual(json.totalSqls, 6);
        assert.strictEqual(json.totalCostMs, 60);
        assert.strictEqual(json.maxCostMs, 10);
        assert.strictEqual(json.totalTraces, 1);

        server.close();
    } finally {
        await testDb.close();
    }
});

test('31. 独立新增测试：parseActionLine 性能动作行解析与单位微秒换算测试', () => {
    const { parseActionLine } = require('../parser');

    // 格式: >[空格*]Level\tTime(0.001ms)\tSelfTime(0.001ms)\tGapTime(0.001ms)\tAction
    const line1 = '>0\t69196372\t25262856\t0\tMidVEFilter.doFilter';
    const res1 = parseActionLine(line1);
    assert.strictEqual(res1.level, 0);
    assert.strictEqual(res1.time_us, 69196372);
    assert.strictEqual(res1.self_time_us, 25262856);
    assert.strictEqual(res1.gap_time_us, 0);
    assert.strictEqual(res1.time_ms, 69196.37);
    assert.strictEqual(res1.self_time_ms, 25262.86);
    assert.strictEqual(res1.gap_time_ms, 0);
    assert.strictEqual(res1.action_name, 'MidVEFilter.doFilter');

    const line2 = '> 1\t9729706\t7906867\t747\tloadObject/MM_PurchaseOrder';
    const res2 = parseActionLine(line2);
    assert.strictEqual(res2.level, 1);
    assert.strictEqual(res2.time_us, 9729706);
    assert.strictEqual(res2.self_time_us, 7906867);
    assert.strictEqual(res2.gap_time_us, 747);
    assert.strictEqual(res2.time_ms, 9729.71);
    assert.strictEqual(res2.self_time_ms, 7906.87);
    assert.strictEqual(res2.gap_time_ms, 0.75);
    assert.strictEqual(res2.action_name, 'loadObject/MM_PurchaseOrder');

    // 异常容错测试
    assert.strictEqual(parseActionLine('>==================='), null);
    assert.strictEqual(parseActionLine('>Level\tTime(0.001ms)\t...'), null);
    assert.strictEqual(parseActionLine(''), null);
});

test('32. 独立新增测试：基于 sample-perf.log 真实日志验证 ActionRecorder 流式解析与多行 SQL 关联及父子关系计算', async () => {
    const samplePerfLog = path.resolve(__dirname, 'fixtures', 'perf', 'sample-perf.log');
    assert.ok(fs.existsSync(samplePerfLog), '测试样本 sample-perf.log 必须存在');

    const collectedTraces = [];
    const parseRes = await parseLogFile(samplePerfLog, () => {}, 0, (perfTrace) => {
        collectedTraces.push(perfTrace);
    });

    assert.ok(parseRes.totalPerfTraces > 0, '应成功解析出性能树');
    assert.strictEqual(collectedTraces.length, 1);

    const { trace, actions } = collectedTraces[0];
    assert.strictEqual(trace.trace_id, '43tv9pop1703907v2p9dss1-40');
    assert.strictEqual(trace.root_action, 'MidVEFilter.doFilter');
    assert.ok(trace.service_name.includes('MM_PurchaseOrder'), '首层 Service 应识别出 MM_PurchaseOrder');
    assert.strictEqual(trace.total_time_ms, 69196.37);
    assert.strictEqual(trace.self_time_ms, 25262.86);
    assert.ok(trace.sql_count > 5000, `SQL 节点数应大于 5000 条, 实际: ${trace.sql_count}`);
    assert.ok(actions.length > 5100, `总动作节点数应大于 5100, 实际: ${actions.length}`);

    // 验证父子关系树与 SQL 关联
    const rootNode = actions.find(a => a.level === 0);
    assert.strictEqual(rootNode.node_id, 0);
    assert.strictEqual(rootNode.parent_id, -1);

    const level1Nodes = actions.filter(a => a.level === 1);
    assert.ok(level1Nodes.length > 0);
    level1Nodes.forEach(n => assert.strictEqual(n.parent_id, 0));

    const sqlNode = actions.find(a => a.action_name.startsWith('QueryDatabase/') && a.sql_text);
    assert.ok(sqlNode, '应存在包含 sql_text 的 QueryDatabase/ 节点');
    assert.ok(sqlNode.sql_text.length > 0, 'SQL 文本不为空');
    assert.strictEqual(sqlNode.action_category, 'sql');
});

test('33. 独立新增测试：perf_traces 与 perf_actions 在 DuckDB 中的向量化存储与 getPerformanceTraceList 检索过滤', async () => {
    const testDb = new SqlLogDatabase(':memory:');
    await testDb.initSchema();

    const samplePerfLog = path.resolve(__dirname, 'fixtures', 'perf', 'sample-perf.log');
    const collectedTraces = [];
    await parseLogFile(samplePerfLog, () => {}, 0, (perfTrace) => {
        collectedTraces.push(perfTrace);
    });

    await testDb.insertPerfBatch(collectedTraces);

    try {
        // 1. 无过滤全量列表
        const listAll = await testDb.getPerformanceTraceList(1, 20);
        assert.strictEqual(listAll.total, 1);
        assert.strictEqual(listAll.rows.length, 1);
        const row = listAll.rows[0];
        assert.strictEqual(row.trace_id, '43tv9pop1703907v2p9dss1-40');
        assert.strictEqual(row.total_time_ms, 69196.37);
        assert.strictEqual(row.root_action, 'MidVEFilter.doFilter');
        assert.ok(row.service_name.includes('MM_PurchaseOrder'));
        assert.ok(row.action_count > 5000);
        assert.ok(row.sql_count > 5000);

        // 2. 耗时阈值过滤
        const listCostFilter = await testDb.getPerformanceTraceList(1, 20, '', 50000); // >= 50s
        assert.strictEqual(listCostFilter.total, 1);

        const listCostFilterNone = await testDb.getPerformanceTraceList(1, 20, '', 80000); // >= 80s
        assert.strictEqual(listCostFilterNone.total, 0);

        // 3. 关键字过滤
        const listKwFilter = await testDb.getPerformanceTraceList(1, 20, 'PurchaseOrder');
        assert.strictEqual(listKwFilter.total, 1);

        const listKwFilterNone = await testDb.getPerformanceTraceList(1, 20, 'NonExistentService');
        assert.strictEqual(listKwFilterNone.total, 0);
    } finally {
        await testDb.close();
    }
});

test('34. 独立新增测试：getPerformanceTree 深度调用树组装、Top 5 自耗时热点排序与四维耗时统计断言', async () => {
    const testDb = new SqlLogDatabase(':memory:');
    await testDb.initSchema();

    const samplePerfLog = path.resolve(__dirname, 'fixtures', 'perf', 'sample-perf.log');
    const collectedTraces = [];
    await parseLogFile(samplePerfLog, () => {}, 0, (perfTrace) => {
        collectedTraces.push(perfTrace);
    });

    await testDb.insertPerfBatch(collectedTraces);

    try {
        const treeData = await testDb.getPerformanceTree('43tv9pop1703907v2p9dss1-40');
        assert.ok(treeData, '应成功获取 Performance 树数据');
        assert.ok(treeData.trace, '包含 trace 摘要');
        assert.ok(treeData.actions.length > 5000, '包含全部 actions');
        assert.strictEqual(treeData.topSelfHotspots.length, 5, 'Top 5 自耗时热点应恰好 5 条');

        // 热点降序断言
        const h0 = treeData.topSelfHotspots[0];
        const h1 = treeData.topSelfHotspots[1];
        assert.strictEqual(h0.action_name, 'MidVEFilter.doFilter');
        assert.strictEqual(h0.self_time_ms, 25262.86);
        assert.strictEqual(h1.action_name, 'loadObject/MM_PurchaseOrder');
        assert.strictEqual(h1.self_time_ms, 7906.87);
        assert.ok(h0.self_time_ms >= h1.self_time_ms);
    } finally {
        await testDb.close();
    }
});

test('35. 独立新增测试：HTTP API /api/perf-trace-list 与 /api/perf-tree 端到端请求及前端 Tab 渲染断言', async () => {
    const testDb = new SqlLogDatabase(':memory:');
    await testDb.initSchema();

    const samplePerfLog = path.resolve(__dirname, 'fixtures', 'perf', 'sample-perf.log');
    const collectedTraces = [];
    await parseLogFile(samplePerfLog, () => {}, 0, (perfTrace) => {
        collectedTraces.push(perfTrace);
    });
    await testDb.insertPerfBatch(collectedTraces);

    const parseStats = { totalFiles: 1, totalLines: 10430, totalRecords: 0, totalPerfTraces: 1, costMs: 120 };
    const server = createServer(testDb, parseStats, 0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
        // 1. GET / 验证 HTML 中包含性能树 Tab 按钮与面板
        const htmlRes = await fetch(`${baseUrl}/`);
        const htmlText = await htmlRes.text();
        assert.ok(htmlText.includes('data-tab="perf-tree"'), '前端 HTML 必须包含 perf-tree Tab 按钮');
        assert.ok(htmlText.includes('id="panel-perf-tree"'), '前端 HTML 必须包含 panel-perf-tree 面板容器');
        assert.ok(htmlText.includes('id="perf-tbody"'), '前端 HTML 必须包含 perf-tbody 列表容器');
        assert.ok(htmlText.includes('id="perf-tree-tbody"'), '前端 HTML 必须包含 perf-tree-tbody 树容器');

        // 2. GET /api/perf-trace-list 接口
        const listRes = await fetch(`${baseUrl}/api/perf-trace-list?page=1&pageSize=20`);
        const listJson = await listRes.json();
        assert.strictEqual(listJson.success, true);
        assert.strictEqual(listJson.total, 1);
        assert.strictEqual(listJson.data[0].trace_id, '43tv9pop1703907v2p9dss1-40');

        // 3. GET /api/perf-tree 接口
        const treeRes = await fetch(`${baseUrl}/api/perf-tree?traceId=43tv9pop1703907v2p9dss1-40`);
        const treeJson = await treeRes.json();
        assert.strictEqual(treeJson.success, true);
        assert.strictEqual(treeJson.data.trace.trace_id, '43tv9pop1703907v2p9dss1-40');
        assert.ok(treeJson.data.actions.length > 5000);
        assert.strictEqual(treeJson.data.topSelfHotspots.length, 5);
    } finally {
        server.close();
        await testDb.close();
    }
});

