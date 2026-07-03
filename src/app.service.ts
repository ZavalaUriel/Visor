import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from './firebase.service';

export type DetectionResult = {
  botella: boolean;
  detected_objects?: any[];
};

@Injectable()
export class AppService {
  private readonly yoloUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly firebase: FirebaseService,
  ) {
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
        `No se pudo conectar al servicio YOLO en ${this.yoloUrl}. Detalle: ${(error as Error).message}`,
      );
    }
  }

  async detectFromBufferWithSession(
    buffer: Buffer,
    machineId: string,
  ): Promise<DetectionResult & { sessionId?: string }> {
    const detection = await this.detectFromBuffer(buffer);

    try {
      const sessionId = await this.firebase.getActiveSession(machineId);
      if (sessionId && detection.botella) {
        const count = await this.firebase.incrementBottleCount(sessionId);
        console.log(`[Firebase] Botella contada. Sesión: ${sessionId}, Total: ${count}`);
        await this.firebase.setBotellaState(sessionId, true);
      }
      return { ...detection, sessionId: sessionId ?? undefined };
    } catch (e) {
      console.warn(`[Firebase] No se pudo registrar detección: ${(e as Error).message}`);
      return detection;
    }
  }

  async validateFirstValidation(
    sessionId: string,
    machineId: string,
    esBotella: boolean,
  ): Promise<{ success: boolean }> {
    try {
      await this.firebase.setFirstValidation(sessionId, esBotella, machineId);
      await this.firebase.setActiveSession(machineId, sessionId);
      return { success: true };
    } catch (e) {
      console.warn(`[Visor] Error registrando validación 1: ${(e as Error).message}`);
      return { success: false };
    }
  }

  async getActiveSession(machineId: string): Promise<string | null> {
    try {
      return await this.firebase.getActiveSession(machineId);
    } catch {
      return null;
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
