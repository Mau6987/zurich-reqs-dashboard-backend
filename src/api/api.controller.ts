import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiService } from './api.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  /**
   * GET /api/:view — consulta estilo PostgREST sobre las vistas de `api`:
   * filtros `?col=eq.x`, `order`, `limit`, `select`, `Range` y `Prefer: count=exact`.
   */
  @Get(':view')
  async findAll(
    @Param('view') view: string,
    @Query() query: Record<string, unknown>,
    @Headers('range') rangeHeader: string | undefined,
    @Headers('prefer') preferHeader: string | undefined,
    @Res() res: Response,
  ) {
    const result = await this.apiService.findAll(view, query, rangeHeader, preferHeader);

    if (result.contentRange) {
      res.set('Content-Range', result.contentRange);
    }

    res.json(result.rows);
  }

  /**
   * PATCH /api/:view — solo las vistas y campos permitidos (guía §5/§6).
   * Prohibido escribir estados de pedidos desde la UI (guía §6).
   */
  @Patch(':view')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('view') view: string,
    @Query() query: Record<string, unknown>,
    @Body() body: Record<string, unknown>,
  ) {
    return this.apiService.update(view, query, body);
  }

  /**
   * POST /api/:view — solo altas de data maestra (hoy: sucursales).
   * Nunca estados ni montos de pedidos (guía §6).
   */
  @Post(':view')
  @UseGuards(JwtAuthGuard)
  @HttpCode(201)
  async create(
    @Param('view') view: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.apiService.create(view, body);
  }
}
