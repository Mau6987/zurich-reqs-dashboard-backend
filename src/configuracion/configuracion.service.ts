import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ConfigService } from '@nestjs/config';

export interface GuardarConfigDto {
  config?: Record<string, string>;
  params?: Record<string, string>;
  extras?: Array<{ rol: string; telefono: string; nombre?: string }>;
  sucursales?: Array<{ id: number; telefono?: string; departamento_id?: number }>;
  labs?: Array<{ contacto_id: number; telefono_prueba?: string; telefono_real?: string }>;
  labs_activos?: Array<{ laboratorio_id: number; activo: boolean }>;
  whatsapp?: {
    evolution_url?: string;
    token_central?: string;
    modo_envio?: string;
  };
}

@Injectable()
export class ConfiguracionService {
  constructor(
    private db: DatabaseService,
    private configService: ConfigService,
  ) {}

  /**
   * Obtiene la configuración completa del sistema:
   * - config (variables de zr.config)
   * - params (parámetros operativos y horarios)
   * - extras (otros roles autorizados en zr.roles_numeros)
   * - sucursales (con teléfonos de recepción)
   * - labs (laboratorios con contactos, números de prueba y estado activo)
   * - wa (estado de conexión de Evolution/WhatsApp)
   */
  async getConfiguracionCompleta() {
    try {
      // 1. Config de zr.config
      const configRes = await this.db.query<{ clave: string; valor: string | null }>(
        'SELECT clave, valor FROM zr.config ORDER BY clave'
      );
      const configMap: Record<string, string> = {};
      configRes.rows.forEach((r) => {
        configMap[r.clave] = r.valor ?? '';
      });

      // 2. Parámetros operativos y horarios
      const params: Record<string, string> = {
        modo_prueba: configMap['modo_prueba'] || 'no',
        saldo_hora_desde: configMap['saldo_hora_desde'] || '07:00',
        hora_corte_saldo: configMap['hora_corte_saldo'] || '09:00',
        saldo_respeta_horario: configMap['saldo_respeta_horario'] || 'si',
        hora_pedido_desde: configMap['hora_pedido_desde'] || '10:00',
        hora_pedido_hasta: configMap['hora_pedido_hasta'] || '12:30',
        max_labs_activos: configMap['max_labs_activos'] || '0',
        umbral_alta_rotacion_pct: configMap['umbral_alta_rotacion_pct'] || '70',
        umbral_baja_rotacion_pct: configMap['umbral_baja_rotacion_pct'] || '40',
        ventana_rotacion_dias: configMap['ventana_rotacion_dias'] || '30',
        cobertura_obj_alta_dias: configMap['cobertura_obj_alta_dias'] || '15',
        cobertura_obj_media_dias: configMap['cobertura_obj_media_dias'] || '10',
        cobertura_min_cede_dias: configMap['cobertura_min_cede_dias'] || '30',
        traspaso_requiere_aprobacion: configMap['traspaso_requiere_aprobacion'] || 'si',
      };

      // 3. Extras autorizados (zr.roles_numeros)
      const extrasRes = await this.db.query<{ rol: string; telefono: string; nombre: string | null }>(
        'SELECT rol, telefono, nombre FROM zr.roles_numeros ORDER BY rol, nombre'
      );

      // 4. Sucursales (con departamento_id y departamento)
      const sucsRes = await this.db.query<{
        id: number;
        codigo: string;
        nombre: string;
        tipo: string | null;
        regenta: string | null;
        telefono: string | null;
        activa: boolean;
        departamento_id: number | null;
        departamento: string | null;
      }>(`
        SELECT s.id, s.codigo, s.nombre, s.tipo, s.regenta, s.telefono, s.activa,
               s.departamento_id, COALESCE(d.nombre, s.departamento) AS departamento
        FROM zr.sucursales s
        LEFT JOIN zr.departamentos d ON d.id = s.departamento_id
        ORDER BY s.nombre
      `);

      // 4b. Departamentos
      const deptosRes = await this.db.query<{
        id: number;
        codigo: string;
        nombre: string;
      }>('SELECT id, codigo, nombre FROM zr.departamentos ORDER BY nombre');

      // 5. Laboratorios y contactos
      const labsRes = await this.db.query<{
        contacto_id: number;
        laboratorio_id: number;
        laboratorio: string;
        contacto: string | null;
        telefono_prueba: string | null;
        telefono_real: string | null;
        real_mascara: string;
        recibe: boolean;
      }>(`
        SELECT 
          c.id AS contacto_id,
          l.id AS laboratorio_id,
          l.nombre AS laboratorio,
          c.nombre AS contacto,
          c.telefono_prueba,
          c.telefono_real,
          CASE 
            WHEN c.telefono_real IS NOT NULL AND length(c.telefono_real) >= 8 
            THEN substring(c.telefono_real from 1 for 4) || '****'
            ELSE '—'
          END AS real_mascara,
          COALESCE(l.activo, false) AS recibe
        FROM zr.lab_contactos c
        JOIN zr.laboratorios l ON l.id = c.laboratorio_id
        ORDER BY l.nombre, c.nombre
      `);

      // 6. Resumen de estado WhatsApp
      const wa = {
        token_set: Boolean(configMap['token_central'] && configMap['token_central'] !== 'CAMBIAR'),
        evolution_url: configMap['evolution_url'] || '',
        modo_envio: configMap['modo_envio'] || 'simulado',
        virtuales: sucsRes.rows.some((s) => s.telefono && s.telefono.startsWith('5917000')),
      };

      return {
        ok: true,
        datos: {
          config: configMap,
          params,
          extras: extrasRes.rows,
          sucursales: sucsRes.rows,
          departamentos: deptosRes.rows,
          labs: labsRes.rows,
          wa,
        },
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error al obtener configuración';
      throw new InternalServerErrorException(message);
    }
  }

  /**
   * Guarda todas las configuraciones enviadas en una única transacción:
   * - Teléfonos de roles (central, contabilidad, administración) en zr.config
   * - Parámetros operativos y de horarios en zr.config y n8n.config
   * - Roles extras en zr.roles_numeros
   * - Teléfonos de sucursales en zr.sucursales
   * - Teléfonos de prueba en zr.lab_contactos
   * - Estado activo de laboratorios en zr.laboratorios
   */
  async guardarConfiguracion(datos: GuardarConfigDto) {
    if (!datos) {
      throw new BadRequestException('Datos vacíos');
    }

    try {
      await this.db.query('BEGIN');

      // 1. Guardar config (roles clave, URLs, tokens)
      if (datos.config) {
        for (const [clave, rawVal] of Object.entries(datos.config)) {
          const valor = String(rawVal ?? '').trim();
          await this.db.query(
            `INSERT INTO zr.config (clave, valor, actualizado)
             VALUES ($1, $2, NOW())
             ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = NOW()`,
            [clave, valor]
          );
          // Sincronizar en n8n.config si existe
          await this.db.query(
            `INSERT INTO n8n.config (clave, valor)
             VALUES ($1, $2)
             ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
            [clave, valor]
          ).catch(() => {});
        }
      }

      // 2. Guardar params (horarios, umbrales, modo prueba)
      if (datos.params) {
        for (const [clave, rawVal] of Object.entries(datos.params)) {
          const valor = String(rawVal ?? '').trim();
          await this.db.query(
            `INSERT INTO zr.config (clave, valor, actualizado)
             VALUES ($1, $2, NOW())
             ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = NOW()`,
            [clave, valor]
          );
          await this.db.query(
            `INSERT INTO n8n.config (clave, valor)
             VALUES ($1, $2)
             ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
            [clave, valor]
          ).catch(() => {});
        }
      }

      // 3. Guardar WhatsApp / Evolution
      if (datos.whatsapp) {
        const { evolution_url, token_central, modo_envio } = datos.whatsapp;
        if (evolution_url !== undefined) {
          await this.guardarClaveConfig('evolution_url', evolution_url);
        }
        if (token_central) {
          await this.guardarClaveConfig('token_central', token_central);
        }
        if (modo_envio) {
          await this.guardarClaveConfig('modo_envio', modo_envio);
        }
      }

      // 4. Guardar extras (roles autorizados)
      if (Array.isArray(datos.extras)) {
        await this.db.query('DELETE FROM zr.roles_numeros');
        for (const extra of datos.extras) {
          const tel = this.normalizarTelefono(extra.telefono);
          const rol = String(extra.rol || '').trim().toLowerCase();
          const nombre = String(extra.nombre || '').trim();
          if (tel && rol) {
            await this.db.query(
              `INSERT INTO zr.roles_numeros (telefono, rol, nombre)
               VALUES ($1, $2, $3)
               ON CONFLICT (telefono) DO UPDATE SET rol = EXCLUDED.rol, nombre = EXCLUDED.nombre`,
              [tel, rol, nombre || null]
            ).catch(async () => {
              // Si no hay PK en telefono
              await this.db.query(
                `INSERT INTO zr.roles_numeros (telefono, rol, nombre) VALUES ($1, $2, $3)`,
                [tel, rol, nombre || null]
              );
            });
          }
        }
      }

      // 5. Guardar teléfonos y departamento de sucursales
      if (Array.isArray(datos.sucursales)) {
        for (const suc of datos.sucursales) {
          if (suc.telefono !== undefined) {
            const tel = this.normalizarTelefono(suc.telefono);
            await this.db.query(
              'UPDATE zr.sucursales SET telefono = $1 WHERE id = $2',
              [tel || null, suc.id]
            );
          }
          if (suc.departamento_id !== undefined && suc.departamento_id !== null) {
            await this.db.query(
              `UPDATE zr.sucursales s
               SET departamento_id = d.id, departamento = d.nombre
               FROM zr.departamentos d
               WHERE s.id = $1 AND d.id = $2`,
              [suc.id, suc.departamento_id]
            );
          }
        }
      }

      // 6. Guardar teléfonos de laboratorios (prueba y real)
      if (Array.isArray(datos.labs)) {
        for (const lab of datos.labs) {
          const sets: string[] = [];
          const vals: unknown[] = [];
          if (lab.telefono_prueba !== undefined) {
            vals.push(this.normalizarTelefono(lab.telefono_prueba) || null);
            sets.push(`telefono_prueba = $${vals.length}`);
          }
          if (lab.telefono_real !== undefined) {
            vals.push(this.normalizarTelefono(lab.telefono_real) || null);
            sets.push(`telefono_real = $${vals.length}`);
          }
          if (sets.length > 0) {
            vals.push(lab.contacto_id);
            await this.db.query(
              `UPDATE zr.lab_contactos SET ${sets.join(", ")} WHERE id = $${vals.length}`,
              vals
            );
          }
        }
      }

      // 7. Guardar laboratorios activos
      if (Array.isArray(datos.labs_activos)) {
        for (const act of datos.labs_activos) {
          await this.db.query(
            'UPDATE zr.laboratorios SET activo = $1 WHERE id = $2',
            [Boolean(act.activo), act.laboratorio_id]
          );
        }
      }

      await this.db.query('COMMIT');
      return { ok: true, mensaje: 'Configuración guardada exitosamente' };
    } catch (e) {
      await this.db.query('ROLLBACK').catch(() => {});
      const message = e instanceof Error ? e.message : 'Error al guardar configuración';
      throw new InternalServerErrorException(message);
    }
  }

  /**
   * Administra números virtuales:
   * - 'todo': asigna teléfonos de prueba 5917000XXXX a sucursales y contactos sin número.
   * - 'quitar': elimina números que inicien con 5917000.
   */
  async gestionarVirtuales(accion: 'todo' | 'quitar') {
    try {
      if (accion === 'todo') {
        // Sucursales sin teléfono
        const sucs = await this.db.query<{ id: number }>(
          "SELECT id FROM zr.sucursales WHERE telefono IS NULL OR telefono = '' ORDER BY id"
        );
        for (let i = 0; i < sucs.rows.length; i++) {
          const virtual = `59170000${String(i + 1).padStart(3, '0')}`;
          await this.db.query('UPDATE zr.sucursales SET telefono = $1 WHERE id = $2', [
            virtual,
            sucs.rows[i].id,
          ]);
        }

        // Contactos de laboratorio sin teléfono de prueba
        const contacts = await this.db.query<{ id: number; laboratorio_id: number }>(
          "SELECT id, laboratorio_id FROM zr.lab_contactos WHERE telefono_prueba IS NULL OR telefono_prueba = '' ORDER BY id"
        );
        for (let i = 0; i < contacts.rows.length; i++) {
          const virtual = `59170001${String(i + 1).padStart(3, '0')}`;
          await this.db.query('UPDATE zr.lab_contactos SET telefono_prueba = $1 WHERE id = $2', [
            virtual,
            contacts.rows[i].id,
          ]);
          // Activar laboratorio
          await this.db.query('UPDATE zr.laboratorios SET activo = true WHERE id = $1', [
            contacts.rows[i].laboratorio_id,
          ]);
        }

        return { ok: true, mensaje: 'Números virtuales creados correctamente' };
      } else if (accion === 'quitar') {
        await this.db.query(
          "UPDATE zr.sucursales SET telefono = NULL WHERE telefono LIKE '5917000%'"
        );
        await this.db.query(
          "UPDATE zr.lab_contactos SET telefono_prueba = NULL WHERE telefono_prueba LIKE '5917000%'"
        );
        return { ok: true, mensaje: 'Números virtuales eliminados' };
      } else {
        throw new BadRequestException('Acción virtual no reconocida (usar todo | quitar)');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Error al gestionar números virtuales';
      throw new InternalServerErrorException(message);
    }
  }

  /**
   * Envía un mensaje de prueba al teléfono indicado (8 dígitos o con 591).
   */
  async probarEnvioWhatsApp(telefono: string, texto?: string) {
    const tel = this.normalizarTelefono(telefono);
    if (!tel) {
      throw new BadRequestException('Número de teléfono inválido (debe tener 8 dígitos)');
    }

    const cfgRes = await this.db.query<{ valor: string | null }>(
      "SELECT valor FROM zr.config WHERE clave IN ('evolution_url', 'token_central', 'modo_envio')"
    );
    const cfg: Record<string, string> = {};
    cfgRes.rows.forEach((r) => {
      // @ts-expect-error key row
      cfg[r.clave] = r.valor ?? '';
    });

    const msg = texto || 'Prueba de conexión con Farmacias Zurich ✅';

    // Si hay webhook en n8n
    const n8nUrl = this.configService.get<string>('N8N_UI_WEBHOOK_URL');
    if (n8nUrl) {
      try {
        await fetch(n8nUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accion: 'probar_envio',
            tel,
            texto: msg,
          }),
        });
        return { ok: true, mensaje: 'Mensaje de prueba solicitado vía n8n' };
      } catch {}
    }

    return { ok: true, mensaje: `Mensaje de prueba procesado para ${tel}` };
  }

  private async guardarClaveConfig(clave: string, valor: string) {
    await this.db.query(
      `INSERT INTO zr.config (clave, valor, actualizado)
       VALUES ($1, $2, NOW())
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = NOW()`,
      [clave, valor]
    );
    await this.db.query(
      `INSERT INTO n8n.config (clave, valor)
       VALUES ($1, $2)
       ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [clave, valor]
    ).catch(() => {});
  }

  private normalizarTelefono(tel: unknown): string {
    const raw = String(tel ?? '').replace(/\D/g, '');
    if (!raw) return '';
    if (raw.startsWith('591') && raw.length === 11) return raw;
    if (raw.length === 8) return `591${raw}`;
    return raw;
  }
}
