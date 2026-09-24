import { cliux as ux, PrintOptions } from '@contentstack/cli-utilities';
import { existsSync } from 'node:fs';
import { normalize, resolve } from 'node:path';
import winston from 'winston';

export type LoggerType = 'info' | 'warn' | 'error' | 'debug';

const ansiRegexPattern = [
  '[\\u001B\\u009B][[\\]()#;?]*' +
    '(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
  '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
].join('|');

const customLevels = {
  levels: {
    warn: 1,
    info: 2,
    debug: 3,
  },
};

function isObject(value: unknown): value is object {
  return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function toText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return Object.is(value, -0) ? '-0' : String(value);
}

export class Logger {
  private infoLogger!: winston.Logger;
  private errorLogger!: winston.Logger;
  private config!: Record<string, any>;

  get loggerOptions(): winston.transports.FileTransportOptions {
    return {
      filename: '',
      maxFiles: 20,
      tailable: true,
      maxsize: 1000000,
    };
  }

  constructor(config: Record<string, any>) {
    this.config = config;
    this.infoLogger = this.getLoggerInstance('info');
    this.errorLogger = this.getLoggerInstance('error');
  }

  getLoggerInstance(logType: LoggerType): winston.Logger {
    const consoleOptions: winston.transports.ConsoleTransportOptions = {
      format: winston.format.combine(winston.format.simple(), winston.format.colorize({ all: true })),
    };

    if (logType === 'error') {
      consoleOptions.level = logType;
    }

    if (existsSync(this.config.projectBasePath)) {
      const filename = normalize(resolve(this.config.projectBasePath, 'logs', `${logType}.log`)).replace(
        /^(\.\.(\/|\\|$))+/,
        '',
      );
      const loggerOptions: winston.LoggerOptions = {
        transports: [
          new winston.transports.File({
            ...this.loggerOptions,
            level: logType,
            filename,
          }),
          new winston.transports.Console(consoleOptions),
        ],
        levels: customLevels.levels,
      };

      if (logType === 'error') {
        loggerOptions.levels = { error: 0 };
      }

      return winston.createLogger(loggerOptions);
    }

    winston
      .createLogger({
        transports: [new winston.transports.Console(consoleOptions)],
      })
      .error('Provided base path is not valid');
    process.exit(1);
  }

  log(message: string | any, logType?: LoggerType | PrintOptions | undefined): void {
    const logString = this.returnString(message);

    switch (logType) {
    case 'info':
    case 'debug':
    case 'warn':
      this.infoLogger.log(logType, logString);
      break;
    case 'error':
      this.errorLogger.error(logString);
      break;
    default:
      ux.print(logString, logType || {});
      break;
    }
  }

  returnString(message: any): string {
    let returnStr = '';

    const replaceCredentials = (item: any) => {
      try {
        return JSON.stringify(item).replace(/authtoken":"blt................/g, 'authtoken":"blt....');
      } catch {
        return item;
      }
    };

    if (Array.isArray(message) && message.length) {
      returnStr = message
        .map((item: any) => {
          if (item && typeof item === 'object') {
            return replaceCredentials(item);
          }

          return item;
        })
        .join('  ')
        .trim();
    } else if (isObject(message)) {
      return replaceCredentials(message);
    } else {
      returnStr = message;
    }

    returnStr = toText(returnStr).replace(new RegExp(ansiRegexPattern, 'g'), '').trim();

    return returnStr;
  }
}
