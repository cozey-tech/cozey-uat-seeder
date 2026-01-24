/**
 * Color utility with support for --no-color flag
 * Uses chalk for terminal colors
 */

import chalk from "chalk";

let colorsEnabled = true;

/**
 * Set whether colors are enabled globally
 */
export function setColorsEnabled(enabled: boolean): void {
  colorsEnabled = enabled;
}

/**
 * Get whether colors are currently enabled
 */
export function areColorsEnabled(): boolean {
  return colorsEnabled;
}

/**
 * Color functions that respect the global color setting
 */
export const colors = {
  // Status colors
  success: (text: string): string => (colorsEnabled ? chalk.green(text) : text),
  error: (text: string): string => (colorsEnabled ? chalk.red(text) : text),
  warning: (text: string): string => (colorsEnabled ? chalk.yellow(text) : text),
  info: (text: string): string => (colorsEnabled ? chalk.blue(text) : text),

  // Emphasis
  bold: (text: string): string => (colorsEnabled ? chalk.bold(text) : text),
  dim: (text: string): string => (colorsEnabled ? chalk.dim(text) : text),

  // UI elements
  header: (text: string): string => (colorsEnabled ? chalk.cyan.bold(text) : text),
  key: (text: string): string => (colorsEnabled ? chalk.cyan(text) : text),
  value: (text: string): string => (colorsEnabled ? chalk.white(text) : text),

  // Semantic colors
  count: (text: string | number): string => (colorsEnabled ? chalk.magenta(String(text)) : String(text)),
  code: (text: string): string => (colorsEnabled ? chalk.gray(text) : text),
};
