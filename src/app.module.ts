import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { FirebaseService } from './firebase.service';
import { GeminiService } from './gemini.service';
import { MachineKeyGuard } from './machine-key.guard';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [AppController],
  providers: [
    AppService,
    FirebaseService,
    GeminiService,
    { provide: APP_GUARD, useClass: MachineKeyGuard },
  ],
})
export class AppModule {}
