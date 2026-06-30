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
}
