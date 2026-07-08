#!/usr/bin/env python3
import sys
import io
import json
import os
import time
import numpy as np
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    from PIL import Image, ImageEnhance, ImageOps
except ImportError:
    print("Error: PIL (Pillow) is not installed. Please run: pip install Pillow")
    sys.exit(1)

try:
    from ultralytics import YOLO
except ImportError:
    print("Error: ultralytics is not installed. Please run: pip install ultralytics")
    sys.exit(1)

PORT = int(os.environ.get("YOLO_PORT", 8000))
MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "yolov8s.pt")
CONF_THRESHOLD = float(os.environ.get("YOLO_CONF_THRESHOLD", "0.15"))

# Solo botella (clase 39 de COCO)
BOTTLE_CLASSES = {39, 40, 41}

print(f"Cargando modelo YOLO desde '{MODEL_PATH}'...")
try:
    model = YOLO(MODEL_PATH)
    print("Modelo YOLO cargado exitosamente.")
    print(f"Clases aceptadas como botella: {[model.names[c] for c in BOTTLE_CLASSES]}")
except Exception as e:
    print(f"Error al cargar el modelo YOLO: {e}")
    print("Se intentará descargar 'yolov8n.pt' automáticamente.")
    try:
        model = YOLO("yolov8n.pt")
        print("Modelo yolov8n.pt cargado exitosamente.")
    except Exception as e2:
        print(f"No se pudo cargar ningún modelo: {e2}")
        sys.exit(1)


def preprocess_image(pil_image: Image.Image) -> np.ndarray:
    img = pil_image.convert("RGB")
    arr = np.array(img).astype(np.float32)
    avg_brightness = arr.mean()

    if max(img.size) > 1280:
        ratio = 1280 / max(img.size)
        new_size = (int(img.width * ratio), int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    if avg_brightness < 50:
        gamma = max(0.15, avg_brightness / 100.0)
        arr = np.array(img).astype(np.float32)
        arr = ((arr / 255.0) ** gamma) * 255
        arr = np.clip(arr, 0, 255).astype(np.uint8)
        img = Image.fromarray(arr)
        img = ImageOps.autocontrast(img, cutoff=2)
        img = ImageEnhance.Sharpness(img).enhance(1.5)
    else:
        img = ImageEnhance.Brightness(img).enhance(1.1)
        img = ImageEnhance.Sharpness(img).enhance(1.2)

    return np.array(img)


class YoloRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        sys.stdout.write("%s - - [%s] %s\n" %
                         (self.address_string(),
                          self.log_date_time_string(),
                          format % args))

    def do_POST(self):
        if self.path == "/detect":
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length == 0:
                    self.send_error_response(400, "Cuerpo de solicitud vacío")
                    return

                image_bytes = self.rfile.read(content_length)

                debug_dir = os.path.join(os.path.dirname(__file__), "debug_images")
                os.makedirs(debug_dir, exist_ok=True)
                debug_path = os.path.join(debug_dir, f"yolo_{int(time.time())}.jpg")
                with open(debug_path, "wb") as f:
                    f.write(image_bytes)
                print(f"[YOLO DEBUG] Imagen guardada: {debug_path} ({len(image_bytes)} bytes)")

                pil_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                img_array = preprocess_image(pil_image)

                results = model(img_array, verbose=False, conf=CONF_THRESHOLD)
                class_names = model.names
                botella = False

                detected_objects = []
                for r in results:
                    for box in r.boxes:
                        cls_id = int(box.cls[0])
                        conf = float(box.conf[0])
                        name = class_names.get(cls_id, "").lower()
                        detected_objects.append({"name": name, "confidence": conf})

                        if cls_id in BOTTLE_CLASSES:
                            botella = True

                response_data = {
                    "botella": botella,
                    "detected_objects": detected_objects
                }

                response_bytes = json.dumps(response_data).encode('utf-8')
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response_bytes)))
                self.end_headers()
                self.wfile.write(response_bytes)

            except Exception as e:
                self.send_error_response(500, f"Error interno: {str(e)}")
        else:
            self.send_error_response(404, "Ruta no encontrada")

    def send_error_response(self, code, message):
        response_data = {"error": message}
        response_bytes = json.dumps(response_data).encode('utf-8')
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)


def run():
    server_address = ('', PORT)
    httpd = HTTPServer(server_address, YoloRequestHandler)
    print(f"Servidor HTTP de YOLO escuchando en http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nApagando servidor YOLO...")
        httpd.server_close()


if __name__ == "__main__":
    run()
