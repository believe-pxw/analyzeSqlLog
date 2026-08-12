const duckdb = require('duckdb');
const path = require('path');
const fs = require('fs');

class SqlLogDatabase {
    /**
     * @param {string} dbPath - 数据库路径 (默认使用纯内存模式 :memory:)
     */
    constructor(dbPath = ':memory:') {
        // 如果根目录下存在以往残留的 sqllogs.duckdb 文件，尝试删除
        if (dbPath === ':memory:') {
            const diskDb = path.join(process.cwd(), 'sqllogs.duckdb');
            const diskWal = path.join(process.cwd(), 'sqllogs.duckdb.wal');
            try {
                if (fs.existsSync(diskDb)) fs.unlinkSync(diskDb);
                if (fs.existsSync(diskWal)) fs.unlinkSync(diskWal);
            } catch (e) {
                // 忽略删文件暂存锁
            }
        }

        this.dbPath = dbPath;
        this.db = new duckdb.Database(dbPath);
        this.conn = this.db.connect();
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
     * 初始化内存 SQL 数据库表结构与索引
     */
    async initSchema() {
        const createTableSql = `
            CREATE TABLE IF NOT EXISTS sqllogs (
                id INTEGER,
                log_time VARCHAR,
                trace_id VARCHAR,
                thread_name VARCHAR,
                exec_time_ms DOUBLE,
                result_rows INTEGER,
                db_manager VARCHAR,
                sql_template VARCHAR,
                sql_params VARCHAR,
                full_sql VARCHAR
            );
        `;
        await this.query(createTableSql);
    }

    /**
     * 批量高效插入 SQL 记录
     */
    async insertBatch(records) {
        if (!records || records.length === 0) return;

        return new Promise((resolve, reject) => {
            const stmt = this.conn.prepare(`
                INSERT INTO sqllogs (
                    id, log_time, trace_id, thread_name, exec_time_ms, 
                    result_rows, db_manager, sql_template, sql_params, full_sql
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            let pending = records.length;
            if (pending === 0) return resolve();

            for (const r of records) {
                stmt.run(
                    r.id,
                    r.log_time || '',
                    r.trace_id || '-',
                    r.thread_name || '-',
                    r.exec_time_ms || 0,
                    r.result_rows || 0,
                    r.db_manager || '',
                    r.sql_template || '',
                    r.sql_params || '',
                    r.full_sql || '',
                    (err) => {
                        if (err) {
                            stmt.finalize();
                            return reject(err);
                        }
                        pending--;
                        if (pending === 0) {
                            stmt.finalize(() => resolve());
                        }
                    }
                );
            }
        });
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
            SELECT id, log_time, trace_id, thread_name, exec_time_ms, result_rows, sql_template, full_sql
            FROM sqllogs
            ${whereClause}
            ORDER BY exec_time_ms DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(dataSql, [...params, pageSize, offset]);
        return { rows, total, page, pageSize };
    }

    /**
     * 🔗 按 TraceID 获取该动作下的全量 SQL 按时间顺序排列
     */
    async getByTraceId(traceId) {
        if (!traceId) return [];
        const sql = `
            SELECT id, log_time, trace_id, thread_name, exec_time_ms, result_rows, sql_template, full_sql
            FROM sqllogs
            WHERE trace_id = ?
            ORDER BY id ASC
        `;
        return await this.query(sql, [traceId]);
    }

    /**
     * 💡 N+1 疑难诊断：找出同一 TraceID 内重复调用的 SQL 模板 (次数 >= 5)
     */
    async getDiagnostics() {
        const sql = `
            SELECT 
                trace_id,
                sql_template,
                COUNT(*) as repeat_count,
                SUM(exec_time_ms) as total_time_ms
            FROM sqllogs
            WHERE trace_id != '-'
            GROUP BY trace_id, sql_template
            HAVING COUNT(*) >= 5
            ORDER BY repeat_count DESC, total_time_ms DESC
            LIMIT 20
        `;
        return await this.query(sql);
    }

    async close() {
        return new Promise((resolve) => {
            this.db.close(() => resolve());
        });
    }
}

module.exports = SqlLogDatabase;
