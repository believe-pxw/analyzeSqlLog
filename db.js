const duckdb = require('duckdb');

class SqlLogDatabase {
    constructor() {
        this.db = new duckdb.Database(':memory:');
        this.conn = this.db.connect();
    }

    async initSchema() {
        return new Promise((resolve, reject) => {
            const sql = `
                CREATE TABLE sqllogs (
                    id BIGINT,
                    log_time VARCHAR,
                    trace_id VARCHAR,
                    thread_name VARCHAR,
                    exec_time_ms DOUBLE,
                    result_rows BIGINT,
                    db_manager VARCHAR,
                    sql_template VARCHAR,
                    sql_params VARCHAR,
                    full_sql VARCHAR
                );
            `;
            this.conn.exec(sql, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async insertBatch(records) {
        if (!records || records.length === 0) return;
        return new Promise((resolve, reject) => {
            this.conn.exec('BEGIN TRANSACTION', (err) => {
                if (err) return reject(err);
                const stmt = this.conn.prepare(`
                    INSERT INTO sqllogs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);
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
                        r.full_sql || ''
                    );
                }
                stmt.finalize(() => {
                    this.conn.exec('COMMIT', (err2) => {
                        if (err2) reject(err2);
                        else resolve();
                    });
                });
            });
        });
    }

    query(sql) {
        return new Promise((resolve, reject) => {
            this.conn.all(sql, (err, res) => {
                if (err) reject(err);
                else resolve(res);
            });
        });
    }

    async getTopRepeated(limit = 30) {
        const sql = `
            SELECT 
                sql_template,
                COUNT(*) as count,
                ROUND(SUM(exec_time_ms), 2) as total_time_ms,
                ROUND(AVG(exec_time_ms), 2) as avg_time_ms,
                ROUND(MAX(exec_time_ms), 2) as max_time_ms,
                COUNT(DISTINCT trace_id) as trace_count
            FROM sqllogs
            WHERE sql_template != ''
            GROUP BY sql_template
            ORDER BY count DESC, total_time_ms DESC
            LIMIT ${parseInt(limit, 10)};
        `;
        return this.query(sql);
    }

    async getTopSlow(limit = 30) {
        const sql = `
            SELECT 
                id, log_time, trace_id, thread_name, exec_time_ms, result_rows, sql_template, full_sql
            FROM sqllogs
            ORDER BY exec_time_ms DESC, id ASC
            LIMIT ${parseInt(limit, 10)};
        `;
        return this.query(sql);
    }

    async getByTraceId(traceId) {
        const cleanTraceId = (traceId || '').replace(/'/g, "''");
        const sql = `
            SELECT 
                id, log_time, trace_id, thread_name, exec_time_ms, result_rows, sql_template, full_sql
            FROM sqllogs
            WHERE trace_id = '${cleanTraceId}'
            ORDER BY id ASC;
        `;
        return this.query(sql);
    }

    async getDiagnostics() {
        const sql = `
            SELECT 
                trace_id,
                sql_template,
                COUNT(*) as repeat_count,
                ROUND(SUM(exec_time_ms), 2) as total_time_ms
            FROM sqllogs
            WHERE trace_id != '-' AND trace_id != '' AND sql_template != ''
            GROUP BY trace_id, sql_template
            HAVING COUNT(*) >= 5
            ORDER BY repeat_count DESC, total_time_ms DESC
            LIMIT 50;
        `;
        return this.query(sql);
    }

    async getTotalSummary() {
        const sql = `
            SELECT 
                COUNT(*) as total_sqls,
                COUNT(DISTINCT trace_id) as total_traces,
                COUNT(DISTINCT sql_template) as distinct_templates,
                ROUND(SUM(exec_time_ms), 2) as total_exec_time_ms,
                ROUND(MAX(exec_time_ms), 2) as max_exec_time_ms,
                ROUND(AVG(exec_time_ms), 2) as avg_exec_time_ms
            FROM sqllogs;
        `;
        const rows = await this.query(sql);
        return rows[0] || {};
    }
}

module.exports = SqlLogDatabase;
