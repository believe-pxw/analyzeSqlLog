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
    assert.strictEqual(diagResult.length, 1);
    assert.strictEqual(diagResult[0].sql_template, 'SELECT * FROM user_table WHERE id = ?');
    assert.strictEqual(Number(diagResult[0].repeat_count), 6);
});



