import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FirebaseService } from './firebase.service';
import * as http from 'http';

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
    const host = this.configService.get<string>('YOLO_HOST') ?? '172.18.0.2';
    console.log(`[YOLO] ConfigService host=${JSON.stringify(host)} port=${JSON.stringify(port)}`);
    this.yoloUrl = `http://${host}:${port}/detect`;
  }

  async detectFromBuffer(
    buffer: Buffer,
    _mimeType?: string,
    _filename?: string,
  ): Promise<DetectionResult> {
    try {
      const result = await new Promise<DetectionResult>((resolve, reject) => {
        const urlObj = new URL(this.yoloUrl);
        const options: http.RequestOptions = {
          hostname: urlObj.hostname,
          port: parseInt(urlObj.port, 10),
          path: urlObj.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': buffer.length,
          },
          timeout: 15000,
          family: 4,
          agent: false,
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                const parsed = JSON.parse(data);
                if (this.isDetectionResult(parsed)) {
                  resolve(parsed);
                } else {
                  reject(new BadRequestException('La respuesta del modelo YOLO no tiene el formato esperado.'));
                }
              } else {
                reject(new BadRequestException(`El servicio YOLO respondió con error (${res.statusCode}): ${data.slice(0, 200)}`));
              }
            } catch (e) {
              reject(new BadRequestException(`Error parseando respuesta YOLO: ${(e as Error).message}`));
            }
          });
        });

        req.on('error', (err: NodeJS.ErrnoException) => {
            console.error('[HTTP_ERROR] message=' + err.message + ' code=' + err.code + ' errno=' + err.errno + ' syscall=' + err.syscall);
            reject(err);
        });
        req.on('timeout', () => { console.error('[HTTP_TIMEOUT]'); req.destroy(); reject(new Error('Timeout')); });

        req.write(buffer);
        req.end();
      });

      return result;
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
      await this.firebase.setGateCommand(machineId, true, sessionId);
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

  async getGateCommand(machineId: string) {
    try {
      return await this.firebase.getGateCommand(machineId);
    } catch {
      return null;
    }
  }

  async confirmMachineDetection(
    sessionId: string,
    machineId: string,
    esBotella: boolean,
  ): Promise<{ success: boolean; count?: number }> {
    try {
      await this.firebase.setSecondValidation(sessionId, esBotella, machineId);
      if (esBotella) {
        const count = await this.firebase.incrementBottleCount(sessionId);
        console.log(`[Visor] Botella confirmada y contada. Sesión: ${sessionId}, Total: ${count}`);
        return { success: true, count };
      }
      return { success: true };
    } catch (e) {
      console.warn(`[Visor] Error registrando validación 2: ${(e as Error).message}`);
      return { success: false };
    }
  }

  async clearMachineSession(machineId: string): Promise<{ success: boolean }> {
    try {
      await this.firebase.clearMachineSession(machineId);
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  async getSessionStatus(sessionId: string) {
    try {
      return await this.firebase.getSessionStatus(sessionId);
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
