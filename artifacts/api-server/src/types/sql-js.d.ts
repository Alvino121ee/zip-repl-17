/**
 * Minimal type declarations untuk sql.js (pure WASM SQLite)
 * Menghindari konflik dengan @types/sql.js yang memicu duplicate drizzle-orm install
 */
declare module "sql.js" {
  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface BindParams {
    [key: string]: unknown;
  }

  export interface Statement {
    step(): boolean;
    getAsObject(params?: BindParams): Record<string, unknown>;
    run(params?: unknown[]): void;
    free(): void;
  }

  export interface Database {
    run(sql: string, params?: unknown[]): Database;
    prepare(sql: string): Statement;
    exec(sql: string): QueryExecResult[];
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | null) => Database;
  }

  function initSqlJs(config?: { locateFile?: (file: string) => string }): Promise<SqlJsStatic>;
  export default initSqlJs;
}
