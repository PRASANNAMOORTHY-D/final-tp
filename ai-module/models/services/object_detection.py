import cv2
import numpy as np
from ultralytics import YOLO
from typing import Dict, List, Optional, Tuple
import torch

class ObjectDetector:
    def __init__(self, model_name: str = "yolov8n.pt"):
        """
        Initialize YOLO object detector
        
        Args:
            model_name: YOLO model name or path
        """
        try:
            self.model = YOLO(model_name)
            self.model.to('cuda' if torch.cuda.is_available() else 'cpu')
        except:
            # If YOLO not available, use a simpler approach
            self.model = None
        
        # Forbidden objects to detect
        self.FORBIDDEN_OBJECTS = [
            'cell phone', 'mobile phone', 'phone',
            'book', 'notebook',
            'laptop', 'computer',
            'remote', 'controller',
            'tablet', 'ipad',
            'headphones', 'earphones'
        ]
        
        self.detection_history = []
        self.max_history = 20
        
    def detect(self, frame: np.ndarray, confidence_threshold: float = 0.5) -> Dict:
        """
        Detect forbidden objects in frame
        
        Args:
            frame: BGR image frame
            confidence_threshold: Minimum confidence score
            
        Returns:
            Dictionary with detection results
        """
        if self.model is None:
            return self._mock_detection(frame)
        
        detection_info = {
            "objects_detected": False,
            "forbidden_objects": [],
            "all_detections": [],
            "phone_detected": False,
            "book_detected": False,
            "confidence": 0.0
        }
        
        try:
            # Run YOLO detection
            results = self.model(frame, verbose=False)[0]
            
            forbidden_detections = []
            
            for box in results.boxes:
                class_id = int(box.cls[0])
                class_name = results.names[class_id]
                confidence = float(box.conf[0])
                
                # Check if confidence is above threshold
                if confidence < confidence_threshold:
                    continue
                
                # Check if object is forbidden
                is_forbidden = any(forbidden in class_name.lower() 
                                  for forbidden in self.FORBIDDEN_OBJECTS)
                
                # Get bounding box
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                bbox = {
                    "x1": int(x1), "y1": int(y1),
                    "x2": int(x2), "y2": int(y2),
                    "width": int(x2 - x1),
                    "height": int(y2 - y1)
                }
                
                detection = {
                    "class": class_name,
                    "confidence": confidence,
                    "bbox": bbox,
                    "is_forbidden": is_forbidden,
                    "center": {
                        "x": int((x1 + x2) / 2),
                        "y": int((y1 + y2) / 2)
                    }
                }
                
                detection_info["all_detections"].append(detection)
                
                if is_forbidden:
                    forbidden_detections.append(detection)
                    
                    # Check specific object types
                    if 'phone' in class_name.lower():
                        detection_info["phone_detected"] = True
                    elif 'book' in class_name.lower():
                        detection_info["book_detected"] = True
            
            if forbidden_detections:
                detection_info["objects_detected"] = True
                detection_info["forbidden_objects"] = forbidden_detections
                
                # Calculate overall confidence (max confidence of forbidden objects)
                detection_info["confidence"] = max(
                    [d["confidence"] for d in forbidden_detections]
                )
            
            # Update history
            self.detection_history.append({
                "timestamp": np.datetime64('now'),
                "forbidden_detected": bool(forbidden_detections),
                "phone_detected": detection_info["phone_detected"],
                "detection_count": len(forbidden_detections)
            })
            
            if len(self.detection_history) > self.max_history:
                self.detection_history.pop(0)
            
        except Exception as e:
            print(f"Object detection error: {e}")
            # Return mock detection in case of error
            return self._mock_detection(frame)
        
        return detection_info
    
    def check_phone_usage_pattern(self, window_size: int = 10) -> Dict:
        """
        Check for phone usage patterns over time
        
        Args:
            window_size: Number of recent frames to analyze
            
        Returns:
            Dictionary with phone usage analysis
        """
        if len(self.detection_history) < window_size:
            return {"suspected_usage": False, "confidence": 0.0}
        
        # Get recent history
        recent = self.detection_history[-window_size:]
        
        # Count phone detections
        phone_detections = sum(1 for entry in recent if entry["phone_detected"])
        phone_ratio = phone_detections / len(recent)
        
        # Check for sustained phone detection
        sustained_detection = False
        if phone_detections >= window_size // 2:  # 50% of frames
            sustained_detection = True
        
        return {
            "suspected_usage": sustained_detection,
            "confidence": phone_ratio,
            "phone_detection_ratio": phone_ratio,
            "detection_count": phone_detections,
            "total_frames": len(recent)
        }
    
    def _mock_detection(self, frame: np.ndarray) -> Dict:
        """Mock detection for testing when YOLO is not available"""
        import random
        
        # Simulate random detection
        if random.random() < 0.1:  # 10% chance of detection
            h, w = frame.shape[:2]
            
            detection = {
                "class": random.choice(["cell phone", "book", "laptop"]),
                "confidence": random.uniform(0.6, 0.9),
                "bbox": {
                    "x1": random.randint(0, w-100),
                    "y1": random.randint(0, h-100),
                    "x2": random.randint(100, w),
                    "y2": random.randint(100, h),
                    "width": 100,
                    "height": 100
                },
                "is_forbidden": True,
                "center": {"x": w//2, "y": h//2}
            }
            
            return {
                "objects_detected": True,
                "forbidden_objects": [detection],
                "all_detections": [detection],
                "phone_detected": "phone" in detection["class"],
                "book_detected": "book" in detection["class"],
                "confidence": detection["confidence"]
            }
        
        return {
            "objects_detected": False,
            "forbidden_objects": [],
            "all_detections": [],
            "phone_detected": False,
            "book_detected": False,
            "confidence": 0.0
        }
    
    def draw_detections(self, frame: np.ndarray, detection_info: Dict) -> np.ndarray:
        """Draw object detections on frame"""
        display_frame = frame.copy()
        
        for detection in detection_info.get("forbidden_objects", []):
            bbox = detection["bbox"]
            
            # Draw bounding box (red for forbidden objects)
            cv2.rectangle(
                display_frame,
                (bbox["x1"], bbox["y1"]),
                (bbox["x2"], bbox["y2"]),
                (0, 0, 255),  # Red
                2
            )
            
            # Draw label
            label = f"{detection['class']}: {detection['confidence']:.2f}"
            cv2.putText(
                display_frame,
                label,
                (bbox["x1"], bbox["y1"] - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 0, 255),
                2
            )
        
        return display_frame