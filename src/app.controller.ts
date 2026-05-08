import {
  BadRequestException,
  Controller,
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

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post('detect')
  @UseInterceptors(FileInterceptor('image'))
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
}
