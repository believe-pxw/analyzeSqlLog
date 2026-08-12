const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');
const { parseLogs, parseLogFile, parseTimeToMs, cleanSqlText } = require('../parser');
const SqlLogDatabase = require('../db');

test('1. parseTimeToMs 耗时转换测试', () => {
    assert.strictEqual(parseTimeToMs('0ms'), 0);
    assert.strictEqual(parseTimeToMs('12ms'), 12);
    assert.strictEqual(parseTimeToMs('1.5s'), 1500);
    assert.strictEqual(parseTimeToMs('2m'), 120000);
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

test('5. parseLogs 只扫描文件名包含 info 或 error 的日志文件测试', async () => {
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
        
        // 校验 test/fixtures 下测试样本解析是否正常
        assert.strictEqual(result.totalFiles > 0, true);
        assert.strictEqual(records.length > 0, true);
    }
});
