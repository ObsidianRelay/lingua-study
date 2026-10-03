/** 同时处理单文件和文件夹移动；不改动前缀相似的无关路径。 */
export function replaceRenamedPath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`;
  return path;
}
