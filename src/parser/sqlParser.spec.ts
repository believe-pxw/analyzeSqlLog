import { describe, it, expect } from 'vitest';
import { parseTimeToMs, cleanSqlText, compressSqlColumns } from './sqlParser';

describe('SQL Parser Helpers Specs', () => {
  it('parseTimeToMs 应当精确转换各种时间字符串为毫秒', () => {
    expect(parseTimeToMs('0ms')).toBe(0);
    expect(parseTimeToMs('15ms')).toBe(15);
    expect(parseTimeToMs('1.5s')).toBe(1500);
    expect(parseTimeToMs('2m')).toBe(120000);
    expect(parseTimeToMs('3165ms/TimeCostLevel100ms200ms500ms1s2s')).toBe(3165);
    expect(parseTimeToMs('2.4s/TimeCostLevel...')).toBe(2400);
    expect(parseTimeToMs('')).toBe(0);
    expect(parseTimeToMs('invalid')).toBe(0);
  });

  it('cleanSqlText 应当去除换行 > 前缀与结尾 ] 符号', () => {
    const raw = '> select * from users\n> where id = 1 ]';
    expect(cleanSqlText(raw)).toBe('select * from users\nwhere id = 1');
  });

  it('compressSqlColumns 应当将超过 5 个列名的 select 语句折叠为 select ... from', () => {
    const longSql = 'SELECT id, name, age, gender, email, phone, created_at FROM users WHERE status = 1';
    expect(compressSqlColumns(longSql)).toBe('SELECT ... FROM users WHERE status = 1');

    const shortSql = 'SELECT id, name, age FROM users';
    expect(compressSqlColumns(shortSql)).toBe('SELECT id, name, age FROM users');
  });
});
