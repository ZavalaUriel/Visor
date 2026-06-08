import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type DetectionResult = {
  botella: boolean;
};

@Injectable()
export class AppService {
  private readonly yoloUrl: string;

  constructor(private readonly configService: ConfigService) {
    const port = this.configService.get<string>('YOLO_PORT') ?? '8000';
    const host = this.configService.get<string>('YOLO_HOST') ?? 'localhost';
    this.yoloUrl = `http://${host}:${port}/detect`;
  }

  async detectFromBuffer(
    buffer: Buffer,
    _mimeType?: string,
    _filename?: string,
  ): Promise<DetectionResult> {
    try {
      const response = await fetch(this.yoloUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(buffer),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Error desconocido');
        throw new BadRequestException(
          `El servicio YOLO respondió con error (${response.status}): ${errorText}`,
        );
      }

      const parsed = await response.json();

      if (!this.isDetectionResult(parsed)) {
        throw new BadRequestException(
          'La respuesta del modelo YOLO no tiene el formato esperado.',
        );
      }

      return parsed;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `No se pudo conectar al servicio YOLO en ${this.yoloUrl}. Asegúrate de que yolo_service.py esté corriendo. Detalle: ${(error as Error).message}`,
      );
    }
  }

  private isDetectionResult(value: unknown): value is DetectionResult {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const record = value as Record<string, unknown>;
    return typeof record.botella === 'boolean';
  }
}

