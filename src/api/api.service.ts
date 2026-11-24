import { Injectable, BadRequestException, NotFoundException, MethodNotAllowedException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/** Vistas expuestas del esquema `api` (guía UI Zurich §4). */
const VIEWS = new Set([
  'calendario',
  'config',
  'embudo',
  'eventos_pedido',
  'laboratorios',
  'mensajes',
  'mensajes_bloqueados',
  'metricas_diarias',
  'pedido_items',
  'pedidos',
  'rotacion',
  'sucursales',
  'tiempos_aprobacion',
]);

const SCHEMA = 'api';
const IDENT = /^[a-z_][a-z0-9_]*$/i;

const OPS: Record<string, string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  ilike: 'ILIKE',
};

/**
 * Escrituras permitidas (guía §6: jamás estados de pedidos desde la UI).
 * PATCH: solo campos de esta lista; POST: alta de sucursales (data maestra).
 */
const WRITE_PATCH: Record<string, Set<string>> = {
  config: new Set(['valor']),
  sucursales: new Set(['telefono', 'regenta', 'direccion', 'horario', 'activa', 'dias_ruta']),
};
const WRITE_POST: Record<string, Set<string>> = {
  sucursales: new Set(['codigo', 'nombre', 'telefono']),
};

interface Where {
  sql: string[];
  values: unknown[];
}

@Injectable()
export class ApiService {
  constructor(private db: DatabaseService) {}

  // ─── Helpers ───────────────────────────────────────────────────────

  resolveView(viewName: string): string {
    const view = viewName.toLowerCase();
    if (!VIEWS.has(view)) throw new NotFoundException(`recurso no encontrado: ${viewName}`);
    return view;
  }

  private checkCol(name: string, cols: Set<string>): string {
    if (!IDENT.test(name) || !cols.has(name)) {
      throw new BadRequestException(`columna desconocida: ${name}`);
    }
    return name;
  }

  parseFilters(
    query: Record<string, unknown>,
    cols: Set<string>,
    skip: Set<string>,
    paramOffset = 0,
  ): Where {
    const sql: string[] = [];
    const values: unknown[] = [];
    for (const [key, rawValue] of Object.entries(query)) {
      if (skip.has(key)) continue;
      const raw = String(rawValue ?? '');
      const dot = raw.indexOf('.');
      const opKey = dot > 0 ? raw.slice(0, dot) : 'eq';
      const val = dot > 0 ? raw.slice(dot + 1) : raw;
      const col = this.checkCol(key, cols);
      if (opKey === 'is') {
        if (val === 'null') sql.push(`"${col}" IS NULL`);
        else if (val === 'not.null') sql.push(`"${col}" IS NOT NULL`);
        else throw new BadRequestException('is solo admite null o not.null');
        continue;
      }
      const op = OPS[opKey];
      if (!op) throw new BadRequestException(`operador no soportado: ${opKey}`);
      values.push(val);
      sql.push(`"${col}" ${op} $${paramOffset + values.length}`);
    }
    return { sql, values };
  }

  parseOrder(raw: string, cols: Set<string>): string {
    const parts = raw.split(',').filter(Boolean);
    if (parts.length === 0) throw new BadRequestException('order vacío');
    const keys: string[] = [];
    for (const part of parts) {
      const dot = part.lastIndexOf('.');
      const name = dot > 0 ? part.slice(0, dot) : part;
      const dir = dot > 0 ? part.slice(dot + 1) : 'asc';
      const col = this.checkCol(name, cols);
      if (dir !== 'asc' && dir !== 'desc') {
        throw new BadRequestException(`orden no soportado: ${dir}`);
      }
      keys.push(`"${col}" ${dir.toUpperCase()}`);
    }
    return keys.join(', ');
  }

  parseRange(header: string | undefined): { start: number; end: number | null } {
    if (!header) return { start: 0, end: null };
    const m = /^(\d+)-(\d*)$/.exec(header.trim());
    if (!m) throw new BadRequestException('cabecera Range inválida');
    const start = Number(m[1]);
    const end = m[2] ? Number(m[2]) : null;
    if (
      !Number.isSafeInteger(start) ||
      (end !== null && (!Number.isSafeInteger(end) || end < start))
    ) {
      throw new BadRequestException('cabecera Range inválida');
    }
    return { start, end };
  }

  // ─── GET ───────────────────────────────────────────────────────────

  async findAll(
    viewName: string,
    query: Record<string, unknown>,
    rangeHeader: string | undefined,
    preferHeader: string | undefined,
  ): Promise<{ rows: Record<string, unknown>[]; contentRange?: string }> {
    const view = this.resolveView(viewName);
    const colNames = await this.db.getViewColumns(view);
    const cols = new Set(colNames);
    const skip = new Set(['order', 'limit', 'offset', 'select']);

    const where = this.parseFilters(query, cols, skip);

    let orderSql = '';
    const orderRaw = query.order as string | undefined;
    if (orderRaw) {
      orderSql = ` ORDER BY ${this.parseOrder(orderRaw, cols)}`;
    }

    let selectSql = '*';
    const selectRaw = query.select as string | undefined;
    if (selectRaw) {
      const names: string[] = [];
      for (const part of selectRaw.split(',').filter(Boolean)) {
        names.push(`"${this.checkCol(part.trim(), cols)}"`);
      }
      if (names.length > 0) selectSql = names.join(', ');
    }

    const range = this.parseRange(rangeHeader);

    let limitSql = '';
    let offsetSql = '';
    const limitRaw = query.limit as string | undefined;
    if (limitRaw) {
      const n = Number(limitRaw);
      if (!Number.isSafeInteger(n) || n < 0) throw new BadRequestException('limit inválido');
      limitSql = ` LIMIT ${n}`;
    } else if (range.end !== null) {
      limitSql = ` LIMIT ${range.end - range.start + 1}`;
    }

    let offset = range.start;
    const offsetRaw = query.offset as string | undefined;
    if (offsetRaw) {
      const n = Number(offsetRaw);
      if (!Number.isSafeInteger(n) || n < 0) throw new BadRequestException('offset inválido');
      offset += n;
    }
    if (offset > 0) offsetSql = ` OFFSET ${offset}`;

    const whereSql = where.sql.length ? ` WHERE ${where.sql.join(' AND ')}` : '';
    const from = `"${SCHEMA}"."${view}"`;

    let contentRange: string | undefined;
    const prefer = preferHeader ?? '';
    if (prefer.includes('count=exact')) {
      const countRes = await this.db.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${from}${whereSql}`,
        where.values,
      );
      const total = countRes.rows[0].total;
      contentRange =
        range.end !== null
          ? `${range.start}-${Math.min(range.end, Math.max(total - 1, range.start))}/${total}`
          : `*/${total}`;
    }

    const result = await this.db.query(
      `SELECT ${selectSql} FROM ${from}${whereSql}${orderSql}${limitSql}${offsetSql}`,
      where.values,
    );

    return { rows: result.rows, contentRange };
  }

  // ─── PATCH ─────────────────────────────────────────────────────────

  async update(
    viewName: string,
    query: Record<string, unknown>,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const view = this.resolveView(viewName);
    const allowed = WRITE_PATCH[view];
    if (!allowed) throw new MethodNotAllowedException('PATCH no está permitido en esta vista');

    const keys = Object.keys(body);
    if (keys.length === 0) throw new BadRequestException('body vacío');
    if (keys.some((k) => !allowed.has(k))) {
      throw new BadRequestException(`campos permitidos: ${[...allowed].join(', ')}`);
    }
    if (view === 'config' && typeof body.valor !== 'string') {
      throw new BadRequestException('valor debe ser string');
    }

    const colNames = await this.db.getViewColumns(view);
    const cols = new Set(colNames);
    const values: unknown[] = [];
    const setSql: string[] = [];
    for (const k of keys) {
      const col = this.checkCol(k, cols);
      values.push(body[k]);
      setSql.push(`"${col}" = $${values.length}`);
    }

    const where = this.parseFilters(query, cols, new Set(), values.length);
    if (where.sql.length === 0) {
      throw new BadRequestException('se requiere un filtro (ej. ?clave=eq.x o ?id=eq.N)');
    }

    values.push(...where.values);
    const result = await this.db.query(
      `UPDATE "${SCHEMA}"."${view}" SET ${setSql.join(', ')} WHERE ${where.sql.join(' AND ')} RETURNING *`,
      values,
    );
    return result.rows;
  }

  // ─── POST ──────────────────────────────────────────────────────────

  async create(
    viewName: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const view = this.resolveView(viewName);
    const allowed = WRITE_POST[view];
    if (!allowed) throw new MethodNotAllowedException('POST no está permitido en esta vista');

    const keys = Object.keys(body);
    if (keys.length === 0) throw new BadRequestException('body vacío');
    if (keys.some((k) => !allowed.has(k))) {
      throw new BadRequestException(`campos permitidos: ${[...allowed].join(', ')}`);
    }

    const colNames = await this.db.getViewColumns(view);
    const cols = new Set(colNames);
    const values: unknown[] = [];
    const colsSql: string[] = [];
    for (const k of keys) {
      const col = this.checkCol(k, cols);
      values.push(body[k]);
      colsSql.push(`"${col}"`);
    }
    const ph = keys.map((_, i) => `$${i + 1}`);
    const result = await this.db.query(
      `INSERT INTO "${SCHEMA}"."${view}" (${colsSql.join(', ')}) VALUES (${ph.join(', ')}) RETURNING *`,
      values,
    );
    return result.rows;
  }
}
