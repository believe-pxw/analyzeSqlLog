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
        this._lastId = 0;
        this._lastPerfTraceId = 0;
        this._lastPerfActionId = 0;
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

            CREATE TABLE IF NOT EXISTS perf_traces (
                id BIGINT PRIMARY KEY,
                trace_id VARCHAR,
                log_time VARCHAR,
                thread_name VARCHAR,
                root_action VARCHAR,
                service_name VARCHAR,
                total_time_ms DOUBLE,
                self_time_ms DOUBLE,
                gap_time_ms DOUBLE,
                biz_time_ms DOUBLE,
                sql_time_ms DOUBLE,
                commit_time_ms DOUBLE,
                action_count INT,
                sql_count INT,
                max_depth INT,
                source_file VARCHAR,
                line_number INT
            );
            CREATE INDEX IF NOT EXISTS idx_perf_trace_id ON perf_traces(trace_id);
            CREATE INDEX IF NOT EXISTS idx_perf_total_time ON perf_traces(total_time_ms DESC);

            CREATE TABLE IF NOT EXISTS perf_actions (
                id BIGINT PRIMARY KEY,
                trace_id VARCHAR,
                node_id INT,
                parent_id INT,
                level INT,
                time_us DOUBLE,
                self_time_us DOUBLE,
                gap_time_us DOUBLE,
                time_ms DOUBLE,
                self_time_ms DOUBLE,
                gap_time_ms DOUBLE,
                action_name VARCHAR,
                action_category VARCHAR,
                sql_text VARCHAR,
                line_number INT,
                source_file VARCHAR
            );
            CREATE INDEX IF NOT EXISTS idx_perf_act_trace_id ON perf_actions(trace_id);
            CREATE INDEX IF NOT EXISTS idx_perf_act_node_id ON perf_actions(node_id);
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

        const tmpPath = path.join(os.tmpdir(), `sqllog_batch_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.json`);
        try {
            const normalized = records.map(r => ({
                id: (r.id !== undefined && r.id !== null) ? Number(r.id) : ++this._lastId,
                log_time: r.log_time || '',
                trace_id: r.trace_id || '-',
                thread_name: r.thread_name || '-',
                exec_time_ms: Number(r.exec_time_ms) || 0,
                result_rows: Number(r.result_rows) || 0,
                db_manager: r.db_manager || '',
                sql_template: r.sql_template || '',
                sql_params: r.sql_params || '',
                full_sql: r.full_sql || '',
                line_number: Number(r.line_number) || 0,
                source_file: r.source_file || ''
            }));

            fs.writeFileSync(tmpPath, JSON.stringify(normalized));
            const safeTmpPath = tmpPath.replace(/\\/g, '/');
            const insertSql = `
                INSERT INTO sqllogs 
                SELECT 
                    id::BIGINT,
                    log_time::VARCHAR,
                    trace_id::VARCHAR,
                    thread_name::VARCHAR,
                    exec_time_ms::DOUBLE,
                    result_rows::INT,
                    db_manager::VARCHAR,
                    sql_template::VARCHAR,
                    sql_params::VARCHAR,
                    full_sql::VARCHAR,
                    line_number::INT,
                    source_file::VARCHAR
                FROM read_json_auto('${safeTmpPath}');
            `;
            await this.query(insertSql);
        } finally {
            try {
                if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
            } catch (e) {}
        }
    }

    /**
     * 🚀 插入 ActionRecorder 性能树与调用动作节点
     */
    async insertPerfBatch(perfTraceList) {
        if (!perfTraceList || perfTraceList.length === 0) return;

        return new Promise((resolve, reject) => {
            this.insertChain = this.insertChain.then(async () => {
                try {
                    await this._doInsertPerfBatch(perfTraceList);
                    resolve();
                } catch (err) {
                    reject(err);
                }
            });
        });
    }

    async _doInsertPerfBatch(perfTraceList) {
        const traces = [];
        const actions = [];

        for (const item of perfTraceList) {
            const t = item.trace;
            const tId = ++this._lastPerfTraceId;
            traces.push({
                id: tId,
                trace_id: t.trace_id || '-',
                log_time: t.log_time || '',
                thread_name: t.thread_name || '-',
                root_action: t.root_action || 'MidVEFilter.doFilter',
                service_name: t.service_name || '-',
                total_time_ms: Number(t.total_time_ms) || 0,
                self_time_ms: Number(t.self_time_ms) || 0,
                gap_time_ms: Number(t.gap_time_ms) || 0,
                biz_time_ms: Number(t.biz_time_ms) || 0,
                sql_time_ms: Number(t.sql_time_ms) || 0,
                commit_time_ms: Number(t.commit_time_ms) || 0,
                action_count: Number(t.action_count) || 0,
                sql_count: Number(t.sql_count) || 0,
                max_depth: Number(t.max_depth) || 0,
                source_file: t.source_file || '',
                line_number: Number(t.line_number) || 0
            });

            if (item.actions && item.actions.length > 0) {
                for (const a of item.actions) {
                    actions.push({
                        id: ++this._lastPerfActionId,
                        trace_id: t.trace_id || '-',
                        node_id: Number(a.node_id) || 0,
                        parent_id: a.parent_id !== undefined ? Number(a.parent_id) : -1,
                        level: Number(a.level) || 0,
                        time_us: Number(a.time_us) || 0,
                        self_time_us: Number(a.self_time_us) || 0,
                        gap_time_us: Number(a.gap_time_us) || 0,
                        time_ms: Number(a.time_ms) || 0,
                        self_time_ms: Number(a.self_time_ms) || 0,
                        gap_time_ms: Number(a.gap_time_ms) || 0,
                        action_name: a.action_name || '',
                        action_category: a.action_category || 'biz',
                        sql_text: a.sql_text || '',
                        line_number: Number(a.line_number) || 0,
                        source_file: a.source_file || ''
                    });
                }
            }
        }

        if (traces.length > 0) {
            const tmpTracePath = path.join(os.tmpdir(), `perf_traces_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.json`);
            try {
                fs.writeFileSync(tmpTracePath, JSON.stringify(traces));
                const safePath = tmpTracePath.replace(/\\/g, '/');
                await this.query(`
                    INSERT INTO perf_traces 
                    SELECT 
                        id::BIGINT,
                        trace_id::VARCHAR,
                        log_time::VARCHAR,
                        thread_name::VARCHAR,
                        root_action::VARCHAR,
                        service_name::VARCHAR,
                        total_time_ms::DOUBLE,
                        self_time_ms::DOUBLE,
                        gap_time_ms::DOUBLE,
                        biz_time_ms::DOUBLE,
                        sql_time_ms::DOUBLE,
                        commit_time_ms::DOUBLE,
                        action_count::INT,
                        sql_count::INT,
                        max_depth::INT,
                        source_file::VARCHAR,
                        line_number::INT
                    FROM read_json_auto('${safePath}');
                `);
            } finally {
                try { if (fs.existsSync(tmpTracePath)) fs.unlinkSync(tmpTracePath); } catch (e) {}
            }
        }

        if (actions.length > 0) {
            const tmpActPath = path.join(os.tmpdir(), `perf_actions_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.json`);
            try {
                fs.writeFileSync(tmpActPath, JSON.stringify(actions));
                const safePath = tmpActPath.replace(/\\/g, '/');
                await this.query(`
                    INSERT INTO perf_actions 
                    SELECT 
                        id::BIGINT,
                        trace_id::VARCHAR,
                        node_id::INT,
                        parent_id::INT,
                        level::INT,
                        time_us::DOUBLE,
                        self_time_us::DOUBLE,
                        gap_time_us::DOUBLE,
                        time_ms::DOUBLE,
                        self_time_ms::DOUBLE,
                        gap_time_ms::DOUBLE,
                        action_name::VARCHAR,
                        action_category::VARCHAR,
                        sql_text::VARCHAR,
                        line_number::INT,
                        source_file::VARCHAR
                    FROM read_json_auto('${safePath}');
                `);
            } finally {
                try { if (fs.existsSync(tmpActPath)) fs.unlinkSync(tmpActPath); } catch (e) {}
            }
        }
    }

    /**
     * ⚡ 获取 Performance 请求列表 (支持 TraceID 搜索、服务名过滤、耗时阈值、分页)
     */
    async getPerformanceTraceList(page = 1, pageSize = 20, keyword = '', minCostMs = 0) {
        let whereClause = 'WHERE 1=1';
        const params = [];

        if (keyword) {
            whereClause += ' AND (trace_id ILIKE ? OR service_name ILIKE ? OR root_action ILIKE ?)';
            params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
        }

        if (minCostMs > 0) {
            whereClause += ' AND total_time_ms >= ?';
            params.push(minCostMs);
        }

        const countSql = `SELECT COUNT(*) as total, COALESCE(SUM(total_time_ms), 0) as total_time_sum, COALESCE(MAX(total_time_ms), 0) as max_time FROM perf_traces ${whereClause}`;
        const countRows = await this.query(countSql, params);
        const total = countRows[0] ? Number(countRows[0].total) : 0;
        const totalTimeSum = countRows[0] ? Number(countRows[0].total_time_sum) : 0;
        const maxTime = countRows[0] ? Number(countRows[0].max_time) : 0;

        const offset = (page - 1) * pageSize;
        const sql = `
            SELECT 
                id,
                trace_id,
                log_time,
                thread_name,
                root_action,
                service_name,
                total_time_ms,
                self_time_ms,
                gap_time_ms,
                biz_time_ms,
                sql_time_ms,
                commit_time_ms,
                action_count,
                sql_count,
                max_depth,
                source_file,
                line_number
            FROM perf_traces
            ${whereClause}
            ORDER BY total_time_ms DESC, log_time DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(sql, [...params, pageSize, offset]);
        return { rows, total, totalTimeSum, maxTime, page, pageSize };
    }

    /**
     * ⚡ 获取单个请求的完整 Performance 调用树与归类汇总
     */
    async getPerformanceTree(traceId) {
        if (!traceId) return null;

        const traceRows = await this.query(`SELECT * FROM perf_traces WHERE trace_id = ? LIMIT 1`, [traceId]);
        const trace = traceRows[0] || null;

        const actions = await this.query(`
            SELECT 
                id,
                trace_id,
                node_id,
                parent_id,
                level,
                time_us,
                self_time_us,
                gap_time_us,
                time_ms,
                self_time_ms,
                gap_time_ms,
                action_name,
                action_category,
                sql_text,
                line_number,
                source_file
            FROM perf_actions
            WHERE trace_id = ?
            ORDER BY node_id ASC
        `, [traceId]);

        // 计算 Top 5 自耗时热点
        const topSelfHotspots = [...actions]
            .sort((a, b) => b.self_time_us - a.self_time_us)
            .slice(0, 5)
            .map(a => ({
                node_id: a.node_id,
                level: a.level,
                action_name: a.action_name,
                action_category: a.action_category,
                self_time_ms: a.self_time_ms,
                time_ms: a.time_ms,
                line_number: a.line_number,
                source_file: a.source_file
            }));

        return { trace, actions, topSelfHotspots };
    }

    /**
     * 概览统计 (增加 performance traces 统计)
     */
    async getTotalSummary() {
        const sql1 = `
            SELECT 
                COUNT(*) as total_sqls,
                COUNT(DISTINCT trace_id) as total_traces,
                COUNT(DISTINCT sql_template) as distinct_templates,
                COALESCE(SUM(exec_time_ms), 0) as total_exec_time_ms,
                COALESCE(MAX(exec_time_ms), 0) as max_exec_time_ms,
                COALESCE(AVG(exec_time_ms), 0) as avg_exec_time_ms
            FROM sqllogs
        `;
        const rows1 = await this.query(sql1);
        const data = rows1[0] || {};

        try {
            const perfCountRows = await this.query(`SELECT COUNT(*) as total_perf_traces FROM perf_traces`);
            data.total_perf_traces = perfCountRows[0] ? Number(perfCountRows[0].total_perf_traces) : 0;
        } catch (e) {
            data.total_perf_traces = 0;
        }

        return {
            total_sqls: Number(data.total_sqls || 0),
            total_traces: Number(data.total_traces || 0),
            total_perf_traces: Number(data.total_perf_traces || 0),
            distinct_templates: Number(data.distinct_templates || 0),
            total_exec_time_ms: Number(data.total_exec_time_ms || 0),
            max_exec_time_ms: Number(data.max_exec_time_ms || 0),
            avg_exec_time_ms: parseFloat(Number(data.avg_exec_time_ms || 0).toFixed(2))
        };
    }

    /**
     * 获取高频 SQL 模板排行榜 (支持全库关键词模糊搜索)
     */
    async getTopRepeated(page = 1, pageSize = 20, keyword = '') {
        let whereClause = "WHERE sql_template != ''";
        const params = [];

        if (keyword) {
            whereClause += ' AND sql_template ILIKE ?';
            params.push(`%${keyword}%`);
        }

        const statSql = `
            WITH grouped AS (
                SELECT 
                    sql_template,
                    COUNT(*) as count,
                    SUM(exec_time_ms) as total_time_ms,
                    MAX(exec_time_ms) as max_time_ms,
                    COUNT(DISTINCT trace_id) as trace_count
                FROM sqllogs
                ${whereClause}
                GROUP BY sql_template
            )
            SELECT 
                COUNT(*) as total_templates,
                COALESCE(SUM(count), 0) as total_sqls,
                COALESCE(SUM(total_time_ms), 0) as total_cost_ms,
                COALESCE(MAX(max_time_ms), 0) as max_cost_ms,
                COALESCE(SUM(trace_count), 0) as total_traces
            FROM grouped
        `;
        const statRows = await this.query(statSql, params);
        const total = statRows[0] ? Number(statRows[0].total_templates) : 0;
        const totalSqls = statRows[0] ? Number(statRows[0].total_sqls) : 0;
        const totalCostMs = statRows[0] ? Number(statRows[0].total_cost_ms) : 0;
        const maxCostMs = statRows[0] ? Number(statRows[0].max_cost_ms) : 0;
        const totalTraces = statRows[0] ? Number(statRows[0].total_traces) : 0;

        const offset = (page - 1) * pageSize;
        const sql = `
            SELECT 
                sql_template,
                COUNT(*) as count,
                SUM(exec_time_ms) as total_time_ms,
                AVG(exec_time_ms) as avg_time_ms,
                MAX(exec_time_ms) as max_time_ms,
                COUNT(DISTINCT trace_id) as trace_count
            FROM sqllogs
            ${whereClause}
            GROUP BY sql_template
            ORDER BY count DESC, total_time_ms DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(sql, [...params, pageSize, offset]);
        const mappedRows = rows.map(r => ({
            sql_template: r.sql_template,
            count: Number(r.count || 0),
            total_time_ms: Number(r.total_time_ms || 0),
            avg_time_ms: parseFloat(Number(r.avg_time_ms || 0).toFixed(2)),
            max_time_ms: Number(r.max_time_ms || 0),
            trace_count: Number(r.trace_count || 0)
        }));
        return { rows: mappedRows, total, totalSqls, totalCostMs, maxCostMs, totalTraces, page, pageSize };
    }

    /**
     * 获取慢 SQL 排行榜 (支持 TraceID 过滤、耗时阈值过滤、关键词搜索)
     */
    async getTopSlow(page = 1, pageSize = 20, traceId = '', minCostMs = 0, keyword = '') {
        let whereClause = 'WHERE 1=1';
        const params = [];

        if (traceId) {
            whereClause += ' AND trace_id = ?';
            params.push(traceId);
        }

        if (minCostMs > 0) {
            whereClause += ' AND exec_time_ms >= ?';
            params.push(minCostMs);
        }

        if (keyword) {
            whereClause += ' AND (full_sql ILIKE ? OR sql_template ILIKE ?)';
            params.push(`%${keyword}%`, `%${keyword}%`);
        }

        const statSql = `
            SELECT 
                COUNT(*) as total_sqls,
                COALESCE(SUM(exec_time_ms), 0) as total_cost_ms,
                COALESCE(MAX(exec_time_ms), 0) as max_cost_ms,
                COUNT(DISTINCT trace_id) as total_traces
            FROM sqllogs
            ${whereClause}
        `;
        const statRows = await this.query(statSql, params);
        const total = statRows[0] ? Number(statRows[0].total_sqls) : 0;
        const totalCostMs = statRows[0] ? Number(statRows[0].total_cost_ms) : 0;
        const maxCostMs = statRows[0] ? Number(statRows[0].max_cost_ms) : 0;
        const totalTraces = statRows[0] ? Number(statRows[0].total_traces) : 0;

        const offset = (page - 1) * pageSize;
        const sql = `
            SELECT 
                id,
                log_time,
                trace_id,
                thread_name,
                exec_time_ms,
                result_rows,
                db_manager,
                full_sql,
                line_number,
                source_file
            FROM sqllogs
            ${whereClause}
            ORDER BY exec_time_ms DESC, log_time DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(sql, [...params, pageSize, offset]);
        const mappedRows = rows.map(r => ({
            id: Number(r.id),
            log_time: r.log_time,
            trace_id: r.trace_id,
            thread_name: r.thread_name,
            exec_time_ms: Number(r.exec_time_ms || 0),
            result_rows: Number(r.result_rows || 0),
            db_manager: r.db_manager,
            full_sql: r.full_sql,
            line_number: Number(r.line_number || 0),
            source_file: r.source_file || ''
        }));
        return { rows: mappedRows, total, totalCostMs, maxCostMs, totalTraces, page, pageSize };
    }

    /**
     * 根据 TraceID 查询单个链路的全部执行序列 (支持无参全量返回与分页返回)
     */
    async getByTraceId(traceId, page = null, pageSize = 50) {
        if (page === null || page === undefined) {
            const sql = `
                SELECT 
                    id,
                    log_time,
                    trace_id,
                    thread_name,
                    exec_time_ms,
                    result_rows,
                    db_manager,
                    sql_template,
                    full_sql,
                    line_number,
                    source_file
                FROM sqllogs
                WHERE trace_id = ?
                ORDER BY log_time ASC, id ASC
            `;
            const rows = await this.query(sql, [traceId]);
            return rows.map(r => ({
                id: Number(r.id),
                log_time: r.log_time,
                trace_id: r.trace_id,
                thread_name: r.thread_name,
                exec_time_ms: Number(r.exec_time_ms || 0),
                result_rows: Number(r.result_rows || 0),
                db_manager: r.db_manager,
                sql_template: r.sql_template,
                full_sql: r.full_sql,
                line_number: Number(r.line_number || 0),
                source_file: r.source_file || ''
            }));
        }

        const countSql = `
            SELECT 
                COUNT(*) as total,
                COALESCE(SUM(exec_time_ms), 0) as total_time_ms,
                COALESCE(AVG(exec_time_ms), 0) as avg_time_ms,
                COALESCE(MAX(exec_time_ms), 0) as max_time_ms,
                COUNT(DISTINCT db_manager) as tx_count
            FROM sqllogs 
            WHERE trace_id = ?
        `;
        const countRows = await this.query(countSql, [traceId]);
        const total = countRows[0] ? Number(countRows[0].total) : 0;
        const totalTimeMs = countRows[0] ? Number(countRows[0].total_time_ms) : 0;
        const avgTimeMs = countRows[0] ? parseFloat(Number(countRows[0].avg_time_ms).toFixed(2)) : 0;
        const maxTimeMs = countRows[0] ? Number(countRows[0].max_time_ms) : 0;
        const txCount = countRows[0] ? Number(countRows[0].tx_count) : 0;

        const offset = (page - 1) * pageSize;
        const sql = `
            SELECT 
                id,
                log_time,
                trace_id,
                thread_name,
                exec_time_ms,
                result_rows,
                db_manager,
                sql_template,
                full_sql,
                line_number,
                source_file
            FROM sqllogs
            WHERE trace_id = ?
            ORDER BY log_time ASC, id ASC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(sql, [traceId, pageSize, offset]);
        const mappedRows = rows.map(r => ({
            id: Number(r.id),
            log_time: r.log_time,
            trace_id: r.trace_id,
            thread_name: r.thread_name,
            exec_time_ms: Number(r.exec_time_ms || 0),
            result_rows: Number(r.result_rows || 0),
            db_manager: r.db_manager,
            sql_template: r.sql_template,
            full_sql: r.full_sql,
            line_number: Number(r.line_number || 0),
            source_file: r.source_file || ''
        }));
        return { rows: mappedRows, total, totalTimeMs, totalCostMs: totalTimeMs, avgTimeMs, avgCostMs: avgTimeMs, maxTimeMs, txCount, page, pageSize };
    }

    /**
     * 根据 SQL 模板查询所有的调用实例明细 (支持 traceId + dbManager 联合精准过滤)
     */
    async getByTemplate(sqlTemplate, page = 1, pageSize = 50, traceId = '', dbManager = '') {
        let whereClause = 'WHERE sql_template = ?';
        const params = [sqlTemplate];

        if (traceId) {
            whereClause += ' AND trace_id = ?';
            params.push(traceId);
        }

        if (dbManager) {
            whereClause += ' AND db_manager = ?';
            params.push(dbManager);
        }

        const statSql = `
            SELECT 
                COUNT(*) as total,
                COALESCE(SUM(exec_time_ms), 0) as total_time_ms,
                COALESCE(AVG(exec_time_ms), 0) as avg_time_ms,
                COALESCE(MAX(exec_time_ms), 0) as max_time_ms,
                COUNT(DISTINCT trace_id) as total_traces
            FROM sqllogs 
            ${whereClause}
        `;
        const statRows = await this.query(statSql, params);
        const total = statRows[0] ? Number(statRows[0].total) : 0;
        const totalTimeMs = statRows[0] ? Number(statRows[0].total_time_ms) : 0;
        const avgTimeMs = statRows[0] ? parseFloat(Number(statRows[0].avg_time_ms).toFixed(2)) : 0;
        const maxTimeMs = statRows[0] ? Number(statRows[0].max_time_ms) : 0;
        const totalTraces = statRows[0] ? Number(statRows[0].total_traces) : 0;

        const offset = (page - 1) * pageSize;
        const sql = `
            SELECT 
                id,
                log_time,
                trace_id,
                thread_name,
                exec_time_ms,
                result_rows,
                db_manager,
                sql_template,
                full_sql,
                line_number,
                source_file
            FROM sqllogs
            ${whereClause}
            ORDER BY log_time ASC, id ASC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(sql, [...params, pageSize, offset]);
        const mappedRows = rows.map(r => ({
            id: Number(r.id),
            log_time: r.log_time,
            trace_id: r.trace_id,
            thread_name: r.thread_name,
            exec_time_ms: Number(r.exec_time_ms || 0),
            result_rows: Number(r.result_rows || 0),
            db_manager: r.db_manager,
            sql_template: r.sql_template,
            full_sql: r.full_sql,
            line_number: Number(r.line_number || 0),
            source_file: r.source_file || ''
        }));
        return { rows: mappedRows, total, totalSqls: total, totalCostMs: totalTimeMs, avgCostMs: avgTimeMs, avgTimeMs, maxCostMs: maxTimeMs, totalTraces, page, pageSize };
    }

    /**
     * 🌐 Trace 聚合大盘：按 TraceID 聚合分组，累计总耗时优先降序排列
     */
    async getTraceSummaryList(page = 1, pageSize = 20, keyword = '', minCostMs = 0) {
        let whereClause = "WHERE trace_id != '-'";
        const params = [];

        if (keyword) {
            whereClause += ' AND trace_id ILIKE ?';
            params.push(`%${keyword}%`);
        }

        const havingClause = minCostMs > 0 ? 'HAVING SUM(exec_time_ms) >= ?' : '';
        const havingParams = minCostMs > 0 ? [minCostMs] : [];

        const countSql = `
            WITH grouped AS (
                SELECT 
                    trace_id,
                    COUNT(*) as sql_count,
                    SUM(exec_time_ms) as total_time_ms,
                    MAX(exec_time_ms) as max_time_ms
                FROM sqllogs
                ${whereClause}
                GROUP BY trace_id
                ${havingClause}
            )
            SELECT 
                COUNT(*) as total_groups,
                COALESCE(SUM(sql_count), 0) as total_sqls,
                COALESCE(SUM(total_time_ms), 0) as total_cost_ms,
                COALESCE(MAX(max_time_ms), 0) as max_cost_ms
            FROM grouped
        `;
        const countRows = await this.query(countSql, [...params, ...havingParams]);
        const total = countRows[0] ? Number(countRows[0].total_groups) : 0;
        const totalSqls = countRows[0] ? Number(countRows[0].total_sqls) : 0;
        const totalCostMs = countRows[0] ? Number(countRows[0].total_cost_ms) : 0;
        const maxCostMs = countRows[0] ? Number(countRows[0].max_cost_ms) : 0;
        const totalTraces = total;

        const offset = (page - 1) * pageSize;
        const sql = `
            SELECT 
                trace_id,
                COUNT(*) as sql_count,
                SUM(exec_time_ms) as total_time_ms,
                AVG(exec_time_ms) as avg_time_ms,
                MAX(exec_time_ms) as max_time_ms,
                COUNT(DISTINCT db_manager) as tx_count,
                MIN(log_time) as first_log_time
            FROM sqllogs
            ${whereClause}
            GROUP BY trace_id
            ${havingClause}
            ORDER BY total_time_ms DESC, sql_count DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(sql, [...params, ...havingParams, pageSize, offset]);
        const mappedRows = rows.map(r => ({
            trace_id: r.trace_id,
            start_time: r.first_log_time,
            first_log_time: r.first_log_time,
            sql_count: Number(r.sql_count || 0),
            total_time_ms: Number(r.total_time_ms || 0),
            avg_time_ms: Number(r.avg_time_ms || 0),
            max_time_ms: Number(r.max_time_ms || 0),
            tx_count: Number(r.tx_count || 0)
        }));
        return { rows: mappedRows, total, totalSqls, totalCostMs, maxCostMs, totalTraces, page, pageSize };
    }

    /**
     * 💡 N+1 疑难诊断：基于 dbManager 事务句柄与 TraceID
     */
    async getDiagnostics(traceId = '', page = 1, pageSize = 20, minRepeatCount = 5, keyword = '') {
        let whereClause = "WHERE trace_id != '-' AND db_manager != '' AND LOWER(LTRIM(sql_template)) NOT LIKE 'update%'";
        const params = [];

        if (traceId) {
            whereClause += ' AND trace_id = ?';
            params.push(traceId);
        }

        if (keyword) {
            whereClause += ' AND sql_template ILIKE ?';
            params.push(`%${keyword}%`);
        }

        const statSql = `
            WITH diag_groups AS (
                SELECT 
                    trace_id,
                    db_manager,
                    sql_template,
                    COUNT(*) as repeat_count,
                    SUM(exec_time_ms) as total_time_ms,
                    MAX(exec_time_ms) as max_time_ms
                FROM sqllogs
                ${whereClause}
                GROUP BY trace_id, db_manager, sql_template
                HAVING COUNT(*) >= ?
            )
            SELECT 
                COUNT(*) as total_groups,
                COALESCE(SUM(repeat_count), 0) as total_sqls,
                COALESCE(SUM(total_time_ms), 0) as total_cost_ms,
                COALESCE(MAX(max_time_ms), 0) as max_cost_ms,
                COUNT(DISTINCT trace_id) as total_traces
            FROM diag_groups
        `;
        const statRows = await this.query(statSql, [...params, minRepeatCount]);
        const total = statRows[0] ? Number(statRows[0].total_groups) : 0;
        const totalSqls = statRows[0] ? Number(statRows[0].total_sqls) : 0;
        const totalCostMs = statRows[0] ? Number(statRows[0].total_cost_ms) : 0;
        const maxCostMs = statRows[0] ? Number(statRows[0].max_cost_ms) : 0;
        const totalTraces = statRows[0] ? Number(statRows[0].total_traces) : 0;

        const offset = (page - 1) * pageSize;
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
            HAVING COUNT(*) >= ?
            ORDER BY repeat_count DESC, total_time_ms DESC
            LIMIT ? OFFSET ?
        `;
        const rows = await this.query(sql, [...params, minRepeatCount, pageSize, offset]);
        return { rows, total, totalSqls, totalCostMs, maxCostMs, totalTraces, page, pageSize };
    }

    async close() {
        return new Promise((resolve) => {
            this.db.close(() => resolve());
        });
    }
}

module.exports = SqlLogDatabase;
