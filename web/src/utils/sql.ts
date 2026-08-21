/**
 * 高性能将 select 语句中超过 5 个字段的冗长列名列表压缩折叠为 `select ... from`
 */
export function compressSqlColumns(sql: string): string {
  if (!sql) return '';
  const selectMatch = sql.match(/^(\s*select\s+)([\s\S]+?)(\s+from\s+[\s\S]+)$/i);
  if (!selectMatch) return sql;

  const prefix = selectMatch[1];
  const columnsStr = selectMatch[2].trim();
  const suffix = selectMatch[3];

  // 如果包含嵌套括号，为了安全不进行激进折叠
  if (columnsStr.includes('(') || columnsStr.includes(')')) {
    return sql;
  }

  const cols = columnsStr.split(',');
  if (cols.length > 5) {
    return `${prefix}...${suffix}`;
  }
  return sql;
}
