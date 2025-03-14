// logger.js - 统一的日志控制系统

// 日志级别定义
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 100  // 关闭所有日志
};

// 当前日志级别 - 修改这里来控制日志输出
const CURRENT_LOG_LEVEL = LOG_LEVELS.ERROR;

// 日志函数
const logger = {
    debug: function(...args) {
        if (CURRENT_LOG_LEVEL <= LOG_LEVELS.DEBUG) {
            console.log('[DEBUG]', ...args);
        }
    },
    
    info: function(...args) {
        if (CURRENT_LOG_LEVEL <= LOG_LEVELS.INFO) {
            console.log('[INFO]', ...args);
        }
    },
    
    warn: function(...args) {
        if (CURRENT_LOG_LEVEL <= LOG_LEVELS.WARN) {
            console.warn('[WARN]', ...args);
        }
    },
    
    error: function(...args) {
        if (CURRENT_LOG_LEVEL <= LOG_LEVELS.ERROR) {
            console.error('[ERROR]', ...args);
        }
    }
};

// 导出日志工具
window.logger = logger; 