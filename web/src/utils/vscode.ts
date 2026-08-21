/**
 * 通过 vscode://file/ 协议唤起本地 VSCode 并高亮跳转到指定文件的行号
 * 若为 .gz 压缩文件，先请求后端解压并获取临时文件路径
 */
export async function openInVsCode(sourceFile: string, lineNumber: number, onNotify?: (msg: string) => void): Promise<void> {
  if (!sourceFile) return;

  try {
    let targetPath = sourceFile;

    if (sourceFile.endsWith('.gz')) {
      if (onNotify) onNotify('正在解压 .gz 日志以进行 VSCode 定位...');
      const res = await fetch(`/api/decompress-gz?filePath=${encodeURIComponent(sourceFile)}`);
      const json = await res.json();
      if (json.success && json.decompressedPath) {
        targetPath = json.decompressedPath;
      }
    }

    // 标准化 Windows / POSIX 路径
    const normalized = targetPath.replace(/\\/g, '/');
    const vscodeUrl = `vscode://file/${normalized}:${lineNumber || 1}`;

    if (onNotify) {
      const fileName = targetPath.split(/[\\/]/).pop();
      onNotify(`正在唤起 VSCode 定位: ${fileName}:${lineNumber || 1}`);
    }

    window.location.href = vscodeUrl;
  } catch (err: any) {
    if (onNotify) onNotify(`唤起 VSCode 失败: ${err.message || String(err)}`);
  }
}

/**
 * 简化事务连接名 (去除冗长包名前缀)
 * 例如: com.bokesoft.yes.mid.connection.dbmanager.GeneralDBManager@7b2aa7e0 -> GeneralDBManager@7b2aa7e0
 */
export function formatDbManager(dbManager: string): string {
  if (!dbManager) return '-';
  const prefix = 'com.bokesoft.yes.mid.connection.dbmanager.';
  if (dbManager.startsWith(prefix)) {
    return dbManager.substring(prefix.length);
  }
  return dbManager;
}

/**
 * 格式化文件名与行号
 */
export function formatSourceLabel(sourceFile: string, lineNumber: number): string {
  if (!sourceFile) return '-';
  const base = sourceFile.split(/[\\/]/).pop();
  return `${base}:${lineNumber || 1}`;
}
