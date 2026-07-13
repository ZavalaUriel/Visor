import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import { createSign } from 'crypto';

type ServiceAccount = {
  client_email: string;
  private_key: string;
  private_key_id?: string;
  token_uri: string;
};

const OAUTH_SCOPES =
  'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private dbBaseUrl: string = '';
  private serviceAccount: ServiceAccount | null = null;
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const url = this.configService.get<string>('FIREBASE_DATABASE_URL');
    if (url) {
      this.dbBaseUrl = url.replace(/\/+$/, '');
      this.logger.log(`Firebase REST endpoint: ${this.dbBaseUrl}`);
    } else {
      this.logger.warn('FIREBASE_DATABASE_URL no configurada. Firebase no disponible.');
    }
    this.loadServiceAccount();
  }

  /**
   * Carga la cuenta de servicio para autenticar las llamadas a Realtime Database.
   * Con esto las reglas de la base pueden dejar de ser públicas.
   * Si no hay clave válida se sigue en modo sin autenticación (desarrollo).
   */
  private loadServiceAccount() {
    const path =
      this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH') ??
      'firebase-service-account.json';
    try {
      const raw = fs.readFileSync(path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
      if (
        parsed.client_email &&
        parsed.private_key?.startsWith('-----BEGIN') &&
        parsed.token_uri
      ) {
        this.serviceAccount = parsed as ServiceAccount;
        this.logger.log(`Firebase autenticado como ${parsed.client_email}`);
      } else {
        this.logger.warn(
          `${path} no contiene una clave de servicio válida (¿placeholder?). Las llamadas a Firebase irán SIN autenticar.`,
        );
      }
    } catch {
      this.logger.warn(
        `No se pudo leer ${path}. Las llamadas a Firebase irán SIN autenticar.`,
      );
    }
  }

  /** Obtiene (y cachea) un access token OAuth2 firmando un JWT con la cuenta de servicio. */
  private async getAccessToken(): Promise<string | null> {
    if (!this.serviceAccount) return null;
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && now < this.tokenExpiresAt - 60) {
      return this.accessToken;
    }

    try {
      const header = Buffer.from(
        JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: this.serviceAccount.private_key_id }),
      ).toString('base64url');
      const claims = Buffer.from(
        JSON.stringify({
          iss: this.serviceAccount.client_email,
          scope: OAUTH_SCOPES,
          aud: this.serviceAccount.token_uri,
          iat: now,
          exp: now + 3600,
        }),
      ).toString('base64url');
      const signer = createSign('RSA-SHA256');
      signer.update(`${header}.${claims}`);
      const signature = signer.sign(this.serviceAccount.private_key, 'base64url');
      const assertion = `${header}.${claims}.${signature}`;

      const res = await fetch(this.serviceAccount.token_uri, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
      if (!res.ok) {
        this.logger.warn(
          `No se pudo obtener access token (HTTP ${res.status}). ` +
            'Si el error es "Invalid JWT Signature", la clave de servicio fue revocada: generar una nueva en Firebase Console.',
        );
        return null;
      }
      const data = (await res.json()) as { access_token: string; expires_in: number };
      this.accessToken = data.access_token;
      this.tokenExpiresAt = now + (data.expires_in ?? 3600);
      return this.accessToken;
    } catch (e) {
      this.logger.warn(`Error obteniendo access token: ${(e as Error).message}`);
      return null;
    }
  }

  private async restRequest(method: string, path: string, body?: any): Promise<any> {
    const url = `${this.dbBaseUrl}${path}.json`;
    const token = await this.getAccessToken();
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const client = urlObj.protocol === 'https:' ? https : http;
      const headers: Record<string, string> = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const options: https.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
        timeout: 10000,
      };
      const req = client.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Firebase respondió HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
            return;
          }
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
