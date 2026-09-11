// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * bin/lib/logger.js
 * Structured logging utility for the NemoClaw CLI.
 * Uses winston for structured output with configurable log level.
 */

'use strict';

const winston = require('winston');
const chalk = require('chalk');

// ─── Level symbols ──────────────────────────────────────────────────────────
const LEVEL_SYMBOLS = {
  error: chalk.red('✖'),
  warn: chalk.yellow('⚠'),
  info: chalk.cyan('ℹ'),
  debug: chalk.gray('◆'),
};

// ─── Custom formatter for CLI-friendly output ────────────────────────────────
const cliFormat = winston.format.printf(({ level, message, timestamp }) => {
  const sym = LEVEL_SYMBOLS[level] || '·';
  const ts = process.env.LOG_TIMESTAMPS ? `${chalk.gray(timestamp)} ` : '';
  return `${ts}${sym} ${message}`;
});

// ─── Logger instance ─────────────────────────────────────────────────────────
const winstonLogger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    cliFormat
  ),
  transports: [
    new winston.transports.Console({
      silent: process.env.NEMOCLAW_SILENT === '1',
    }),
  ],
});

// Append file transport if LOG_FILE is set
if (process.env.LOG_FILE) {
  winstonLogger.add(
    new winston.transports.File({
      filename: process.env.LOG_FILE,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    })
  );
}

// ─── Public API ──────────────────────────────────────────────────────────────
const logger = {
  /**
   * Set the logging level at runtime.
   * @param {string} level - 'debug' | 'info' | 'warn' | 'error'
   */
  setLevel(level) {
    winstonLogger.level = level;
  },

  debug(msg) { winstonLogger.debug(msg); },
  info(msg) { winstonLogger.info(msg); },
  warn(msg) { winstonLogger.warn(msg); },
  error(msg) { winstonLogger.error(msg); },

  /**
   * Log a JSONL lifecycle event (for --events=jsonl mode).
   * @param {string} event - Event type
   * @param {object} data - Event payload
   */
  event(event, data = {}) {
    const payload = JSON.stringify({ event, timestamp: new Date().toISOString(), ...data });
    if (process.env.NEMOCLAW_JSONL_EVENTS === '1') {
      process.stdout.write(payload + '\n');
    } else {
      winstonLogger.debug(`[event] ${payload}`);
    }
  },
};

module.exports = logger;
