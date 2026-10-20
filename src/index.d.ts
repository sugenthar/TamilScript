export class JsTamilError extends Error {
  code: string | null;
  constructor(message?: string, options?: { code?: string | null; cause?: unknown });
}
export class JsTamilSyntaxError extends JsTamilError {
  line: number | null;
  column: number | null;
  filename: string | null;
  constructor(
    message?: string,
    location?: { line?: number | null; column?: number | null; filename?: string | null; code?: string | null }
  );
  locationString(): string;
}

/**
 * TamilScript-branded aliases of the historical constructors. They are the
 * same values as `JsTamilError` / `JsTamilSyntaxError`, so either name works
 * with `instanceof`; the old names remain supported public API.
 */
export declare const TamilScriptError: typeof JsTamilError;
export declare const TamilScriptSyntaxError: typeof JsTamilSyntaxError;

export declare const ErrorCodes: {
  /** @deprecated No longer produced; use TAMIL_STRING_REMOVED. */
  readonly UNCLOSED_TAMIL_STRING: 'JST_UNCLOSED_STRING';
  readonly TAMIL_STRING_REMOVED: 'JST_TAMIL_STRING_REMOVED';
  readonly BAD_TAMIL_NUMBER: 'JST_BAD_NUMERIC_LITERAL';
  readonly MIXED_TAMIL_NUMBER: 'JST_MIXED_NUMERAL';
  readonly UNSUPPORTED_BIGINT: 'JST_UNSUPPORTED_BIGINT';
  readonly UNSAFE_INTEGER: 'JST_UNSAFE_INTEGER';
  /** @deprecated No longer produced (escapes belonged to the removed string form). */
  readonly BAD_ESCAPE: 'JST_BAD_ESCAPE';
  readonly UNTERMINATED_COMMENT: 'JST_UNTERMINATED_COMMENT';
  readonly UNTERMINATED_STRING: 'JST_UNTERMINATED_STRING';
  readonly UNTERMINATED_TEMPLATE: 'JST_UNTERMINATED_TEMPLATE';
  readonly UNTERMINATED_REGEX: 'JST_UNTERMINATED_REGEX';
  readonly UNTERMINATED_TEMPLATE_EXPR: 'JST_UNTERMINATED_TEMPLATE_EXPR';
  readonly INVALID_NUMERAL_INPUT: 'JST_INVALID_NUMERAL';
  readonly READ_ERROR: 'JST_READ_ERROR';
  readonly WRITE_ERROR: 'JST_WRITE_ERROR';
};

export function formatDiagnostic(err: Error, options?: { source?: string; maxWidth?: number }): string;

export function toNumber(input: string): number;
export function toTamilNumerals(n: number): string;
export function parseTamilDecimal(input: string): number;
export function toTamilDecimal(n: number): string;

/**
 * Tamil print helper. Formats like `console.log`, but never emits ANSI
 * color escapes — program output stays byte-exact when piped or captured.
 */
export declare const அச்சிடு: (...args: any[]) => void;

export function transform(source: string, options?: { filename?: string }): string;

export interface TransformEvent {
  type: 'number' | 'decimal';
  line: number;
  column: number;
  text: string;
  value: string;
}

export interface SourceMap {
  version: 3;
  file: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
}

export interface Replacement {
  outLine: number;
  outCol: number;
  outLen: number;
  srcLine: number;
  srcCol: number;
  srcLen: number;
}

export interface PositionAnchor {
  outLine: number;
  outCol: number;
  srcLine: number;
  srcCol: number;
}

export function transformWithMap(
  source: string,
  options?: { filename?: string }
): {
  code: string;
  map: SourceMap;
  replacements: Replacement[];
  /** Token-start anchors used to build the dense map (internal). */
  positions: PositionAnchor[];
};

export function transformWithMeta(
  source: string,
  options?: { filename?: string }
): { code: string; events: TransformEvent[] };

export function inlineSourceMapComment(map: SourceMap): string;

/**
 * File variant of transform(). Output is standalone: when the source
 * mentions அச்சிடு, a small inlined runtime prelude is prepended so the
 * file runs under plain `node` (no installed package, no manual import).
 * transform() itself stays a pure transformation without any prelude.
 */
export function transformFile(
  inputPath: string,
  outputPath?: string,
  options?: { force?: boolean }
): Promise<string>;

export function runFile(
  filePath: string,
  extraArgs?: string[],
  options?: { nodeFlags?: string[] }
): Promise<number>;

export function checkFile(filePath: string): Promise<{ ok: boolean; errors: string[] }>;

export const VERSION: string;
export const errors: {
  JsTamilError: typeof JsTamilError;
  JsTamilSyntaxError: typeof JsTamilSyntaxError;
  TamilScriptError: typeof TamilScriptError;
  TamilScriptSyntaxError: typeof TamilScriptSyntaxError;
  ErrorCodes: typeof ErrorCodes;
  formatDiagnostic: typeof formatDiagnostic;
};
