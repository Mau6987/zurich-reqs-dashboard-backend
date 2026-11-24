import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { ConfiguracionService, GuardarConfigDto } from './configuracion.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/configuracion')
export class ConfiguracionController {
  constructor(private readonly configService: ConfiguracionService) {}

  /**
   * GET /api/configuracion
   * Retorna toda la configuración del sistema (config, params, extras, sucursales, labs, wa).
   */
  @Get()
  async obtenerTodo() {
    return this.configService.getConfiguracionCompleta();
  }

  /**
   * POST /api/configuracion
   * Guarda de forma atómica teléfonos, sucursales, roles, laboratorios y parámetros.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async guardar(@Body() body: GuardarConfigDto) {
    return this.configService.guardarConfiguracion(body);
  }

  /**
   * POST /api/configuracion/virtuales
   * Crear o quitar números virtuales de prueba para sucursales y laboratorios.
   */
  @Post('virtuales')
  @UseGuards(JwtAuthGuard)
  async gestionarVirtuales(@Body() body: { accion: 'todo' | 'quitar' }) {
    return this.configService.gestionarVirtuales(body.accion || 'todo');
  }

  /**
   * POST /api/configuracion/probar-whatsapp
   * Envía un mensaje de prueba al teléfono destino.
   */
  @Post('probar-whatsapp')
  @UseGuards(JwtAuthGuard)
  async probarEnvio(@Body() body: { telefono: string; texto?: string }) {
    return this.configService.probarEnvioWhatsApp(body.telefono, body.texto);
  }
}
