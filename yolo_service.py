#!/usr/bin/env python3
import sys
import io
import json
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    from PIL import Image
except ImportError:
    print("Error: PIL (Pillow) is not installed. Please run: pip install Pillow")
    sys.exit(1)

try:
    from ultralytics import YOLO
except ImportError:
    print("Error: ultralytics is not installed. Please run: pip install ultralytics")
    sys.exit(1)

PORT = int(os.environ.get("YOLO_PORT", 8000))
MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "yolov8n.pt")

print(f"Cargando modelo YOLO desde '{MODEL_PATH}'...")
try:
    model = YOLO(MODEL_PATH)
    print("Modelo YOLO cargado exitosamente.")
except Exception as e:
    print(f"Error al cargar el modelo YOLO: {e}")
    print("Se intentará descargar 'yolov8n.pt' automáticamente.")
    try:
        model = YOLO("yolov8n.pt")
        print("Modelo yolov8n.pt cargado exitosamente.")
    except Exception as e2:
        print(f"No se pudo cargar ningún modelo: {e2}")
        sys.exit(1)

class YoloRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        sys.stdout.write("%s - - [%s] %s\n" %
                         (self.address_string(),
                          self.log_date_time_string(),
                          format%args))

    def do_POST(self):
        if self.path == "/detect":
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length == 0:
                    self.send_error_response(400, "Cuerpo de solicitud vacío")
                    return

                image_bytes = self.rfile.read(content_length)
                image = Image.open(io.BytesIO(image_bytes))
                results = model(image, verbose=False)
                class_names = model.names
                botella = False

                for r in results:
                    for box in r.boxes:
                        cls_id = int(box.cls[0])
                        name = class_names.get(cls_id, "").lower()
                        
                        if name in ["botella", "bottle"]:
                            botella = True
                            break
                    if botella:
                        break
                
                response_data = {
                    "botella": botella
                }

                response_bytes = json.dumps(response_data).encode('utf-8')
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response_bytes)))
                self.end_headers()
                self.wfile.write(response_bytes)

            except Exception as e:
                self.send_error_response(500, f"Error interno en la inferencia: {str(e)}")
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

