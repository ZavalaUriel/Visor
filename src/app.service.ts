import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import * as path from 'path';

export type DetectionResult = {
  botella: boolean;
  detected_objects?: any[];
};

// Inicializar Firebase Admin
const serviceAccountPath = path.join(process.cwd(), 'firebase-key.json');
initializeApp({
  credential: cert(require(serviceAccountPath)),
  databaseURL: 'https://ecocycle-e9c04-default-rtdb.firebaseio.com'
});

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

      // SI ES BOTELLA, ACTUALIZAR FIREBASE REALTIME DATABASE
      if (parsed.botella) {
        await this.incrementarConteoBotella('machine_001');
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

  private async incrementarConteoBotella(machineId: string) {
    try {
      const db = getDatabase();
      // 1. Obtener la sesión activa de la máquina
      const activeSessionSnap = await db.ref(`machines/${machineId}/active_session`).once('value');
      const sessionId = activeSessionSnap.val();
      
      if (!sessionId) {
        console.warn(`[WARNING] Se detectó una botella pero no hay una sesión activa para la máquina ${machineId}.`);
        return;
      }

      // 2. Incrementar el conteo en esa sesión
      const conteoRef = db.ref(`sessions/${sessionId}/conteo`);
      await conteoRef.transaction((currentValue) => {
        return (currentValue || 0) + 1;
      });
      console.log(`[INFO] Botella registrada en sesión ${sessionId}. Nuevo conteo actualizado.`);
    } catch (error) {
      console.error(`[ERROR] Fallo al actualizar Firebase:`, error);
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
