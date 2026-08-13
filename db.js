const duckdb = require('duckdb');
const path = require('path');
const fs = require('fs');
const os = require('os');

class SqlLogDatabase {
    /**
     * @param {string} dbPath - 数据库路径 (默认使用纯内存模式 :memory:)
     */
    constructor(dbPath = ':memory:') {
        if (dbPath === ':memory:') {
            const diskDb = path.join(process.cwd(), 'sqllogs.duckdb');
            const diskWal = path.join(process.cwd(), 'sqllogs.duckdb.wal');
            try {
                if (fs.existsSync(diskDb)) fs.unlinkSync(diskDb);
                if (fs.existsSync(diskWal)) fs.unlinkSync(diskWal);
            } catch (e) {}
        }

        this.dbPath = dbPath;
        this.db = new duckdb.Database(dbPath);
        this.conn = this.db.connect();
        this.insertChain = Promise.resolve();
    }

    /**
     * 初始化表结构与性能索引
     */
    async initSchema() {
        const sql = `
            CREATE TABLE IF NOT EXISTS sqllogs (
                id BIGINT PRIMARY KEY,
                log_time VARCHAR,
                trace_id VARCHAR,
                thread_name VARCHAR,
                exec_time_ms DOUBLE,
                result_rows INT,
                db_manager VARCHAR,
                sql_template VARCHAR,
                sql_params VARCHAR,
                full_sql VARCHAR,
                line_number INT,
                source_file VARCHAR
            );
            CREATE INDEX IF NOT EXISTS idx_trace_id ON sqllogs(trace_id);
            CREATE INDEX IF NOT EXISTS idx_exec_time ON sqllogs(exec_time_ms DESC);
        `;
        return this.query(sql);
    }

    /**
     * 包装 DuckDB 的 async query
     */
    query(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.conn.all(sql, ...params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows);
            });
        });
    }

    /**
     * 🚀 串行批量插入，彻底规避 TransactionContext 冲突并利用 DuckDB C++ SIMD 向量化载入
     */
    async insertBatch(records) {
        if (!records || records.length === 0) return;

        return new Promise((resolve, reject) => {
            this.insertChain = this.insertChain.then(async () => {
                try {
                    await this._doInsertBatch(records);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    async _doInsertBatch(records) {
        if (!records || records.length === 0) return;

        // 🚀 向量化极速 JSON 直载引擎：彻底规避 10 万次 V8 C++ 参数绑定与 AST 语法树解析开销
        const tmpPath = path.join(os.tmpdir(), `sqllog_batch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.json`);
        try {
            const normalized = records.map(r => ({
                id: r.id,
                log_time: r.log_time || '',
                trace_id: r.trace_id || '-',
                thread_name: r.thread_name || '-',
                exec_time_ms: r.exec_time_ms || 0,
                result_rows: r.result_rows || 0,
                db_manager: r.db_manager || '',
                sql_template: r.sql_template || '',
                sql_params: r.sql_params || '',
                full_sql: r.full_sql || '',
                line_number: r.line_number || 0,
                source_file: r.source_file || ''
            }));
            fs.writeFileSync(tmpPath, JSON.stringify(normalized));

            await this.query(`
                INSERT INTO sqllogs (
                    id, log_time, trace_id, thread_name, exec_time_ms,
                    result_rows, db_manager, sql_template, sql_params, full_sql,
                    line_number, source_file
                )
                SELECT 
                    id, log_time, trace_id, thread_name, exec_time_ms,
                    result_rows, db_manager, sql_template, sql_params, full_sql,
                    line_number, source_file
                FROM read_json_auto('${tmpPath.replace(/\\/g, '/')}')
            `);
        } finally {
            if (fs.existsSync(tmpPath)) {
                try { fs.unlinkSync(tmpPath); } catch (e) {}
            }
        }
    }

    /**
     * 获取数据库总体概览信息
     */
    async getTotalSummary() {
        const sql = `
            SELECT 
                COUNT(*) as total_sqls,
                COUNT(DISTINCT trace_id) as total_traces,
                COUNT(DISTINCT sql_template) as distinct_templates,
                COALESCE(SUM(exec_time_ms), 0) as total_exec_time_ms,
                COALESCE(MAX(exec_time_ms), 0) as max_exec_time_ms,
                COALESCE(ROUND(AVG(exec_time_ms), 2), 0) as avg_exec_time_ms
            FROM sqllogs
        `;
        const rows = await this.query(sql);
        return rows[0] || {};
    }

    /**
     * 📊 Top 频次 SQL 榜 (支持后端分页、TraceID过滤、后台锁排除)
     */
    async getTopRepeated(page = 1, pageSize = 20, traceId = '', excludeBackground = false) {
        let whereClause = 'WHERE 1=1';
        const params = [];

        if (traceId) {
            whereClause += ' AND trace_id = ?';
            params.push(traceId);
        }

        if (excludeBackground) {
            whereClause += " AND sql_template NOT LIKE '%SYS_Lock%' AND sql_template NOT LIKE '%BK_ScheduledTask%'";
        }

        const countSql = `SELECT COUNT(DISTINCT sql_template) as total FROM sqllogs ${whereClause}`;
        const countRows = await this.query(countSql, params);
        const total = countRows[0] ? Number(countRows[0].total) : 0;

        const offset = (page - 1) * pageSize;
        const dataSql = `
            SELECT 
                sql_template,
                COUNT(*) as count,
                SUM(exec_time_ms) as total_time_ms,
                ROUND(AVG(exec_time_ms), 2) as avg_time_ms,
                MAX(exec_time_ms) as max_time_ms,
                COUNT(DISTINCT trace_id) as trace_count
            FROM sqllogs
            ${whereClause}
            GROUP BY sql_template
            ORDER BY count DESC, total_time_ms DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(dataSql, [...params, pageSize, offset]);
        return { rows, total, page, pageSize };
    }

    /**
     * 🐢 慢 SQL 排行榜 (支持后端分页、TraceID过滤、后台锁排除)
     */
    async getTopSlow(page = 1, pageSize = 20, traceId = '', excludeBackground = false) {
        let whereClause = 'WHERE 1=1';
        const params = [];

        if (traceId) {
            whereClause += ' AND trace_id = ?';
            params.push(traceId);
        }

        if (excludeBackground) {
            whereClause += " AND sql_template NOT LIKE '%SYS_Lock%' AND sql_template NOT LIKE '%BK_ScheduledTask%'";
        }

        const countSql = `SELECT COUNT(*) as total FROM sqllogs ${whereClause}`;
        const countRows = await this.query(countSql, params);
        const total = countRows[0] ? Number(countRows[0].total) : 0;

        const offset = (page - 1) * pageSize;
        const dataSql = `
            SELECT id, log_time, trace_id, thread_name, exec_time_ms, result_rows, db_manager, sql_template, full_sql, line_number, source_file
            FROM sqllogs
            ${whereClause}
            ORDER BY exec_time_ms DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(dataSql, [...params, pageSize, offset]);
        return { rows, total, page, pageSize };
    }

    /**
     * 🔗 按 TraceID 获取该动作下的全量 SQL 按时间顺序排列 (支持后端分页，默认大页面)
     */
    async getByTraceId(traceId, page = null, pageSize = 200) {
        if (!traceId) return page !== null ? { rows: [], total: 0, page: 1, pageSize } : [];

        const whereClause = 'WHERE trace_id = ?';
        const params = [traceId];

        if (page === null) {
            const sql = `
                SELECT id, log_time, trace_id, thread_name, exec_time_ms, result_rows, db_manager, sql_template, full_sql, line_number, source_file
                FROM sqllogs
                ${whereClause}
                ORDER BY id ASC
            `;
            return await this.query(sql, params);
        }

        const countSql = `SELECT COUNT(*) as total FROM sqllogs ${whereClause}`;
        const countRows = await this.query(countSql, params);
        const total = countRows[0] ? Number(countRows[0].total) : 0;

        const offset = (page - 1) * pageSize;
        const dataSql = `
            SELECT id, log_time, trace_id, thread_name, exec_time_ms, result_rows, db_manager, sql_template, full_sql, line_number, source_file
            FROM sqllogs
            ${whereClause}
            ORDER BY id ASC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(dataSql, [...params, pageSize, offset]);
        return { rows, total, page, pageSize };
    }

    /**
     * 📋 按 SQL 模板精确查询所有调用明细 (支持分页)
     */
    async getByTemplate(sqlTemplate, page = 1, pageSize = 50) {
        if (!sqlTemplate) return { rows: [], total: 0, page: 1, pageSize };

        const whereClause = 'WHERE sql_template = ?';
        const params = [sqlTemplate];

        const countSql = `SELECT COUNT(*) as total FROM sqllogs ${whereClause}`;
        const countRows = await this.query(countSql, params);
        const total = countRows[0] ? Number(countRows[0].total) : 0;

        const offset = (page - 1) * pageSize;
        const dataSql = `
            SELECT id, log_time, trace_id, thread_name, exec_time_ms,
                   result_rows, db_manager, sql_template, full_sql,
                   line_number, source_file
            FROM sqllogs
            ${whereClause}
            ORDER BY id ASC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(dataSql, [...params, pageSize, offset]);
        return { rows, total, page, pageSize };
    }

    /**
     * 💡 N+1 疑难诊断：基于 dbManager 事务句柄与 TraceID (支持 TraceID 过滤)，找出同一个事务/连接内重复调用的 SQL 模板 (次数 >= 5)
     */
    async getDiagnostics(traceId = '') {
        let whereClause = "WHERE trace_id != '-' AND db_manager != '' AND LOWER(LTRIM(sql_template)) NOT LIKE 'update%'";
        const params = [];

        if (traceId) {
            whereClause += ' AND trace_id = ?';
            params.push(traceId);
        }

        const sql = `
            SELECT 
                trace_id,
                db_manager,
                sql_template,
                COUNT(*) as repeat_count,
                SUM(exec_time_ms) as total_time_ms
            FROM sqllogs
            ${whereClause}
            GROUP BY trace_id, db_manager, sql_template
            HAVING COUNT(*) >= 5
            ORDER BY repeat_count DESC, total_time_ms DESC
            LIMIT 50
        `;
        return await this.query(sql, params);
    }

    async close() {
        return new Promise((resolve) => {
            this.db.close(() => resolve());
        });
    }
}

module.exports = SqlLogDatabase;
