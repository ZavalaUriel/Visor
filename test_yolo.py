from ultralytics import YOLO
import sys

model = YOLO("yolov8n.pt")
results = model("/home/zavalaw/Documentos/universidad/Visor/debug_images/captura_1782449371363.jpg")
for r in results:
    for box in r.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        name = model.names[cls_id]
        print(f"Detected: {name} (Confidence: {conf:.2f})")
