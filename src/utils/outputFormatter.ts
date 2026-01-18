/**
 * Output formatting utility for consistent CLI output
 *
 * Provides standardized formatting for separators, spacing, emoji usage,
 * progress messages, and summaries across both CLI tools.
 */

export interface SeparatorOptions {
  /**
   * Character to use for separator (default: "━")
   */
  character?: string;
  /**
   * Length of separator (default: 50)
   */
  length?: number;
}

export interface SummaryOptions {
  /**
   * Title for the summary
   */
  title: string;
  /**
   * Items to display in summary
   */
  items: Array<{ label: string; value: string | number }>;
  /**
   * Whether to show a separator after (default: true)
   */
  showSeparator?: boolean;
}

/**
 * Output formatter for consistent CLI output
 */
export class OutputFormatter {
  private static readonly DEFAULT_SEPARATOR_LENGTH = 50;
  private static readonly DEFAULT_SEPARATOR_CHAR = "━";

  /**
   * Create a separator line
   * @param options - Separator options
   * @returns Separator string
   */
  static separator(options: SeparatorOptions = {}): string {
    const char = options.character || this.DEFAULT_SEPARATOR_CHAR;
    const length = options.length || this.DEFAULT_SEPARATOR_LENGTH;
    return char.repeat(length);
  }

  /**
   * Format a section header
   * @param text - Header text
   * @param emoji - Optional emoji prefix
   * @returns Formatted header
   */
  static header(text: string, emoji?: string): string {
    const prefix = emoji ? `${emoji} ` : "";
    return `${prefix}${text}`;
  }

  /**
   * Format a success message
   * @param message - Success message
   * @returns Formatted success message
   */
  static success(message: string): string {
    return `✅ ${message}`;
  }

  /**
   * Format an error message
   * @param message - Error message
   * @returns Formatted error message
   */
  static error(message: string): string {
    return `❌ ${message}`;
  }

  /**
   * Format a warning message
   * @param message - Warning message
   * @returns Formatted warning message
   */
  static warning(message: string): string {
    return `⚠️  ${message}`;
  }

  /**
   * Format an info message
   * @param message - Info message
   * @returns Formatted info message
   */
  static info(message: string): string {
    return `ℹ️  ${message}`;
  }

  /**
   * Format a progress message
   * @param current - Current step/item number (1-based)
   * @param total - Total steps/items
   * @param operation - Operation description
   * @param details - Optional additional details
   * @returns Formatted progress message
   */
  static progress(current: number, total: number, operation: string, details?: string): string {
    const progress = `${current}/${total}`;
    const percentage = Math.round((current / total) * 100);
    const detailsPart = details ? ` - ${details}` : "";
    return `${operation}: ${progress} (${percentage}%)${detailsPart}`;
  }

  /**
   * Format a step indicator
   * @param stepNumber - Step number (1-based)
   * @param totalSteps - Total number of steps
   * @param stepName - Name of the step
   * @returns Formatted step indicator
   */
  static step(stepNumber: number, totalSteps: number, stepName: string): string {
    return `Step ${stepNumber}/${totalSteps}: ${stepName}`;
  }

  /**
   * Format a summary with items
   * @param options - Summary options
   * @returns Formatted summary string
   */
  static summary(options: SummaryOptions): string {
    const lines: string[] = [];

    // Title
    lines.push(options.title);
    lines.push(this.separator());

    // Items
    options.items.forEach((item) => {
      lines.push(`   ${item.label}: ${item.value}`);
    });

    // Optional separator after
    if (options.showSeparator !== false) {
      lines.push(this.separator());
    }

    return lines.join("\n");
  }

  /**
   * Format a list item with indentation
   * @param text - Item text
   * @param level - Indentation level (default: 1)
   * @returns Formatted list item
   */
  static listItem(text: string, level = 1): string {
    const indent = "   ".repeat(level);
    return `${indent}- ${text}`;
  }

  /**
   * Format a key-value pair
   * @param key - Key label
   * @param value - Value
   * @param indent - Indentation level (default: 1)
   * @returns Formatted key-value pair
   */
  static keyValue(key: string, value: string | number, indent = 1): string {
    const indentStr = "   ".repeat(indent);
    return `${indentStr}${key}: ${value}`;
  }

  /**
   * Format a section with title and content
   * @param title - Section title
   * @param content - Section content (array of lines)
   * @param emoji - Optional emoji for title
   * @returns Formatted section
   */
  static section(title: string, content: string[], emoji?: string): string {
    const lines: string[] = [];
    lines.push(this.header(title, emoji));
    lines.push(this.separator());
    lines.push(...content);
    lines.push(this.separator());
    return lines.join("\n");
  }

  /**
   * Format a count with label
   * @param count - Count number
   * @param label - Label (singular form, will be pluralized if count !== 1)
   * @returns Formatted count string
   */
  static count(count: number, label: string): string {
    const plural = count !== 1 ? `${label}s` : label;
    return `${count} ${plural}`;
  }

  /**
   * Format a duration in milliseconds
   * @param ms - Duration in milliseconds
   * @returns Formatted duration string (e.g., "2m 30s", "45s")
   */
  static duration(ms: number): string {
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
   * Format a percentage
   * @param value - Value (0-100)
   * @param decimals - Number of decimal places (default: 0)
   * @returns Formatted percentage string
   */
  static percentage(value: number, decimals = 0): string {
    return `${value.toFixed(decimals)}%`;
  }
}
