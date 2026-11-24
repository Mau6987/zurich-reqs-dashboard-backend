import { Controller, Post, Body, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { AccionService, AccionDto } from './accion.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/ui/accion')
export class AccionController {
  constructor(private readonly accionService: AccionService) {}

  /**
   * POST /api/ui/accion — la UI aprueba/rechaza/reagenda SIN tocar la base:
   * reenvía al webhook de n8n, que valida y actualiza el pedido.
   */
  @Post()
  @UseGuards(JwtAuthGuard)
  async ejecutar(@Body() body: AccionDto, @Res() res: Response) {
    const result = await this.accionService.ejecutar(body);
    res.status(result.status).json(result.data);
  }
}
