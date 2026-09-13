export interface Logger {
  error(message: string, error?: unknown): void;
  warn(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  debug(message: string, context?: unknown): void;
}

function formatMessage(level: string, message: string, context?: unknown): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] ${level}: ${message}`;
  return context !== undefined ? `${base} ${JSON.stringify(context)}` : base;
}

function shouldLog(level: 'error' | 'warn' | 'info' | 'debug'): boolean {
  if (process.env.NODE_ENV === 'test') return false;

  const logLevel = process.env.LOG_LEVEL || 'info';
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  return levels[level] <= levels[logLevel as keyof typeof levels];
}

export const logger: Logger = {
  error(message: string, error?: unknown): void {
    if (!shouldLog('error')) return;
    if (error instanceof Error) {
      console.error(formatMessage('ERROR', message), error);
    } else if (error !== undefined) {
      console.error(formatMessage('ERROR', message, error));
    } else {
      console.error(formatMessage('ERROR', message));
    }
  },

  warn(message: string, context?: unknown): void {
    if (!shouldLog('warn')) return;
    console.warn(formatMessage('WARN', message, context));
  },

  info(message: string, context?: unknown): void {
    if (!shouldLog('info')) return;
    console.log(formatMessage('INFO', message, context));
  },

  debug(message: string, context?: unknown): void {
    if (!shouldLog('debug')) return;
    console.log(formatMessage('DEBUG', message, context));
  },
};
