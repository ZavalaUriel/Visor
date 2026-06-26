import {
  BadRequestException,
  Controller,
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

    // Guardar la foto físicamente para depuración/validación visual
    try {
      const debugDir = path.join(process.cwd(), 'debug_images');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      const filename = `captura_${Date.now()}.jpg`;
      const filePath = path.join(debugDir, filename);
      fs.writeFileSync(filePath, file.buffer);
      console.log(`[DEBUG] Imagen guardada en: ${filePath}`);
    } catch (err) {
      console.error(`[ERROR] No se pudo guardar la imagen de depuración: ${err}`);
    }

    return this.appService.detectFromBuffer(
      file.buffer,
      file.mimetype,
      file.originalname,
    );
  }
}
