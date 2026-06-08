# Guía de Integración: ESP32-CAM + Motor de Torque (Compuerta)

Esta guía explica cómo integrar un microcontrolador **ESP32-CAM** y un motor de torque (servo o servomotor de alto torque como el MG996R) con la API de **Argus** para automatizar la apertura de una compuerta al detectar una botella plástica.

---

## 1. Arquitectura Física y Conexiones

Dado que el ESP32 cuenta con pines GPIO y capacidades PWM, no requieres un Arduino adicional; puedes controlar el motor y la cámara directamente desde el ESP32-CAM.

```
       +-----------------------------------+
       |            ESP32-CAM              |
       |                                   |
       |  GPIO 12 (PWM) ----------------------- [ Señal (Naranja/Amarillo) ]
       |  5V ---------------------------------- [ VCC (Rojo) ]*
       |  GND --------------------------------- [ GND (Negro/Marrón) ]
       +-----------------------------------+               |
                                                           |
                                                [ Motor de Torque / Servo ]
```

> [!CAUTION]
> *Los motores de torque como el **MG996R** consumen mucha corriente al moverse. No los alimentes directamente desde el pin de 5V del ESP32-CAM, ya que causará caídas de tensión y reinicios en la cámara. Utiliza una fuente de alimentación externa de 5V-6V dedicada para el motor y une la tierra (GND) de la fuente con la del ESP32-CAM.*

---

## 2. Firmware del ESP32-CAM (Arduino IDE)

### Requisitos en Arduino IDE:
1. Instalar el soporte de placas ESP32 en *Gestor de tarjetas*.
2. Instalar la librería **ArduinoJson** (por Benoît Blanchon) desde el *Gestor de librerías* si deseas un parseo estricto del JSON.

### Código Fuente (C++):
Copia y carga el siguiente código en tu ESP32-CAM:

```cpp
#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ESP32Servo.h> // Librería para control de servo en ESP32

// Configuración de Red WiFi
const char* ssid = "TU_SSID_WIFI";
const char* password = "TU_CONTRASEÑA_WIFI";

// Dirección IP del servidor Argus (NestJS)
const char* serverUrl = "http://192.168.1.50:3000/detect"; 

// Pines de la cámara (Configuración estándar AI-Thinker)
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// Configuración del Motor
Servo compuertaServo;
const int servoPin = 12; // Pin de señal del motor de torque
const int anguloCerrado = 0;
const int anguloAbierto = 90;

void setup() {
  Serial.begin(115200);
  
  // Inicializar Servomotor
  compuertaServo.attach(servoPin);
  compuertaServo.write(anguloCerrado); // Iniciar compuerta cerrada

  // Configurar Cámara
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  
  // Calidad y tamaño de imagen (resolución moderada para rapidez)
  config.frame_size = FRAMESIZE_QVGA; // 320x240 para procesado rápido
  config.jpeg_quality = 12; 
  config.fb_count = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Error al iniciar la cámara: 0x%x", err);
    return;
  }

  // Conectar a WiFi
  WiFi.begin(ssid, password);
  Serial.print("Conectando a WiFi...");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Conectado!");
}

void loop() {
  // En tu lógica final, esto puede activarse con un botón o sensor de presencia infrarrojo
  delay(5000); 
  detectarYProcesar();
}

void detectarYProcesar() {
  Serial.println("Capturando fotografía...");
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("Fallo al capturar imagen");
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);

    // Definición de límites del protocolo Multipart/form-data
    String boundary = "ESP32CAMBoundary";
    http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);

    // Construcción del encabezado de la sección del archivo
    String header = "--" + boundary + "\r\n";
    header += "Content-Disposition: form-data; name=\"image\"; filename=\"capture.jpg\"\r\n";
    header += "Content-Type: image/jpeg\r\n\r\n";

    // Construcción de la sección final
    String footer = "\r\n--" + boundary + "--\r\n";

    // Longitud total del cuerpo del HTTP Request
    int totalLength = header.length() + fb->len + footer.length();

    // Enviar el request completo
    int httpResponseCode = http.sendRequest("POST", (uint8_t*)header.c_str(), header.length(), fb->buf, fb->len, (uint8_t*)footer.c_str(), footer.length());

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.println("Código HTTP de respuesta: " + String(httpResponseCode));
      Serial.println("Respuesta del servidor: " + response);

      // Evaluar la respuesta rápida buscando si contiene "botella":true
      if (response.indexOf("\"botella\":true") != -1) {
        Serial.println("¡Botella detectada! Abriendo compuerta...");
        abrirCompuerta();
      } else {
        Serial.println("No se detectó botella.");
      }
    } else {
      Serial.print("Error en el envío POST HTTP: ");
      Serial.println(httpResponseCode);
    }
    http.end();
  }
  
  // Liberar el buffer de la cámara
  esp_camera_fb_return(fb);
}

void abrirCompuerta() {
  compuertaServo.write(anguloAbierto); // Mover motor para abrir
  delay(3000);                          // Esperar 3 segundos para que caiga la botella
  compuertaServo.write(anguloCerrado); // Regresar motor para cerrar
}
```

---

## 3. Flujo de Funcionamiento
1. **Detección:** El ESP32-CAM captura un frame en formato JPEG.
2. **Envío:** Envía la imagen mediante un POST estructurado como `multipart/form-data` al backend de **Argus** en tu computadora (ej. `http://192.168.1.50:3000/detect`).
3. **Inferencia:** NestJS delega la imagen a YOLOv8, que determina en milisegundos si es una botella (`{"botella":true}`) o no (`{"botella":false}`).
4. **Acción:** Si la respuesta contiene `"botella":true`, el ESP32 activa la señal PWM en el pin 12 moviendo el motor de torque a 90° para abrir la compuerta, espera 3 segundos y la vuelve a cerrar.
