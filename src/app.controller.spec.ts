import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService, DetectionResult } from './app.service';
import { BadRequestException } from '@nestjs/common';

describe('AppController', () => {
  let appController: AppController;
  let appService: AppService;

  const mockDetectionResult: DetectionResult = {
    botella: true,
  };

  const mockAppService = {
    detectFromBuffer: jest.fn().mockResolvedValue(mockDetectionResult),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: mockAppService,
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
    appService = app.get<AppService>(AppService);
  });

  describe('detect', () => {
    it('should return detection result when a valid file is provided', async () => {
      const file = {
        buffer: Buffer.from('mockImageBuffer'),
        mimetype: 'image/jpeg',
        originalname: 'test.jpg',
      };

      const result = await appController.detect(file);

      expect(result).toEqual(mockDetectionResult);
      expect(appService.detectFromBuffer).toHaveBeenCalledWith(
        file.buffer,
        file.mimetype,
        file.originalname,
      );
    });

    it('should throw BadRequestException if no file is provided', async () => {
      await expect(appController.detect(undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if file has no buffer', async () => {
      const invalidFile = {
        buffer: undefined as unknown as Buffer,
        mimetype: 'image/jpeg',
      };

      await expect(appController.detect(invalidFile)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});

