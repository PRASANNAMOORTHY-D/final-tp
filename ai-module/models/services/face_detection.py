import cv2
import mediapipe as mp
import numpy as np
from datetime import datetime
from typing import Dict, List, Optional, Tuple

class FaceDetector:
    def __init__(self, min_detection_confidence: float = 0.5):
        """Initialize MediaPipe Face Detection"""
        self.mp_face_detection = mp.solutions.face_detection
        self.face_detection = self.mp_face_detection.FaceDetection(
            model_selection=1,  # 0=short-range, 1=full-range
            min_detection_confidence=min_detection_confidence
        )
        
        self.face_history = []
        self.max_history = 30
        
    def detect(self, frame: np.ndarray) -> Dict:
        """
        Detect faces in frame and return analysis results
        
        Args:
            frame: BGR image frame
            
        Returns:
            Dictionary with detection results
        """
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_detection.process(rgb_frame)
        
        detection_info = {
            "faces_found": False,
            "face_count": 0,
            "bounding_boxes": [],
            "keypoints": [],
            "confidence_scores": []
        }
        
        if results.detections:
            detection_info["faces_found"] = True
            detection_info["face_count"] = len(results.detections)
            
            for detection in results.detections:
                # Get bounding box
                bbox = detection.location_data.relative_bounding_box
                h, w = frame.shape[:2]
                
                bbox_coords = {
                    "x": int(bbox.xmin * w),
                    "y": int(bbox.ymin * h),
                    "width": int(bbox.width * w),
                    "height": int(bbox.height * h)
                }
                
                # Get keypoints (eyes, nose, mouth)
                keypoints = {}
                for i, landmark in enumerate(detection.location_data.relative_keypoints):
                    keypoints[f"point_{i}"] = {
                        "x": int(landmark.x * w),
                        "y": int(landmark.y * h)
                    }
                
                detection_info["bounding_boxes"].append(bbox_coords)
                detection_info["keypoints"].append(keypoints)
                detection_info["confidence_scores"].append(detection.score[0])
        
        # Update history
        self.face_history.append({
            "timestamp": datetime.now(),
            "face_count": detection_info["face_count"],
            "has_face": detection_info["faces_found"]
        })
        
        if len(self.face_history) > self.max_history:
            self.face_history.pop(0)
        
        return detection_info
    
    def check_face_presence(self, duration: int = 5) -> Dict:
        """
        Check if face has been absent for specified duration
        
        Args:
            duration: Duration in seconds to check
            
        Returns:
            Dictionary with face presence analysis
        """
        if not self.face_history:
            return {"absent": False, "confidence": 0.0}
        
        # Get recent history within duration
        recent_history = [
            entry for entry in self.face_history
            if (datetime.now() - entry["timestamp"]).seconds <= duration
        ]
        
        if not recent_history:
            return {"absent": True, "confidence": 0.9}
        
        # Calculate face presence ratio
        face_present_count = sum(1 for entry in recent_history if entry["has_face"])
        presence_ratio = face_present_count / len(recent_history)
        
        return {
            "absent": presence_ratio < 0.3,  # Less than 30% presence
            "confidence": 1.0 - presence_ratio,
            "presence_ratio": presence_ratio,
            "sample_size": len(recent_history)
        }
    
    def check_multiple_faces(self) -> bool:
        """Check if multiple faces detected consistently"""
        if len(self.face_history) < 10:
            return False
        
        # Check last 10 detections
        recent = self.face_history[-10:]
        multiple_count = sum(1 for entry in recent if entry["face_count"] > 1)
        
        return multiple_count >= 5  # 50% of samples show multiple faces
    
    def draw_detections(self, frame: np.ndarray, detection_info: Dict) -> np.ndarray:
        """Draw face detections on frame"""
        display_frame = frame.copy()
        
        for bbox in detection_info["bounding_boxes"]:
            # Draw bounding box
            cv2.rectangle(
                display_frame,
                (bbox["x"], bbox["y"]),
                (bbox["x"] + bbox["width"], bbox["y"] + bbox["height"]),
                (0, 255, 0),  # Green
                2
            )
            
            # Draw label
            cv2.putText(
                display_frame,
                "Face",
                (bbox["x"], bbox["y"] - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.5,
                (0, 255, 0),
                2
            )
        
        return display_frame
    
    def release(self):
        """Release resources"""
        self.face_detection.close()