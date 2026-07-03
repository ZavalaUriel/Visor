import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as http from 'http';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private dbBaseUrl: string = '';

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('FIREBASE_DATABASE_URL');
    if (url) {
      this.dbBaseUrl = url.replace(/\/+$/, '');
      this.logger.log(`Firebase REST endpoint: ${this.dbBaseUrl}`);
    } else {
      this.logger.warn('FIREBASE_DATABASE_URL no configurada. Firebase no disponible.');
    }
  }

  private async restRequest(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.dbBaseUrl}${path}.json`;
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;
      const options: https.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        timeout: 10000,
      };
      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(data ? JSON.parse(data) : null);
          } catch {
            resolve(data);
          }
        });
      });
      req.on('error', (err) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async getActiveSession(machineId: string): Promise<string | null> {
    try {
      return await this.restRequest('GET', `/maquinas/${machineId}/sesion_activa`);
    } catch { return null; }
  }

  async incrementBottleCount(sessionId: string): Promise<number> {
    try {
      const current: number | null = await this.restRequest('GET', `/sessions/${sessionId}/botellas/count`);
      const newCount = (current ?? 0) + 1;
      await this.restRequest('PUT', `/sessions/${sessionId}/botellas/count`, newCount);
      return newCount;
    } catch { return 0; }
  }

  async setBotellaState(sessionId: string, botella: boolean) {
    try {
      await this.restRequest('PUT', `/sessions/${sessionId}/botellas/lastResult`, {
        botella, timestamp: Date.now(),
      });
    } catch (e) {
      this.logger.warn(`setBotellaState error: ${(e as Error).message}`);
    }
  }

  async setFirstValidation(sessionId: string, esBotella: boolean, machineId: string) {
    try {
      await this.restRequest('PATCH', `/sessions/${sessionId}`, {
        validacion1: { esBotella, machineId, timestamp: Date.now() },
        validacion2: null,
      });
    } catch (e) {
      this.logger.warn(`setFirstValidation error: ${(e as Error).message}`);
      throw e;
    }
  }

  async setActiveSession(machineId: string, sessionId: string) {
    try {
      await this.restRequest('PUT', `/maquinas/${machineId}/sesion_activa`, sessionId);
    } catch (e) {
      this.logger.warn(`setActiveSession error: ${(e as Error).message}`);
      throw e;
    }
  }

  async setGateCommand(machineId: string, openOuter: boolean, sessionId: string) {
    try {
      await this.restRequest('PUT', `/maquinas/${machineId}/gate_command`, { openOuter, sessionId });
    } catch (e) {
      this.logger.warn(`setGateCommand error: ${(e as Error).message}`);
      throw e;
    }
  }

  async getGateCommand(machineId: string): Promise<{ openOuter: boolean; sessionId: string } | null> {
    try {
      const val = await this.restRequest('GET', `/maquinas/${machineId}/gate_command`);
      if (!val) return null;
      await this.restRequest('DELETE', `/maquinas/${machineId}/gate_command`);
      return val as { openOuter: boolean; sessionId: string };
    } catch { return null; }
  }

  async setSecondValidation(sessionId: string, esBotella: boolean, machineId: string) {
    try {
      await this.restRequest('PUT', `/sessions/${sessionId}/validacion2`, {
        esBotella, machineId, timestamp: Date.now(),
      });
    } catch (e) {
      this.logger.warn(`setSecondValidation error: ${(e as Error).message}`);
      throw e;
    }
  }

  async clearMachineSession(machineId: string) {
    try {
      await this.restRequest('PATCH', `/maquinas/${machineId}`, {
        sesion_activa: null,
        gate_command: null,
      });
    } catch (e) {
      this.logger.warn(`clearMachineSession error: ${(e as Error).message}`);
      throw e;
    }
  }

  async getSessionStatus(sessionId: string): Promise<any> {
    try {
      return await this.restRequest('GET', `/sessions/${sessionId}`);
    } catch { return null; }
  }
}
