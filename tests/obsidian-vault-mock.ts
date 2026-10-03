export class TFile {
  constructor(public path: string) {}
}

export class TFolder {
  constructor(public path: string) {}
}

export function normalizePath(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/+/gu, "/").replace(/^\//u, "").replace(/\/$/u, "");
}
