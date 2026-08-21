import { describe, it, expect } from 'vitest';
import { parseTimeToMs, cleanSqlText, compressSqlColumns, parseSqlExecutionInfo } from './sqlParser';
import { parseLogFile } from './index';
import path from 'path';
import fs from 'fs';

describe('SQL Parser & Sanitizer Specs', () => {
  it('用例 1: parseTimeToMs 耗时转换测试 (支持 TimeCostLevel 扩展格式)', () => {
    expect(parseTimeToMs('0ms')).toBe(0);
    expect(parseTimeToMs('12ms')).toBe(12);
    expect(parseTimeToMs('1.5s')).toBe(1500);
    expect(parseTimeToMs('2m')).toBe(120000);
    expect(parseTimeToMs('3165ms/TimeCostLevel100ms200ms500ms1s2s')).toBe(3165);
    expect(parseTimeToMs('920ms/TimeCostLevel100ms200ms500ms')).toBe(920);
    expect(parseTimeToMs('428ms/TimeCostLevel100ms200ms')).toBe(428);
  });

  it('用例 2: cleanSqlText 清理换行符 > 前缀与尾部 ] 字符测试', () => {
    const rawSql = `select * from (select 
>                                    WF_Workitem.WorkItemID as WorkItemID,
>                                    WF_Workitem.WorkItemName as WorkItemName,
>                                    WF_Workitem.WorkItemState as WorkItemState
>                                    from WF_Workitem) ERPIndex ]`;

    const cleaned = cleanSqlText(rawSql);
    expect(cleaned.includes('>')).toBe(false);
    expect(cleaned.startsWith('select * from')).toBe(true);
    expect(cleaned.endsWith(']')).toBe(false);
  });

  it('用例 8 & 10: compressSqlColumns SQL 多列名精简压缩算法测试 (5列以上智能折叠)', () => {
    const longSql1 =
      'select OID, VerID, GroupID, CompanyCodeID, FiscalYearPeriod, Money_Debit, Money_Credit from EFI_VoucherNBalance_INCR order by GroupId';
    expect(compressSqlColumns(longSql1)).toBe('select ... from EFI_VoucherNBalance_INCR order by GroupId');

    const shortSql = 'SELECT Role FROM SYS_OperatorRole Where SOID= ?';
    expect(compressSqlColumns(shortSql)).toBe(shortSql);

    const userSql1 =
      "select table_name,index_name,column_name,extra_col1,extra_col2,extra_col3 from information_schema.STATISTICS where TABLE_SCHEMA = 'bkdb5000' order by table_name,index_name";
    expect(compressSqlColumns(userSql1)).toBe(
      "select ... from information_schema.STATISTICS where TABLE_SCHEMA = 'bkdb5000' order by table_name,index_name"
    );

    const userSql2 =
      'select `OID`,`SOID`,`POID`,`ConditionbaseValueFormula`,`AlternativeCalculationFormula`,`ExtraField` from EMM_PO_ConditionRecord where SOID= 1993072';
    expect(compressSqlColumns(userSql2)).toBe('select ... from EMM_PO_ConditionRecord where SOID= 1993072');
  });

  it('用例 3: 完整日志文件状态机与断句割裂防污染测试', async () => {
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

    const records: any[] = [];
    await parseLogFile(tempFilePath, (r) => {
      records.push(r);
    });

    fs.unlinkSync(tempFilePath);

    expect(records.length).toBe(2);
    expect(records[0].sql_template).toBe('select IPServerPort ,IPServerAddress,Code from BK_TaskGroup');
    expect(records[0].exec_time_ms).toBe(5);
    expect(records[0].trace_id).toBe('hcpc9te51703753lmmmmybe-0');
    expect(records[0].sql_template.includes('Performance')).toBe(false);
    expect(records[0].sql_template.includes('createScheduler')).toBe(false);

    expect(records[1].sql_template.includes('BK_ScheduledTask')).toBe(true);
    expect(records[1].sql_params).toBe('#0:createScheduler');
  });

  it('用例 26: SELECT @@lower_case_table_names 特殊语句与连续 SQL 解析', () => {
    const info1 = parseSqlExecutionInfo(
      '>SQL执行信息:影响行数:[1 rows]      执行时间:[45ms] 	  dbManager：[com.bokesoft.yes.mid.connection.dbmanager.MySqlDBManager@15fcc93b]'
    );
    expect(info1.resultRows).toBe(1);
    expect(info1.execTimeMs).toBe(45);
    expect(info1.dbManager).toBe('com.bokesoft.yes.mid.connection.dbmanager.MySqlDBManager@15fcc93b');

    const cleaned = cleanSqlText('>SQL语句:[SELECT @@lower_case_table_names]');
    expect(cleaned).toBe('SELECT @@lower_case_table_names');
  });
});
