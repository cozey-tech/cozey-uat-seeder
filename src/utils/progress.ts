/**
 * Progress tracking utility with time estimation and spinner support for CLI operations.
 */

import ora, { type Ora } from "ora";

export interface ProgressOptions {
  /**
   * Whether to show a spinner (default: true)
   */
  showSpinner?: boolean;
  /**
   * Whether to show time estimates (default: true)
   */
  showTimeEstimate?: boolean;
  formatMessage?: (current: number, total: number, message?: string) => string;
}

/**
 * Progress tracker for multi-step operations
 *
 * Tracks progress through operations, estimates time remaining,
 * and provides visual feedback via spinner.
 */
export class ProgressTracker {
  private spinner: Ora | null = null;
  private startTime: number = 0;
  private current: number = 0;
  private total: number = 0;
  private operation: string = "";
  private showSpinner: boolean;
  private showTimeEstimate: boolean;
  private formatMessage: (current: number, total: number, message?: string) => string;
  private operationTimes: number[] = [];

  constructor(options: ProgressOptions = {}) {
    this.showSpinner = options.showSpinner !== false;
    this.showTimeEstimate = options.showTimeEstimate !== false;
    this.formatMessage =
      options.formatMessage ||
      ((current: number, total: number, message?: string): string => {
        const base = `${current}/${total}`;
        const messagePart = message ? ` - ${message}` : "";
        return `${base}${messagePart}`;
      });
  }

  /**
   * Start tracking progress for an operation
   * @param operation - Name of the operation (e.g., "Seeding Shopify orders")
   * @param total - Total number of items/steps to process
   */
  start(operation: string, total: number): void {
    this.operation = operation;
    this.total = total;
    this.current = 0;
    this.startTime = Date.now();
    this.operationTimes = [];

    if (this.showSpinner) {
      this.spinner = ora({
        text: this.getProgressText(),
        spinner: "dots",
        color: "cyan",
      }).start();
    } else {
      console.log(`${operation} (0/${total})`);
    }
  }

  /**
   * Update progress
   * @param current - Current progress (1-based)
   * @param message - Optional message to display
   */
  update(current: number, message?: string): void {
    if (current < 1 || current > this.total) {
      throw new Error(`Progress current (${current}) must be between 1 and ${this.total}`);
    }

    const previousCurrent = this.current;
    this.current = current;

    // Track time for this operation if we've made progress
    if (previousCurrent > 0) {
      const elapsed = Date.now() - this.startTime;
      const timePerItem = elapsed / previousCurrent;
      this.operationTimes.push(timePerItem);
    }

    const text = this.getProgressText(message);

    if (this.spinner) {
      this.spinner.text = text;
    } else {
      // For non-spinner mode, update the line
      process.stdout.write(`\r${text}`);
    }
  }

  /**
   * Mark progress as complete
   * @param message - Optional completion message
   */
  complete(message?: string): void {
    const elapsed = Date.now() - this.startTime;
    const finalMessage = message || `${this.operation} complete`;

    if (this.spinner) {
      this.spinner.succeed(`${finalMessage} (${this.formatDuration(elapsed)})`);
      this.spinner = null;
    } else {
      console.log(`\n${finalMessage} (${this.formatDuration(elapsed)})`);
    }

    // Reset state
    this.current = 0;
    this.total = 0;
    this.operation = "";
    this.startTime = 0;
    this.operationTimes = [];
  }

  /**
   * Mark progress as failed
   * @param message - Optional error message
   */
  fail(message?: string): void {
    const errorMessage = message || `${this.operation} failed`;

    if (this.spinner) {
      this.spinner.fail(errorMessage);
      this.spinner = null;
    } else {
      console.error(`\n${errorMessage}`);
    }

    // Reset state
    this.current = 0;
    this.total = 0;
    this.operation = "";
    this.startTime = 0;
    this.operationTimes = [];
  }

  /**
   * Get current progress text
   */
  private getProgressText(message?: string): string {
    const percentage = this.total > 0 ? Math.round((this.current / this.total) * 100) : 0;
    const percentageText = `${percentage}%`;

    // Create a visual progress bar
    const barLength = 20;
    const filled = Math.round((this.current / this.total) * barLength);
    const empty = barLength - filled;
    const progressBar = `[${"█".repeat(filled)}${"░".repeat(empty)}]`;

    let timeEstimate = "";
    if (this.showTimeEstimate && this.current > 0 && this.total > this.current) {
      const remaining = this.estimateTimeRemaining();
      if (remaining) {
        timeEstimate = ` ~${remaining} remaining`;
      }
    }

    const messagePart = message ? ` ${message}` : "";
    return `${this.operation} ${progressBar} ${percentageText}${messagePart}${timeEstimate}`;
  }

  /**
   * Estimate time remaining based on average time per item
   * @returns Formatted time estimate string or empty string if not enough data
   */
  estimateTimeRemaining(): string {
    if (this.current === 0 || this.total === 0 || this.operationTimes.length === 0) {
      return "";
    }

    // Use average of last 5 operations for more accurate estimate
    const recentTimes = this.operationTimes.slice(-5);
    const avgTimePerItem = recentTimes.reduce((sum, time) => sum + time, 0) / recentTimes.length;
    const remainingItems = this.total - this.current;
    const estimatedMs = avgTimePerItem * remainingItems;

    return this.formatDuration(estimatedMs);
  }

  /**
   * Format duration in milliseconds to human-readable string
   * @param ms - Duration in milliseconds
   * @returns Formatted string (e.g., "2m 30s", "45s")
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }

    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes < 60) {
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  /**
   * Get current progress percentage (0-100)
   */
  getPercentage(): number {
    if (this.total === 0) {
      return 0;
    }
    return Math.round((this.current / this.total) * 100);
  }

  /**
   * Get elapsed time in milliseconds
   */
  getElapsedTime(): number {
    if (this.startTime === 0) {
      return 0;
    }
    return Date.now() - this.startTime;
  }
}
