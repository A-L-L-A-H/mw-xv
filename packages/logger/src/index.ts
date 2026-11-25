import fs from 'node:fs';
import path from 'node:path';
import pino, {
  type Logger,
  type LoggerOptions,
  type TransportTargetOptions,
  type DestinationStream,
} from 'pino';
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
  return WILDCARD_SECRET_SUFFIXES.some((suffix) =>
    key.toLowerCase().endsWith(suffix.toLowerCase())
  );
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
        if (k === 'req' && v !== null && typeof v === 'object' && 'routeOptions' in v) {
          redacted[k] = v;
          continue;
        }
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

interface FlushableDestination {
  flush?: (cb?: () => void) => void;
  flushSync?: () => void;
}

type FlushableLogger = Logger & { flush?: () => Promise<void>; flushSync?: () => void };

type ChildFn = (bindings: Record<string, unknown>, options?: LoggerOptions) => Logger;

function toFlushableDestination(destination: DestinationStream): FlushableDestination {
  return destination as unknown as FlushableDestination;
}

function wrapLoggerMethods<L extends Logger>(log: L): L {
  const origInfo = log.info.bind(log);
  const origWarn = log.warn.bind(log);
  const origError = log.error.bind(log);
  const origDebug = log.debug.bind(log);
  const origFatal = log.fatal.bind(log);
  const origTrace = log.trace.bind(log);
  const wrap =
    (fn: (obj: unknown, msg?: string, ...args: unknown[]) => void) =>
    (obj: unknown, msg?: string, ...args: unknown[]) => {
      const redacted = typeof obj === 'object' && obj !== null ? redactDeep(obj) : obj;
      return fn(redacted, msg, ...args);
    };
  log.info = wrap(origInfo);
  log.warn = wrap(origWarn);
  log.error = wrap(origError);
  log.debug = wrap(origDebug);
  log.fatal = wrap(origFatal);
  log.trace = wrap(origTrace);
  return log;
}

function attachFlushMethods<L extends Logger>(
  log: L,
  destination: DestinationStream | undefined
): L {
  if (!destination) return log;
  const dest = toFlushableDestination(destination);
  const flushable = log as FlushableLogger;
  flushable.flush = () =>
    new Promise<void>((resolve) => {
      if (typeof dest.flush === 'function') {
        dest.flush(() => resolve());
      } else {
        resolve();
      }
    });
  flushable.flushSync = () => {
    if (typeof dest.flushSync === 'function') {
      dest.flushSync();
    }
  };
  return log;
}

function createChildWrapper(originalChild: Logger['child']): ChildFn {
  return function (bindings: Record<string, unknown>, options?: LoggerOptions) {
    const child = originalChild(bindings as never, options as never);
    return wrapLoggerMethods(child);
  };
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
  // In test mode, use sync destination so flush() / flushSync() reliably persist logs
  let fileDestination: DestinationStream | undefined;
  if (enableFile) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fileDestination = pino.destination({
        dest: path.resolve(logDir, logFileName),
        sync: isTest,
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

  const logger =
    streams.length > 0 ? pino(pinoOptions, pino.multistream(streams)) : pino(pinoOptions);

  // Wrap child method
  (logger as unknown as { child: ChildFn }).child = createChildWrapper(logger.child.bind(logger));

  // Wrap root logger methods for deep redaction
  wrapLoggerMethods(logger);

  // Attach flush methods to logger for per-instance flushing
  attachFlushMethods(logger, fileDestination);

  return logger;
}

let rootLogger: Logger | undefined;
let rootFileDestination: DestinationStream | undefined;

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
          sync: isTest,
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

    rootLogger =
      streams.length > 0 ? pino(pinoOptions, pino.multistream(streams)) : pino(pinoOptions);

    // Wrap child method
    (rootLogger as unknown as { child: ChildFn }).child = createChildWrapper(
      rootLogger.child.bind(rootLogger)
    );

    // Wrap root logger methods for deep redaction
    wrapLoggerMethods(rootLogger);

    // Attach flush methods to rootLogger
    attachFlushMethods(rootLogger, rootFileDestination);
  }
  return rootLogger;
}

export function flushLogger(): Promise<void> {
  return new Promise((resolve) => {
    if (rootFileDestination) {
      const dest = toFlushableDestination(rootFileDestination);
      if (typeof dest.flush === 'function') {
        dest.flush(() => resolve());
        return;
      }
    }
    resolve();
  });
}

export function flushLoggerSync(): void {
  if (rootFileDestination) {
    const dest = toFlushableDestination(rootFileDestination);
    if (typeof dest.flushSync === 'function') {
      dest.flushSync();
    }
  }
}

export { pino };
export type { Logger, LoggerOptions };
