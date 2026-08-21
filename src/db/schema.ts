/**
 * DuckDB 表结构与索引定义
 */
export const INIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sqllogs (
    id INTEGER,
    log_time VARCHAR,
    nano_time VARCHAR,
    level VARCHAR,
    service_name VARCHAR,
    instance_name VARCHAR,
    ip_address VARCHAR,
    host_name VARCHAR,
    trace_id VARCHAR,
    span_id VARCHAR,
    parent_span_id VARCHAR,
    thread_name VARCHAR,
    logger_name VARCHAR,
    exec_time_ms DOUBLE,
    result_rows INTEGER,
    db_manager VARCHAR,
    sql_template VARCHAR,
    sql_params VARCHAR,
    full_sql VARCHAR,
    line_number INTEGER,
    source_file VARCHAR
);

CREATE TABLE IF NOT EXISTS perf_traces (
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
    action_count INTEGER,
    sql_count INTEGER,
    max_depth INTEGER,
    source_file VARCHAR,
    line_number INTEGER
);

CREATE TABLE IF NOT EXISTS perf_actions (
    trace_id VARCHAR,
    node_id INTEGER,
    parent_id INTEGER,
    level INTEGER,
    action_name VARCHAR,
    time_ms DOUBLE,
    self_time_ms DOUBLE,
    gap_time_ms DOUBLE,
    action_category VARCHAR,
    sql_text VARCHAR,
    line_number INTEGER,
    source_file VARCHAR
);

CREATE TABLE IF NOT EXISTS app_logs (
    id INTEGER,
    log_time VARCHAR,
    nano_time VARCHAR,
    level VARCHAR,
    service_name VARCHAR,
    instance_name VARCHAR,
    ip_address VARCHAR,
    host_name VARCHAR,
    trace_id VARCHAR,
    span_id VARCHAR,
    parent_span_id VARCHAR,
    thread_name VARCHAR,
    logger_name VARCHAR,
    message VARCHAR,
    line_number INTEGER,
    source_file VARCHAR
);

CREATE INDEX IF NOT EXISTS idx_sqllogs_trace_id ON sqllogs(trace_id);
CREATE INDEX IF NOT EXISTS idx_sqllogs_exec_time ON sqllogs(exec_time_ms);
CREATE INDEX IF NOT EXISTS idx_perf_actions_trace ON perf_actions(trace_id);
CREATE INDEX IF NOT EXISTS idx_app_logs_trace_id ON app_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_app_logs_span_id ON app_logs(span_id);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);
`;
