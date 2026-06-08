import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppService } from './../src/app.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  const mockDetectionResult = {
    botella: true,
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AppService)
      .useValue({
        detectFromBuffer: jest.fn().mockResolvedValue(mockDetectionResult),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/detect (POST)', () => {
    return request(app.getHttpServer())
      .post('/detect')
      .attach('image', Buffer.from('mockImageBuffer'), 'test.jpg')
      .expect(201)
      .expect(mockDetectionResult);
  });

  afterEach(async () => {
    await app.close();
  });
});

