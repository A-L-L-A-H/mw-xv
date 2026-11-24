import fs from 'node:fs';
import path from 'node:path';
import pino, { type Logger, type LoggerOptions, type TransportTargetOptions } from 'pino';
import pretty from 'pino-pretty';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface CreateLoggerOptions {
  name?: string;
  level?: LogLevel;
  logDir?: string;
  logFileName?: string;
  enableFile?: boolean;
  enableConsole?: boolean;
  prettyPrint?: boolean;
  additionalTransports?: Array<{
    target: string;
    options?: Record<string, unknown>;
    level?: LogLevel;
  }>;
}

function serializeRequest(value: object): Record<string, unknown> {
  const request = value as Record<string, unknown>;
  const routeOptions = request.routeOptions;
  const routeTemplate =
    typeof routeOptions === 'object' &&
    routeOptions !== null &&
    !Array.isArray(routeOptions) &&
    typeof (routeOptions as Record<string, unknown>).url === 'string'
      ? (routeOptions as Record<string, string>).url
      : undefined;
  return {
    method: typeof request.method === 'string' ? request.method : undefined,
    url: routeTemplate ?? '[unmatched]',
  };
}

const SECRET_KEY_PATTERNS = [
  /^token$/i,
  /^secret$/i,
  /^apikey$/i,
  /^api_key$/i,
  /^api-key$/i,
  /^password$/i,
  /^passwd$/i,
  /^authorization$/i,
  /^cookie$/i,
  /^refresh_token$/i,
  /^access_token$/i,
  /^mw_ai_/i,
  /token$/i,
  /secret$/i,
  /api[-_]?key$/i,
  /password$/i,
  /authorization$/i,
];

const WILDCARD_SECRET_SUFFIXES = [
  'password',
  'refresh_token',
  'access_token',
  'secret',
  'token',
  'apikey',
  'api_key',
  'api-key',
  'authorization',
];

const MAX_REDACT_DEPTH = 8;

function isSecretKey(key: string): boolean {
  if (SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
    return true;
  }
  return WILDCARD_SECRET_SUFFIXES.some((suffix) => key.toLowerCase().endsWith(suffix.toLowerCase()));
}

function redactDeep(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) {
    return value;
  }
  try {
    if (value === null || value === undefined) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((v) => redactDeep(v, depth + 1));
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const redacted: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (isSecretKey(k)) {
          redacted[k] = '[redacted]';
        } else {
          redacted[k] = redactDeep(v, depth + 1);
        }
      }
      return redacted;
    }
    return value;
  } catch {
    return '[redacted]';
  }
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const isTest = process.env.NODE_ENV === 'test';
  const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

  const {
    name = 'moonwitness',
    level = (process.env.LOG_LEVEL as LogLevel) || (isTest ? 'silent' : 'info'),
    logDir = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs'),
    logFileName = process.env.LOG_FILE_NAME || `${name}.log`,
    enableFile = process.env.LOG_TO_FILE !== 'false' && !isTest,
    enableConsole = isTest ? false : true,
    prettyPrint = isDev,
    additionalTransports = [],
  } = options;

  if (level === 'silent') {
    return pino({ level: 'silent', name });
  }
  const streamLevel = level as pino.Level;

  const streams: pino.StreamEntry[] = [];

  // Console output (in-process, no worker thread)
  if (enableConsole) {
    streams.push({
      level: streamLevel,
      stream: prettyPrint
        ? pretty({
            colorize: true,
            translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
            ignore: 'pid,hostname',
            sync: true,
          })
        : process.stdout,
    });
  }

  // File output (enabled by default) — async non-blocking JSON lines
  let fileDestination: pino.DestinationStream | undefined;
  if (enableFile) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fileDestination = pino.destination({
        dest: path.resolve(logDir, logFileName),
        sync: false,
        mkdir: true,
      });
      streams.push({
        level: streamLevel,
        stream: fileDestination,
      });
    } catch {
      // Fail-safe: never crash the app because the log dir is not writable
    }
  }

  // Optional extra worker-based transports (e.g. Loki, Elasticsearch)
  if (additionalTransports.length > 0) {
    const targets: TransportTargetOptions[] = additionalTransports.map((t) => ({
      target: t.target,
      level: t.level || level,
      options: t.options || {},
    }));
    streams.push({ level: streamLevel, stream: pino.transport({ targets }) });
  }

  const pinoOptions: LoggerOptions = {
    name,
    level,
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: { req: serializeRequest },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'password',
        '*.password',
        'refresh_token',
        '*.refresh_token',
        'access_token',
        '*.access_token',
      ],
      censor: '[redacted]',
    },
    mixin: () => ({}),
  };

  const logger = streams.length > 0 ? pino(pinoOptions, pino.multistream(streams)) : pino(pinoOptions);

  const originalChild = logger.child.bind(logger);
  logger.child = function (bindings: Record<string, unknown>, options?: LoggerOptions) {
    const child = originalChild(bindings, options);
    const origInfo = child.info.bind(child);
    const origWarn = child.warn.bind(child);
    const origError = child.error.bind(child);
    const origDebug = child.debug.bind(child);
    const origFatal = child.fatal.bind(child);
    const origTrace = child.trace.bind(child);
    const wrap = (fn: Function) => (obj: unknown, msg?: string, ...args: unknown[]) => {
      const redacted = typeof obj === 'object' && obj !== null ? redactDeep(obj) : obj;
      return fn(redacted, msg, ...args);
    };
    child.info = wrap(origInfo);
    child.warn = wrap(origWarn);
    child.error = wrap(origError);
    child.debug = wrap(origDebug);
    child.fatal = wrap(origFatal);
    child.trace = wrap(origTrace);
    return child;
  };

  // Wrap root logger methods for deep redaction
  const origInfo = logger.info.bind(logger);
  const origWarn = logger.warn.bind(logger);
  const origError = logger.error.bind(logger);
  const origDebug = logger.debug.bind(logger);
  const origFatal = logger.fatal.bind(logger);
  const origTrace = logger.trace.bind(logger);
  const wrap = (fn: Function) => (obj: unknown, msg?: string, ...args: unknown[]) => {
    const redacted = typeof obj === 'object' && obj !== null ? redactDeep(obj) : obj;
    return fn(redacted, msg, ...args);
  };
  logger.info = wrap(origInfo);
  logger.warn = wrap(origWarn);
  logger.error = wrap(origError);
  logger.debug = wrap(origDebug);
  logger.fatal = wrap(origFatal);
  logger.trace = wrap(origTrace);

  // Attach flush methods to logger for per-instance flushing
  if (fileDestination) {
    (logger as Logger & { flush?: () => Promise<void>; flushSync?: () => void }).flush = () =>
      new Promise((resolve) => {
        if (typeof fileDestination.flush === 'function') {
          fileDestination.flush(() => resolve());
        } else {
          resolve();
        }
      });
    (logger as Logger & { flushSync?: () => void }).flushSync = () => {
      if (typeof fileDestination.flushSync === 'function') {
        fileDestination.flushSync();
      }
    };
  }

  return logger;
}

let rootLogger: Logger | undefined;
let rootFileDestination: pino.DestinationStream | undefined;

export function getLogger(): Logger {
  if (!rootLogger) {
    const isTest = process.env.NODE_ENV === 'test';
    const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    const name = 'moonwitness';
    const level = (process.env.LOG_LEVEL as LogLevel) || (isTest ? 'silent' : 'info');
    const logDir = process.env.LOG_DIR || path.resolve(process.cwd(), 'logs');
    const logFileName = process.env.LOG_FILE_NAME || `${name}.log`;
    const enableFile = process.env.LOG_TO_FILE !== 'false' && !isTest;
    const enableConsole = isTest ? false : true;
    const prettyPrint = isDev;

    const streamLevel = level as pino.Level;
    const streams: pino.StreamEntry[] = [];

    if (enableConsole) {
      streams.push({
        level: streamLevel,
        stream: prettyPrint
          ? pretty({
              colorize: true,
              translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
              ignore: 'pid,hostname',
              sync: true,
            })
          : process.stdout,
      });
    }

    if (enableFile) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        rootFileDestination = pino.destination({
          dest: path.resolve(logDir, logFileName),
          sync: false,
          mkdir: true,
        });
        streams.push({
          level: streamLevel,
          stream: rootFileDestination,
        });
      } catch {
        // Fail-safe
      }
    }

    const pinoOptions: LoggerOptions = {
      name,
      level,
      timestamp: pino.stdTimeFunctions.isoTime,
      serializers: { req: serializeRequest },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'password',
          '*.password',
          'refresh_token',
          '*.refresh_token',
          'access_token',
          '*.access_token',
        ],
        censor: '[redacted]',
      },
      mixin: () => ({}),
    };

    rootLogger = streams.length > 0 ? pino(pinoOptions, pino.multistream(streams)) : pino(pinoOptions);

    const originalChild = rootLogger.child.bind(rootLogger);
    rootLogger.child = function (bindings: Record<string, unknown>, options?: LoggerOptions) {
      const child = originalChild(bindings, options);
      const origInfo = child.info.bind(child);
      const origWarn = child.warn.bind(child);
      const origError = child.error.bind(child);
      const origDebug = child.debug.bind(child);
      const origFatal = child.fatal.bind(child);
      const origTrace = child.trace.bind(child);
      const wrap = (fn: Function) => (obj: unknown, msg?: string, ...args: unknown[]) => {
        const redacted = typeof obj === 'object' && obj !== null ? redactDeep(obj) : obj;
        return fn(redacted, msg, ...args);
      };
      child.info = wrap(origInfo);
      child.warn = wrap(origWarn);
      child.error = wrap(origError);
      child.debug = wrap(origDebug);
      child.fatal = wrap(origFatal);
      child.trace = wrap(origTrace);
      return child;
    };

    // Wrap root logger methods for deep redaction
    const origInfo = rootLogger.info.bind(rootLogger);
    const origWarn = rootLogger.warn.bind(rootLogger);
    const origError = rootLogger.error.bind(rootLogger);
    const origDebug = rootLogger.debug.bind(rootLogger);
    const origFatal = rootLogger.fatal.bind(rootLogger);
    const origTrace = rootLogger.trace.bind(rootLogger);
    const wrapRoot = (fn: Function) => (obj: unknown, msg?: string, ...args: unknown[]) => {
      const redacted = typeof obj === 'object' && obj !== null ? redactDeep(obj) : obj;
      return fn(redacted, msg, ...args);
    };
    rootLogger.info = wrapRoot(origInfo);
    rootLogger.warn = wrapRoot(origWarn);
    rootLogger.error = wrapRoot(origError);
    rootLogger.debug = wrapRoot(origDebug);
    rootLogger.fatal = wrapRoot(origFatal);
    rootLogger.trace = wrapRoot(origTrace);

    // Attach flush methods to rootLogger
    if (rootFileDestination) {
      (rootLogger as Logger & { flush?: () => Promise<void>; flushSync?: () => void }).flush = () =>
        new Promise((resolve) => {
          if (typeof rootFileDestination.flush === 'function') {
            rootFileDestination.flush(() => resolve());
          } else {
            resolve();
          }
        });
      (rootLogger as Logger & { flushSync?: () => void }).flushSync = () => {
        if (typeof rootFileDestination.flushSync === 'function') {
          rootFileDestination.flushSync();
        }
      };
    }
  }
  return rootLogger;
}

export function flushLogger(): Promise<void> {
  return new Promise((resolve) => {
    if (rootFileDestination && typeof rootFileDestination.flush === 'function') {
      rootFileDestination.flush(() => resolve());
    } else {
      resolve();
    }
  });
}

export function flushLoggerSync(): void {
  if (rootFileDestination && typeof rootFileDestination.flushSync === 'function') {
    rootFileDestination.flushSync();
  }
}

export { pino };
export type { Logger, LoggerOptions };
