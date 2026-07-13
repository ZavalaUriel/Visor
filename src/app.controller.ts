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
import { FileInterceptor } from '@nestjs/platform-express';
import { AppService } from './app.service';

type UploadedImage = {
  buffer: Buffer;
  mimetype: string;
  originalname?: string;
};

// Límite de tamaño para imágenes subidas (evita agotar memoria/disco)
const IMAGE_UPLOAD_LIMITS = { limits: { fileSize: 10 * 1024 * 1024, files: 1 } };

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('detect')
  @UseInterceptors(FileInterceptor('image', IMAGE_UPLOAD_LIMITS))
  async detect(@UploadedFile() file?: UploadedImage) {
    if (!file?.buffer) {
      throw new BadRequestException('No se recibio el archivo de imagen.');
    }

    return this.appService.detectFromBuffer(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }

  @Post('machine-detect')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('image', IMAGE_UPLOAD_LIMITS))
  async machineDetect(
    @UploadedFile() file?: UploadedImage,
    @Headers('x-machine-id') machineId?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No se recibio el archivo de imagen.');
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

  @Post('machine-cleanup/:machineId')
  @HttpCode(200)
  async machineCleanup(@Param('machineId') machineId: string) {
    return this.appService.clearMachineSession(machineId);
  }

  @Get('session-status/:sessionId')
  async getSessionStatus(@Param('sessionId') sessionId: string) {
    const status = await this.appService.getSessionStatus(sessionId);
    return status ?? {};
  }
}
