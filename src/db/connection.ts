import duckdb from 'duckdb';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { INIT_SCHEMA_SQL } from './schema';

export class DbConnection {
  private db: duckdb.Database;
  private conn: duckdb.Connection;
  private insertChain: Promise<any> = Promise.resolve();

  constructor(dbPath: string = ':memory:') {
    this.db = new duckdb.Database(dbPath);
    this.conn = this.db.connect();
  }

  public async initSchema(): Promise<void> {
    return this.query(INIT_SCHEMA_SQL);
  }

  public query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
      this.conn.all(sql, ...params, (err: Error | null, res: any[]) => {
        if (err) return reject(err);
        resolve(res as T[]);
      });
    });
  }

  public exec(sql: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.conn.exec(sql, (err: Error | null) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  public runSerial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.insertChain.then(fn, fn);
    this.insertChain = next;
    return next;
  }

  public close(): Promise<void> {
    return new Promise((resolve) => {
      try {
        this.conn.close(() => {
          this.db.close(() => {
            resolve();
          });
        });
      } catch (e) {
        resolve();
      }
    });
  }
}
