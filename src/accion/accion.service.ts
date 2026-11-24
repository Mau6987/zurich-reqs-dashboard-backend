import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  BadGatewayException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

const ACCIONES = new Set(['aprobar', 'rechazar', 'reagendar']);

export interface AccionDto {
  accion?: unknown;
  codigo?: unknown;
  motivo?: unknown;
  fecha?: unknown;
}

@Injectable()
export class AccionService {
  constructor(
    private config: ConfigService,
    private db: DatabaseService,
  ) {}

  /**
   * Reenvía la acción al webhook de n8n (`zurich-ui`), que valida y llama a
   * n8n.actualizar_pedido (sección 6 de la guía). El webhook_token nunca
   * sale del servidor.
   */
  async ejecutar(body: AccionDto): Promise<{ data: Record<string, unknown>; status: number }> {
    const accion = String(body.accion ?? '').toLowerCase();
    const codigo = String(body.codigo ?? '').trim().toUpperCase();

    if (!ACCIONES.has(accion)) {
      throw new BadRequestException({ ok: false, error: 'accion_invalida' });
    }
    if (!codigo) {
      throw new BadRequestException({ ok: false, error: 'falta_codigo' });
    }

    const url = this.config.get<string>('N8N_UI_WEBHOOK_URL');
    if (!url) {
      throw new InternalServerErrorException({ ok: false, error: 'webhook_no_configurado' });
    }

    // Leer token de la tabla n8n.config
    let token = '';
    try {
      const result = await this.db.query<{ valor: string | null }>(
        "SELECT valor FROM n8n.config WHERE clave = 'webhook_token'",
      );
      token = result.rows[0]?.valor ?? '';
    } catch {
      throw new InternalServerErrorException({ ok: false, error: 'config_no_leida' });
    }

    // Reenviar a n8n
    let n8nRes: Response;
    try {
      n8nRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion,
          codigo,
          motivo: String(body.motivo ?? ''),
          fecha: String(body.fecha ?? ''),
          token,
        }),
      });
    } catch {
      throw new BadGatewayException({ ok: false, error: 'n8n_indisponible' });
    }

    const data = (await n8nRes.json().catch(() => null)) as Record<string, unknown> | null;
    return {
      data: data ?? { ok: false, error: 'respuesta_invalida' },
      status: n8nRes.status,
    };
  }
}
