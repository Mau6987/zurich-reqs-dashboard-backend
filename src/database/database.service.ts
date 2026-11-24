import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, types } from 'pg';

// Equivalencia con PostgREST: int8/numeric como número, date como texto ISO.
types.setTypeParser(20, (v) => Number(v));
types.setTypeParser(1700, (v) => parseFloat(v));
types.setTypeParser(1082, (v) => v);

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private pool: Pool;
  private colCache = new Map<string, string[]>();

  constructor(private config: ConfigService) {
    const url = this.config.get<string>('POSTGRES_URL');
    if (!url) throw new Error('POSTGRES_URL no está configurado en .env');
    this.pool = new Pool({ connectionString: url, max: 10 });
  }

  /** Ejecuta una query con parámetros. */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const result = await this.pool.query<T>(sql, values);
    return { rows: result.rows, rowCount: result.rowCount };
  }

  /** Columnas reales de una vista del esquema `api` (cacheadas por proceso). */
  async getViewColumns(view: string): Promise<string[]> {
    const hit = this.colCache.get(view);
    if (hit) return hit;
    const res = await this.pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'api' AND table_name = $1",
      [view],
    );
    const cols = res.rows.map((r) => r.column_name);
    if (cols.length === 0) throw new Error(`vista no encontrada: ${view}`);
    this.colCache.set(view, cols);
    return cols;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
