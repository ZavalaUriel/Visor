# Documentación del Proyecto Argus (Detección de Botellas con YOLO)

Este documento detalla el diseño, arquitectura, despliegue y uso de la API **Argus**, un servicio optimizado y ultra-rápido de reconocimiento de imágenes para detectar botellas plásticas mediante **YOLOv8** local.

---

## 1. Arquitectura del Sistema

El sistema está compuesto por dos componentes principales que se comunican de forma local:

```mermaid
graph TD
    Client[Cliente / Bruno / Frontend] -->|POST multipart/form-data| Nest[NestJS Backend (Puerto 3000)]
    Nest -->|POST octet-stream (Buffer)| YOLO[YOLO Python Service (Puerto 8000)]
    YOLO -->|Inferencia YOLOv8n| YOLO
    YOLO -->|JSON: {botella: boolean}| Nest
    Nest -->|JSON: {botella: boolean}| Client
```

1. **Backend en NestJS (Puerta de Enlace):**
   - Recibe la imagen cargada por el usuario (`multipart/form-data`).
   - Envía el buffer binario directo de la imagen al microservicio de YOLO.
   - Valida, filtra y responde al cliente final.
2. **Servicio YOLO (Python HTTP):**
   - Levanta un servidor web ultra-ligero utilizando la biblioteca nativa `http.server`.
   - Mantiene en memoria el modelo de detección `yolov8n.pt` para realizar inferencias de forma inmediata (~20-50ms por imagen).
   - Analiza la imagen y detiene su búsqueda en cuanto detecta una botella (optimizando el rendimiento).

---

## 2. Documentación de la API

### Detectar Botella
Determina de forma rápida si una imagen enviada contiene una botella plástica.

* **URL:** `http://localhost:3000/detect`
* **Método:** `POST`
* **Content-Type:** `multipart/form-data`

#### Parámetros del Formulario (Body):
| Campo | Tipo | Requerido | Descripción |
| :--- | :--- | :--- | :--- |
| `image` | `File` (Imagen) | Sí | El archivo de imagen (JPEG, PNG, WEBP, etc.) que se desea analizar. |

#### Ejemplo de Respuesta Exitosa (201 Created):
```json
{
  "botella": true
}
```

#### Respuestas de Error:
* **400 Bad Request:** Si la imagen no fue provista o el formato multipart no es válido.
  ```json
  {
    "message": "No se recibio el archivo de imagen.",
    "error": "Bad Request",
    "statusCode": 400
  }
  ```
* **500 Internal Server Error:** Si el servicio YOLO en Python está apagado o inaccesible.
  ```json
  {
    "message": "No se pudo conectar al servicio YOLO...",
    "error": "Internal Server Error",
    "statusCode": 500
  }
  ```

---

## 3. Guía de Ejecución

### Despliegue con Docker Compose (Recomendado - Un solo comando)
Asegúrate de estar en el directorio raíz de `Argus` y ejecuta:

```bash
docker compose up --build
```
Este comando construirá automáticamente las imágenes, descargará el modelo de YOLOv8 y levantará la aplicación interconectada en los puertos `3000` (NestJS) y `8000` (YOLO).

### Despliegue Local (Sin Docker)

1. **Requisitos de Python (Servicio YOLO):**
   Instala las dependencias necesarias:
   ```bash
   pip install ultralytics Pillow
   ```
   Inicia el servicio de inferencia:
   ```bash
   python3 yolo_service.py
   ```

2. **Requisitos de Node (NestJS Backend):**
   Instala las dependencias del servidor:
   ```bash
   npm install
   ```
   Inicia el backend en modo desarrollo:
   ```bash
   npm run start:dev
   ```

---

## 4. Colección de Bruno (OpenCollection)

El proyecto incluye una carpeta de integración con **Bruno** utilizando el formato nativo YAML (`OpenCollection`).

* **Ruta de la colección:** `.bruno/Arguus/`
* **Archivo de petición:** `.bruno/Arguus/detec.yml`
* **Configuración del cuerpo (Body):**
  Está preconfigurado para realizar un envío de tipo `multipart-form` usando el campo `image` y apuntando a una imagen física de prueba (`descarga.jpeg` en la raíz del proyecto) mediante su ruta absoluta.

Para probar la API:
1. Abre Bruno.
2. Abre la colección seleccionando la carpeta `.bruno/Arguus`.
3. Selecciona la petición `detec` y presiona **Enviar**.

---

## 5. Pruebas y Validación

La suite de pruebas valida la lógica del controlador y el flujo de integración de forma aislada (sin necesidad de tener encendido el servicio de Python durante los tests):

* **Ejecutar Pruebas Unitarias:**
  ```bash
  npm run test
  ```
* **Ejecutar Pruebas E2E (Integración):**
  ```bash
  npm run test:e2e
  ```
