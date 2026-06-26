import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import * as path from 'path';

export type DetectionResult = {
  botella: boolean;
  detected_objects?: any[];
};

// Inicializar Firebase Admin
const serviceAccountPath = path.join(process.cwd(), 'firebase-key.json');
initializeApp({
  credential: cert(require(serviceAccountPath))
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

      // SI ES BOTELLA, ACTUALIZAR FIREBASE FIRESTORE
      // TEMPORAL: Fuerza botella a true para pruebas manuales con curl
      if (parsed.botella || true) {
        await this.incrementarConteoBotella('MQ-ECO-01');
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
      const db = getFirestore();
      
      // 1. Obtener la sesión activa más reciente de la máquina
      const sesionesRef = db.collection('sesiones_reciclaje');
      const snapshot = await sesionesRef
        .where('maquina_id', '==', machineId)
        .orderBy('fecha', 'desc')
        .limit(1)
        .get();

      if (snapshot.empty) {
        console.warn(`[WARNING] Se detectó una botella pero no hay una sesión reciente para la máquina ${machineId}.`);
        return;
      }

      const doc = snapshot.docs[0];
      
      // 2. Incrementar el conteo de botellas y puntos
      await doc.ref.update({
        botellas: FieldValue.increment(1),
        puntos: FieldValue.increment(0.1)
      });

      console.log(`[INFO] Botella registrada en sesión ${doc.id}. Conteo y puntos actualizados en Firestore.`);
    } catch (error) {
      console.error(`[ERROR] Fallo al actualizar Firebase Firestore:`, error);
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
