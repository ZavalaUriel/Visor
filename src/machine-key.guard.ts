import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

/**
 * Protege los endpoints del Visor con una API key compartida (cabecera x-api-key).
 * Los clientes son dispositivos propios (tablet de la máquina, ESP32, scripts),
 * así que todos pueden enviar la clave.
 *
 * Si MACHINE_API_KEY no está configurada, no se exige (modo desarrollo) y se
 * registra una advertencia al arrancar.
 */
@Injectable()
export class MachineKeyGuard implements CanActivate {
  private readonly logger = new Logger(MachineKeyGuard.name);
  private readonly apiKey?: string;
  private warned = false;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('MACHINE_API_KEY') || undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.apiKey) {
      if (!this.warned) {
        this.logger.warn(
          'MACHINE_API_KEY no configurada: los endpoints del Visor quedan sin protección (solo aceptable en desarrollo).',
        );
        this.warned = true;
      }
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = (request.headers['x-api-key'] as string) ?? '';
    const expected = Buffer.from(this.apiKey);
    const received = Buffer.from(provided);
    const valid =
      expected.length === received.length && timingSafeEqual(expected, received);

    if (!valid) {
      throw new UnauthorizedException('API key inválida.');
    }
    return true;
  }
}
