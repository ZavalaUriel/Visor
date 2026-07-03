import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';

type UploadedImage = {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
};

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('detect')
  @UseInterceptors(FileInterceptor('image'))
  async detect(@UploadedFile() file?: UploadedImage) {
    if (!file?.buffer) {
      throw new BadRequestException('No se recibio el archivo de imagen.');
    }

    try {
      const debugDir = path.join(process.cwd(), 'debug_images');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const filename = `captura_${Date.now()}.jpg`;
      const filePath = path.join(debugDir, filename);
      fs.writeFileSync(filePath, file.buffer);
    } catch (err) {
      console.error(`[ERROR] No se pudo guardar la imagen de depuración: ${err}`);
    }

    return this.appService.detectFromBuffer(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }

  @Post('machine-detect')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('image'))
  async machineDetect(
    @UploadedFile() file?: UploadedImage,
    @Headers('x-machine-id') machineId?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No se recibio el archivo de imagen.');
    }

    // Guardar imagen de depuración
    try {
      const debugDir = path.join(process.cwd(), 'debug_images');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const filename = `esp32_${Date.now()}.jpg`;
      const filePath = path.join(debugDir, filename);
      fs.writeFileSync(filePath, file.buffer);
    } catch (err) {
      console.error(`[ERROR] No se pudo guardar imagen ESP32: ${err}`);
    }

    const id = machineId ?? 'machine_001';

    return this.appService.detectFromBufferWithSession(file.buffer, id);
  }

  @Get('active-session/:machineId')
  async getActiveSession(@Param('machineId') machineId: string) {
    const sessionId = await this.appService.getActiveSession(machineId);
    return { sessionId };
  }

  @Post('machine-validate')
  @HttpCode(200)
  async machineValidate(@Body() body: { sessionId: string; machineId: string; esBotella: boolean }) {
    if (!body.sessionId || !body.machineId) {
      throw new BadRequestException('sessionId y machineId son requeridos');
    }
    return this.appService.validateFirstValidation(
      body.sessionId,
      body.machineId,
      body.esBotella ?? true,
    );
  }

  @Get('gate-command/:machineId')
  async getGateCommand(@Param('machineId') machineId: string) {
    const cmd = await this.appService.getGateCommand(machineId);
    if (!cmd) return { openOuter: false };
    return cmd;
  }

  @Post('machine-confirm')
  @HttpCode(200)
  async machineConfirm(@Body() body: { sessionId: string; machineId: string; esBotella: boolean }) {
    if (!body.sessionId || !body.machineId) {
      throw new BadRequestException('sessionId y machineId son requeridos');
    }
    return this.appService.confirmMachineDetection(
      body.sessionId,
      body.machineId,
      body.esBotella,
    );
  }

  @Get('session-status/:sessionId')
  async getSessionStatus(@Param('sessionId') sessionId: string) {
    const status = await this.appService.getSessionStatus(sessionId);
    return status ?? {};
  }
}
