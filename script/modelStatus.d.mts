// script/modelStatus.d.mts
//
// modelStatus.mjs 的类型声明（无 allowJs，src/ 下的 TS 模块经此消费过期登记表）。

export interface ExpiredModelEntry {
  version: string;
  file: string;
  expiredAt: string;
  reason: string;
  evidence: string | null;
}

export interface ModelStatusTable {
  entries: ExpiredModelEntry[];
  note: string | null;
  file?: string;
}

export declare const SCRIPT_DIR: string;
export declare const PROJECT_DIR: string;
export declare const DEFAULT_STATUS_FILE: string;
export declare const MODEL_VERSION_RE: RegExp;

export declare function versionOfModelFile(fileName: string): string | null;
export declare function parseModelStatus(text: string, source?: string): ModelStatusTable;
export declare function loadModelStatus(file?: string): ModelStatusTable;
export declare function expiredByVersion(file?: string): Map<string, ExpiredModelEntry>;
export declare function isExpiredModel(nameOrVersion: string, entries?: ExpiredModelEntry[]): boolean;
