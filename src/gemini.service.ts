import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DetectionResult } from './app.service';

type GeminiVerdict = {
  botella: boolean;
  objeto: string;
  confianza: 'alta' | 'media' | 'baja';
};

const CONFIDENCE_MAP: Record<GeminiVerdict['confianza'], number> = {
  alta: 0.9,
  media: 0.6,
  baja: 0.3,
};

const PROMPT = `Eres el sistema de vision de una maquina recicladora de botellas de plastico.
Analiza la imagen y determina si hay una botella de plastico (PET) frente a la camara.

Reglas:
- "botella" es true SOLO si se ve una botella de plastico (puede estar parcialmente cortada por el borde de la imagen, aplastada, con o sin etiqueta, con o sin tapa).
- Latas, vasos, tazas, botellas de vidrio, manos, basura u otros objetos NO cuentan como botella.
- Si no hay ningun objeto frente a la camara (solo fondo, techo o pared), "botella" es false.

Responde UNICAMENTE con JSON con esta forma exacta:
{"botella": true|false, "objeto": "descripcion corta de lo que se ve", "confianza": "alta"|"media"|"baja"}`;

@Injectable()
export class GeminiService {
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(configService: ConfigService) {
    this.apiKey = configService.get<string>('GEMINI_API_KEY') || undefined;
    this.model = configService.get<string>('GEMINI_MODEL') || 'gemini-2.5-flash';
    this.timeoutMs = parseInt(configService.get<string>('GEMINI_TIMEOUT_MS') ?? '15000', 10);
    console.log(`[Gemini] ${this.isEnabled() ? `habilitado (modelo=${this.model})` : 'deshabilitado: falta GEMINI_API_KEY'}`);
  }

  isEnabled(): boolean {
    return !!this.apiKey;
  }

  async detect(buffer: Buffer, mimeType = 'image/jpeg'): Promise<DetectionResult> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY no configurada');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`;
    const body = {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: mimeType, data: buffer.toString('base64') } },
            { text: PROMPT },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new Error(`Gemini respondio ${res.status}: ${detail}`);
      }

      const data = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini no devolvio contenido');
      }

      const verdict = JSON.parse(text) as GeminiVerdict;
      if (typeof verdict.botella !== 'boolean') {
        throw new Error(`Respuesta de Gemini sin campo "botella": ${text.slice(0, 200)}`);
      }

      return {
        botella: verdict.botella,
        detected_objects: [
          {
            name: verdict.objeto ?? 'desconocido',
            confidence: CONFIDENCE_MAP[verdict.confianza] ?? 0.5,
          },
        ],
        source: 'gemini',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
