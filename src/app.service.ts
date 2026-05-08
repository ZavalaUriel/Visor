import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { extname } from 'node:path';

export type DetectionResult = {
  botella: boolean;
  taparrosca: boolean;
  etiqueta: boolean;
  confianza: number;
};

@Injectable()
export class AppService {
  private readonly model;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') ?? '';
    const modelName =
      this.configService.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash';

    this.model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: modelName,
      systemInstruction:
        'Responde solo con JSON puro y sin texto adicional. Usa las llaves: botella, taparrosca, etiqueta, confianza.',
    });
  }

  async detectFromBuffer(
    buffer: Buffer,
    mimeType: string,
    filename?: string,
  ): Promise<DetectionResult> {
    if (!this.configService.get<string>('GEMINI_API_KEY')) {
      throw new BadRequestException('Falta GEMINI_API_KEY en el entorno.');
    }

    const prompt =
      'Analiza la imagen y responde con un JSON puro.\n' +
      'El JSON debe ser estrictamente: {"botella": boolean, "taparrosca": boolean, "etiqueta": boolean, "confianza": number}.\n' +
      'No incluyas texto adicional ni markdown.';

    const safeMimeType = this.normalizeMimeType(mimeType, filename);
    const result = await this.generateWithRetry({
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
        maxOutputTokens: 256,
      },
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: buffer.toString('base64'),
                mimeType: safeMimeType,
              },
            },
          ],
        },
      ],
    });

    const rawText = result.response.text();
    const jsonText = this.stripJsonFence(rawText);
    const parsed = this.safeJsonParse(jsonText);
    if (!this.isDetectionResult(parsed)) {
      throw new BadRequestException(
        'La respuesta del modelo no tiene el formato esperado.',
      );
    }

    return parsed;
  }

  private stripJsonFence(text: string): string {
    const trimmed = text.trim();
    if (trimmed.startsWith('```')) {
      return trimmed
        .replace(/^```[a-zA-Z]*\n?/, '')
        .replace(/```$/, '')
        .trim();
    }

    return trimmed;
  }

  private safeJsonParse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      throw new BadRequestException('El modelo no devolvio JSON valido.');
    }
  }

  private isDetectionResult(value: unknown): value is DetectionResult {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const record = value as Record<string, unknown>;
    return (
      typeof record.botella === 'boolean' &&
      typeof record.taparrosca === 'boolean' &&
      typeof record.etiqueta === 'boolean' &&
      typeof record.confianza === 'number'
    );
  }

  private normalizeMimeType(mimeType: string, filename?: string): string {
    if (mimeType && mimeType !== 'application/octet-stream') {
      return mimeType;
    }

    const extension = filename ? extname(filename).toLowerCase() : '';
    switch (extension) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.png':
        return 'image/png';
      case '.webp':
        return 'image/webp';
      case '.gif':
        return 'image/gif';
      default:
        return 'image/jpeg';
    }
  }

  private async generateWithRetry(request: Parameters<typeof this.model.generateContent>[0]) {
    const maxAttempts = 3;
    let attempt = 0;
    let delayMs = 400;

    while (true) {
      try {
        return await this.model.generateContent(request);
      } catch (error) {
        const status = (error as { status?: number })?.status;
        attempt += 1;
        if (status !== 503 || attempt >= maxAttempts) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs *= 2;
      }
    }
  }
}
