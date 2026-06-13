// src/engine/result.ts
import type { ApiErrorCode } from '../types.js';

export type Result<T = void> =
  | { ok: true; data?: T }
  | { ok: false; code: ApiErrorCode; message: string };
