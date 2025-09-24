/**
 * Centralized logging utility for WritersRoom
 * Provides structured logging with levels and production filtering
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface LogContext {
  component?: string
  action?: string
  projectId?: string
  userId?: string
  [key: string]: any
}

class Logger {
  private level: LogLevel
  private isProduction: boolean

  constructor() {
    this.isProduction = process.env.NODE_ENV === 'production'
    this.level = this.isProduction ? LogLevel.WARN : LogLevel.DEBUG
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString()
    const levelName = LogLevel[level]
    const contextStr = context ? JSON.stringify(context) : ''

    return `[${timestamp}] ${levelName}: ${message} ${contextStr}`.trim()
  }

  private logToConsole(level: LogLevel, message: string, context?: LogContext) {
    if (!this.shouldLog(level)) return

    const formattedMessage = this.formatMessage(level, message, context)

    switch (level) {
      case LogLevel.DEBUG:
        console.log(formattedMessage)
        break
      case LogLevel.INFO:
        console.info(formattedMessage)
        break
      case LogLevel.WARN:
        console.warn(formattedMessage)
        break
      case LogLevel.ERROR:
        console.error(formattedMessage)
        break
    }
  }

  debug(message: string, context?: LogContext) {
    this.logToConsole(LogLevel.DEBUG, message, context)
  }

  info(message: string, context?: LogContext) {
    this.logToConsole(LogLevel.INFO, message, context)
  }

  warn(message: string, context?: LogContext) {
    this.logToConsole(LogLevel.WARN, message, context)
  }

  error(message: string, context?: LogContext, error?: Error) {
    const errorContext = error ? { ...context, error: error.message, stack: error.stack } : context
    this.logToConsole(LogLevel.ERROR, message, errorContext)
  }

  // Structured logging for common operations
  apiRequest(method: string, url: string, context?: LogContext) {
    this.debug(`API Request: ${method} ${url}`, { operation: 'api-request', ...context })
  }

  apiResponse(method: string, url: string, status: number, context?: LogContext) {
    const level = status >= 400 ? LogLevel.ERROR : LogLevel.DEBUG
    const message = `API Response: ${method} ${url} - ${status}`
    this.logToConsole(level, message, { operation: 'api-response', status, ...context })
  }

  fileUpload(filename: string, size: number, context?: LogContext) {
    this.info(`File upload: ${filename} (${size} bytes)`, { operation: 'file-upload', filename, size, ...context })
  }

  sceneLoad(projectId: string, sceneCount: number, context?: LogContext) {
    this.info(`Loaded scenes: ${sceneCount} scenes for project ${projectId}`, {
      operation: 'scene-load',
      projectId,
      sceneCount,
      ...context
    })
  }

  componentMount(componentName: string, context?: LogContext) {
    this.debug(`Component mounted: ${componentName}`, { operation: 'component-lifecycle', component: componentName, ...context })
  }

  componentError(componentName: string, error: Error, context?: LogContext) {
    this.error(`Component error: ${componentName}`, { operation: 'component-error', component: componentName, ...context }, error)
  }

  offlineMode(reason: string, context?: LogContext) {
    this.warn(`Offline mode activated: ${reason}`, { operation: 'offline-mode', reason, ...context })
  }
}

// Create singleton instance
const logger = new Logger()

// Export convenience functions for backward compatibility with existing console.log calls
export const log = {
  debug: (message: string, context?: LogContext) => logger.debug(message, context),
  info: (message: string, context?: LogContext) => logger.info(message, context),
  warn: (message: string, context?: LogContext) => logger.warn(message, context),
  error: (message: string, error?: Error, context?: LogContext) => logger.error(message, context, error),

  // Structured logging methods
  apiRequest: (method: string, url: string, context?: LogContext) => logger.apiRequest(method, url, context),
  apiResponse: (method: string, url: string, status: number, context?: LogContext) => logger.apiResponse(method, url, status, context),
  fileUpload: (filename: string, size: number, context?: LogContext) => logger.fileUpload(filename, size, context),
  sceneLoad: (projectId: string, sceneCount: number, context?: LogContext) => logger.sceneLoad(projectId, sceneCount, context),
  componentMount: (componentName: string, context?: LogContext) => logger.componentMount(componentName, context),
  componentError: (componentName: string, error: Error, context?: LogContext) => logger.componentError(componentName, error, context),
  offlineMode: (reason: string, context?: LogContext) => logger.offlineMode(reason, context),
}

export default logger