import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as crypto from 'crypto';

/**
 * Guard de autenticación JWT.
 * - Si JWT_SECRET está configurado, verifica el token y exige claim "role": "web_app".
 * - Si JWT_SECRET está vacío (modo dev), solo exige que el header Authorization exista.
 *
 * Usa verificación manual con crypto (sin dependencia de jsonwebtoken)
 * para mantener las dependencias mínimas en NestJS.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization requerido');
    }

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      // Modo dev: no se verifica el JWT, solo su presencia.
      return true;
    }

    const token = authHeader.replace(/^Bearer\s+/i, '');
    try {
      const payload = this.verifyJwt(token, secret);
      if (payload.role !== 'web_app') {
        throw new ForbiddenException('rol no autorizado');
      }
      (req as unknown as Record<string, unknown>)['jwtPayload'] = payload;
      return true;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new UnauthorizedException('token inválido o expirado');
    }
  }

  private verifyJwt(token: string, secret: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('token malformado');

    const [headerB64, payloadB64, signatureB64] = parts;
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    if (expectedSig !== signatureB64) throw new Error('firma inválida');

    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    );

    // Verificar expiración
    if (payload.exp && Date.now() / 1000 > payload.exp) {
      throw new Error('token expirado');
    }

    return payload;
  }
}
