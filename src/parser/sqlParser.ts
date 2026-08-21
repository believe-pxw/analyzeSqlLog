/**
 * 高性能解析时间耗时字符串 (如 "0ms", "3165ms/TimeCostLevel100ms200ms500ms1s2s", "1.5s/TimeCostLevel...")
 * 自动识别并截取 '/' 前面的真正耗时数值
 */
export function parseTimeToMs(timeStr: string): number {
  if (!timeStr) return 0;
  const slashIdx = timeStr.indexOf('/');
  const cleanStr = slashIdx !== -1 ? timeStr.substring(0, slashIdx).trim() : timeStr.trim();
  const val = parseFloat(cleanStr);
  if (isNaN(val)) return 0;
  if (cleanStr.endsWith('s') || cleanStr.endsWith('S')) {
    if (cleanStr.endsWith('ms') || cleanStr.endsWith('MS')) {
      return Math.round(val);
    }
    return Math.round(val * 1000);
  }
  if (cleanStr.endsWith('m') || cleanStr.endsWith('M')) {
    return Math.round(val * 60000);
  }
  return Math.round(val);
}

/**
 * 高性能清理 SQL 字符串中的 '>' 换行符前缀与包裹的结尾 ']'
 */
export function cleanSqlText(text: string): string {
  if (!text) return '';
  let str = text.replace(/(^|\n)\s*>\s*/g, '$1').trim();
  if (str.endsWith(']')) {
    str = str.replace(/\s*\]\s*$/, '').trim();
  }
  return str;
}

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
