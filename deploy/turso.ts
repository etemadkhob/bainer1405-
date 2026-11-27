/**
 * Zero-dependency Turso (libSQL) HTTP v2 client for Cloudflare Workers.
 *
 * Speaks the /v2/pipeline protocol directly over fetch, so no npm database
 * package is needed inside the Worker bundle. Positional `?` placeholders
 * are used for all statements.
 */

export interface Env {
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
}

export type LibSqlValue = number | string | null;

interface LibSqlArg {
  type: 'integer' | 'float' | 'text' | 'null';
  /** Hrana v2: integers/strings are encoded as strings, floats as JSON numbers */
  value?: string | number;
}

interface DbCell {
  type: string;
  value: string | null;
}

export type DbRow = Record<string, LibSqlValue>;

export interface QueryResult {
  columns: string[];
  rows: DbRow[];
  rowsAffected: number;
  lastInsertRowId: number | null;
}

interface PipelineResponse {
  results?: Array<{
    type: string;
    response?: {
      type: string;
      result?: {
        cols?: Array<{ name: string; decltype?: string }>;
        rows?: DbCell[][];
        affected_row_count?: number;
        last_insert_rowid?: number | null;
      };
      message?: string;
      code?: string;
    };
  }>;
}

function toArg(v: LibSqlValue): LibSqlArg {
  if (v === null || v === undefined) {
    return { type: 'null' };
  }
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { type: 'integer', value: String(v) }
      : { type: 'float', value: v };
  }
  return { type: 'text', value: String(v) };
}

function coerce(cell: DbCell): LibSqlValue {
  if (cell.value === null) {
    return null;
  }
  const t = cell.type.toLowerCase();
  if (t === 'integer' || t === 'float' || t === 'real' || t === 'numeric') {
    const n = Number(cell.value);
    return Number.isFinite(n) ? n : cell.value;
  }
  return cell.value;
}

export interface TursoClient {
  /** False when env secrets are not configured yet (graceful degradation). */
  readonly available: boolean;
  execute(sql: string, args?: LibSqlValue[]): Promise<QueryResult>;
  batch(statements: Array<{ sql: string; args?: LibSqlValue[] }>): Promise<QueryResult[]>;
}

export function createTursoClient(env: Env): TursoClient {
  const rawUrl = env.TURSO_DATABASE_URL ?? '';
  const token = env.TURSO_AUTH_TOKEN ?? '';

  if (!rawUrl || !token) {
    return {
      available: false,
      async execute() {
        throw new Error('Turso secrets are not configured (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)');
      },
      async batch() {
        throw new Error('Turso secrets are not configured (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)');
      },
    };
  }

  const base = rawUrl.startsWith('libsql://')
    ? `https://${rawUrl.slice('libsql://'.length)}`
    : rawUrl.replace(/\/+$/, '');
  const endpoint = `${base}/v2/pipeline`;

  async function pipeline(
    statements: Array<{ sql: string; args?: LibSqlValue[] }>
  ): Promise<QueryResult[]> {
    const body = {
      requests: [
        ...statements.map((stmt) => ({
          type: 'execute',
          stmt: {
            sql: stmt.sql,
            args: (stmt.args ?? []).map(toArg),
          },
        })),
        { type: 'close' },
      ],
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      throw new Error(`Turso HTTP ${res.status}`);
    }

    const payload = (await res.json()) as PipelineResponse;
    const results = payload.results ?? [];

    const out: QueryResult[] = [];
    for (const step of results) {
      const resp = step.response;
      if (!resp) continue;
      if (resp.type === 'error') {
        throw new Error(`Turso SQL error: ${resp.message ?? 'unknown'} (${resp.code ?? '?'})`);
      }
      if (resp.type === 'execute' && resp.result) {
        const cols = resp.result.cols ?? [];
        const rows = (resp.result.rows ?? []).map((cells) => {
          const row: DbRow = {};
          cols.forEach((col, i) => {
            row[col.name] = coerce(cells[i]);
          });
          return row;
        });
        out.push({
          columns: cols.map((c) => c.name),
          rows,
          rowsAffected: resp.result.affected_row_count ?? 0,
          lastInsertRowId: resp.result.last_insert_rowid ?? null,
        });
      }
    }
    return out;
  }

  return {
    available: true,
    async execute(sql, args) {
      const [result] = await pipeline([{ sql, args }]);
      return result ?? { columns: [], rows: [], rowsAffected: 0, lastInsertRowId: null };
    },
    async batch(statements) {
      if (statements.length === 0) return [];
      return pipeline(statements);
    },
  };
}
