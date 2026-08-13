#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const SqlLogDatabase = require('./db');
const { parseLogs } = require('./parser');
const { createServer } = require('./server');

// 默认日志路径
const DEFAULT_LOG_DIR = `D:\\Users\\boke\\Desktop\\source\\bokeerp\\erp-backend\\logs`;

async function main() {
    console.log(`\n==================================================`);
    console.log(`⚡ 极速 SQL 日志分析器 (sqllog CLI)`);
    console.log(`==================================================`);

    const args = process.argv.slice(2);
    let targetPath = '';

    if (args[0]) {
        targetPath = path.resolve(args[0]);
    } else {
        // 如果当前工作目录有 log 文件，优先解析当前目录
        const cwd = process.cwd();
        let hasLocalLogs = false;
        try {
            const files = fs.readdirSync(cwd);
            hasLocalLogs = files.some(f => f.endsWith('.log'));
        } catch (e) {}

        if (hasLocalLogs) {
            targetPath = cwd;
        } else if (fs.existsSync(DEFAULT_LOG_DIR)) {
            targetPath = DEFAULT_LOG_DIR;
        } else {
            targetPath = cwd;
        }
    }

    console.log(`\n📂 正在扫描日志路径: ${targetPath}`);

    const startTime = Date.now();
    const db = new SqlLogDatabase(':memory:');
    await db.initSchema();

    let batch = [];
    const BATCH_SIZE = 10000;

    // 流式解析并批量写入 DuckDB (微任务 0 开销优化)
    const parseResult = await parseLogs(targetPath, (record) => {
        batch.push(record);
        if (batch.length >= BATCH_SIZE) {
            const toInsert = batch;
            batch = [];
            return db.insertBatch(toInsert);
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

    // 启动 Web 控制台 (端口自动容错递增)
    createServer(db, parseResult, 3000);
}

main().catch(err => {
    console.error('❌ 发生异常错误:', err);
    process.exit(1);
});
