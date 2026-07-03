import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private database: admin.database.Database | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const serviceAccountPath = this.configService.get<string>('FIREBASE_SERVICE_ACCOUNT_PATH');

    try {
      if (serviceAccountPath) {
        const serviceAccount = require(serviceAccountPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          databaseURL: `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`,
        });
      } else {
        admin.initializeApp({
          credential: admin.credential.applicationDefault(),
          databaseURL: this.configService.get<string>('FIREBASE_DATABASE_URL'),
        });
      }
      this.database = admin.database();
      this.logger.log('Firebase conectado a Realtime Database');
    } catch (e) {
      this.logger.warn(`Firebase no disponible: ${(e as Error).message}. Las detecciones no se persistirán.`);
    }
  }

  private checkDb() {
    if (!this.database) {
      throw new Error('Firebase no inicializado. Revisa FIREBASE_SERVICE_ACCOUNT_PATH en .env');
    }
  }

  async getActiveSession(machineId: string): Promise<string | null> {
    this.checkDb();
    const snap = await this.database!.ref(`maquinas/${machineId}/sesion_activa`).once('value');
    return snap.val() as string | null;
  }

  async incrementBottleCount(sessionId: string): Promise<number> {
    this.checkDb();
    const ref = this.database!.ref(`sessions/${sessionId}/botellas/count`);
    const result = await ref.transaction((current) => (current ?? 0) + 1);
    return (result.snapshot.val() as number) ?? 0;
  }

  async setBotellaState(sessionId: string, botella: boolean) {
    this.checkDb();
    const ref = this.database!.ref(`sessions/${sessionId}/botellas/lastResult`);
    await ref.set({
      botella,
      timestamp: Date.now(),
    });
  }

  async setFirstValidation(sessionId: string, esBotella: boolean, machineId: string) {
    this.checkDb();
    const ref = this.database!.ref(`sessions/${sessionId}`);
    await ref.update({
      validacion1: { esBotella, machineId, timestamp: Date.now() },
      validacion2: null,
    });
  }

  async setActiveSession(machineId: string, sessionId: string) {
    this.checkDb();
    await this.database!.ref(`maquinas/${machineId}/sesion_activa`).set(sessionId);
  }

  async setGateCommand(machineId: string, openOuter: boolean, sessionId: string) {
    this.checkDb();
    await this.database!.ref(`maquinas/${machineId}/gate_command`).set({ openOuter, sessionId });
  }

  async getGateCommand(machineId: string): Promise<{ openOuter: boolean; sessionId: string } | null> {
    this.checkDb();
    const ref = this.database!.ref(`maquinas/${machineId}/gate_command`);
    const snap = await ref.once('value');
    const val = snap.val();
    if (!val) return null;
    await ref.remove();
    return val as { openOuter: boolean; sessionId: string };
  }

  async setSecondValidation(sessionId: string, esBotella: boolean, machineId: string) {
    this.checkDb();
    await this.database!.ref(`sessions/${sessionId}/validacion2`).set({
      esBotella,
      machineId,
      timestamp: Date.now(),
    });
  }

  async clearMachineSession(machineId: string) {
    this.checkDb();
    await this.database!.ref(`maquinas/${machineId}`).update({
      sesion_activa: null,
      gate_command: null,
    });
  }

  async getSessionStatus(sessionId: string): Promise<{ validacion2?: any; botellas?: any } | null> {
    this.checkDb();
    const snap = await this.database!.ref(`sessions/${sessionId}`).once('value');
    return snap.val();
  }
}
