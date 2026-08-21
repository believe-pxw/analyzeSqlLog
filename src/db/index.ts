import { DbConnection } from './connection';
import { SqlDao } from './sqlDao';
import { PerfDao } from './perfDao';
import { AppLogDao } from './appLogDao';
import { SqlRecord, SqlSummary, DiagnosticsItem, TraceSummaryItem } from '../types/sql';
import { PerfTraceRow, PerfTreeData } from '../types/perf';
import { AppLogRecord } from '../types/log';

export class SqlLogDatabase {
  private db: DbConnection;
  private sqlDao: SqlDao;
  private perfDao: PerfDao;
  private appLogDao: AppLogDao;

  constructor(dbPath: string = ':memory:') {
    this.db = new DbConnection(dbPath);
    this.sqlDao = new SqlDao(this.db);
    this.perfDao = new PerfDao(this.db);
    this.appLogDao = new AppLogDao(this.db);
  }

  public async initSchema(): Promise<void> {
    return this.db.initSchema();
  }

  public query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.db.query<T>(sql, params);
  }

  // SQL 相关
  public async insertBatch(records: SqlRecord[]): Promise<void> {
    return this.sqlDao.insertBatch(records);
  }

  public async getTotalSummary() {
    return this.sqlDao.getTotalSummary();
  }

  public async getTopRepeated(page = 1, pageSize = 20, keyword = '') {
    return this.sqlDao.getTopRepeated(page, pageSize, keyword);
  }

  public async getTopSlow(page = 1, pageSize = 20, traceId = '', minCostMs = 0, keyword = '') {
    return this.sqlDao.getTopSlow(page, pageSize, traceId, minCostMs, keyword);
  }

  public async getDiagnostics(traceId = '', page = 1, pageSize = 20, minRepeatCount = 5, keyword = '') {
    return this.sqlDao.getDiagnostics(traceId, page, pageSize, minRepeatCount, keyword);
  }

  public async getTraceSummaryList(page = 1, pageSize = 20, keyword = '', minCostMs = 0) {
    return this.sqlDao.getTraceSummaryList(page, pageSize, keyword, minCostMs);
  }

  public async getTrace(traceId: string, page = 1, pageSize = 50) {
    return this.sqlDao.getTrace(traceId, page, pageSize);
  }

  public async getByTemplate(sqlTemplate: string, page = 1, pageSize = 50, traceId = '', dbManager = '') {
    return this.sqlDao.getByTemplate(sqlTemplate, page, pageSize, traceId, dbManager);
  }

  // Performance 相关
  public async insertPerfBatch(perfTraceList: { trace: any; actions: any[] }[]): Promise<void> {
    return this.perfDao.insertPerfBatch(perfTraceList);
  }

  public async getPerformanceTraceList(page = 1, pageSize = 20, keyword = '', minCostMs = 0, serviceName = '') {
    return this.perfDao.getPerformanceTraceList(page, pageSize, keyword, minCostMs, serviceName);
  }

  public async getPerformanceTree(traceId: string) {
    return this.perfDao.getPerformanceTree(traceId);
  }

  // AppLog 相关
  public async insertAppLogsBatch(records: AppLogRecord[]): Promise<void> {
    return this.appLogDao.insertAppLogsBatch(records);
  }

  public async getAppLogs(page = 1, pageSize = 50, filters = {}) {
    return this.appLogDao.getAppLogs(page, pageSize, filters);
  }

  public async close(): Promise<void> {
    return this.db.close();
  }
}

export * from './connection';
export * from './schema';
export * from './sqlDao';
export * from './perfDao';
export * from './appLogDao';
export default SqlLogDatabase;
