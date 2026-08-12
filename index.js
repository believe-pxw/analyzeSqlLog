#!/usr/bin/env node

const path = require('path');
const { exec } = require('child_process');
const SqlLogDatabase = require('./db');
const { parseLogs } = require('./parser');
const { createServer } = require('./server');

// 默认日志路径
const DEFAULT_LOG_DIR = `D:\\Users\\boke\\Desktop\\source\\bokeerp\\erp-backend\\logs`;

async function main() {
    console.log(`\n==================================================`);
    console.log(`⚡ 极速 SQL 日志分析器 (Node.js + DuckDB 内存版)`);
    console.log(`==================================================`);

    // 尝试获取命令行传入的日志路径，否则使用默认路径
    const args = process.argv.slice(2);
    let targetPath = args[0] || DEFAULT_LOG_DIR;
    targetPath = path.resolve(targetPath);

    console.log(`\n📂 正在扫描日志路径: ${targetPath}`);

    const startTime = Date.now();
    const db = new SqlLogDatabase();
    await db.initSchema();

    let batch = [];
    const BATCH_SIZE = 2000;

    // 流式解析并批量写入 DuckDB
    const parseResult = await parseLogs(targetPath, async (record) => {
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

    const costMs = Date.now() - startTime;
    parseResult.costMs = costMs;

    console.log(`\n✅ 解析完成！数据已装载至 DuckDB 内存分析引擎`);
    console.log(`--------------------------------------------------`);
    console.log(`• 耗时: ${costMs} ms`);
    console.log(`• 日志文件数: ${parseResult.totalFiles}`);
    console.log(`• 扫描日志行数: ${parseResult.totalLines.toLocaleString()}`);
    console.log(`• 结构化 SQL 记录: ${parseResult.totalRecords.toLocaleString()} 条`);

    // 命令行打印 Top 5 频次 SQL
    try {
        const topRepeated = await db.getTopRepeated(5);
        console.log(`\n📊 【Top 5 出现次数最多的 SQL 模板】`);
        topRepeated.forEach((r, idx) => {
            console.log(`\n#${idx + 1} 出现次数: ${r.count} 次 | 总耗时: ${r.total_time_ms} ms | 平均: ${r.avg_time_ms} ms`);
            console.log(`   SQL 模板: ${r.sql_template.replace(/\s+/g, ' ').substring(0, 120)}...`);
        });
    } catch (err) {
        console.error('获取频次榜失败:', err);
    }

    // 命令行打印 Top 5 慢 SQL
    try {
        const topSlow = await db.getTopSlow(5);
        console.log(`\n🐢 【Top 5 执行耗时最长的 SQL】`);
        topSlow.forEach((r, idx) => {
            console.log(`\n#${idx + 1} 执行耗时: ${r.exec_time_ms} ms | TraceID: ${r.trace_id} | 时间: ${r.log_time}`);
            console.log(`   SQL: ${(r.full_sql || r.sql_template).replace(/\s+/g, ' ').substring(0, 120)}...`);
        });
    } catch (err) {
        console.error('获取慢 SQL 榜失败:', err);
    }

    // 启动 Web 控制台 (端口自动容错递增)
    createServer(db, parseResult, 3000);
}

main().catch(err => {
    console.error('❌ 发生异常错误:', err);
    process.exit(1);
});
