import cv2
import numpy as np
import mediapipe as mp
from typing import Dict, List, Tuple, Optional

class GazeTracker:
    def __init__(self):
        """Initialize MediaPipe Face Mesh for gaze tracking"""
        self.mp_face_mesh = mp.solutions.face_mesh
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        # Landmark indices for MediaPipe Face Mesh
        self.LANDMARKS = {
            "LEFT_EYE": [33, 133, 157, 158, 159, 160, 161, 173],
            "RIGHT_EYE": [362, 382, 381, 380, 374, 373, 390, 263],
            "LEFT_IRIS": [468, 469, 470, 471, 472],
            "RIGHT_IRIS": [473, 474, 475, 476, 477],
            "LEFT_EYEBROW": [70, 63, 105, 66, 107],
            "RIGHT_EYEBROW": [336, 296, 334, 293, 300],
            "MOUTH": [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
        }
        
        self.gaze_history = []
        self.max_history = 50
        
    def track_gaze(self, frame: np.ndarray) -> Dict:
        """
        Track gaze direction from frame
        
        Args:
            frame: BGR image frame
            
        Returns:
            Dictionary with gaze tracking results
        """
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)
        
        gaze_info = {
            "gaze_detected": False,
            "direction": "center",
            "confidence": 0.0,
            "eye_aspect_ratio": 0.0,
            "head_pose": "frontal",
            "looking_away": False
        }
        
        if not results.multi_face_landmarks:
            return gaze_info
        
        h, w = frame.shape[:2]
        landmarks = results.multi_face_landmarks[0].landmark
        
        # Calculate eye centers
        left_eye_center = self._get_center(landmarks, self.LANDMARKS["LEFT_EYE"], w, h)
        right_eye_center = self._get_center(landmarks, self.LANDMARKS["RIGHT_EYE"], w, h)
        
        # Calculate iris centers
        left_iris_center = self._get_center(landmarks, self.LANDMARKS["LEFT_IRIS"], w, h)
        right_iris_center = self._get_center(landmarks, self.LANDMARKS["RIGHT_IRIS"], w, h)
        
        # Calculate gaze vectors
        left_gaze_vector = np.array([
            left_iris_center[0] - left_eye_center[0],
            left_iris_center[1] - left_eye_center[1]
        ])
        
        right_gaze_vector = np.array([
            right_iris_center[0] - right_eye_center[0],
            right_iris_center[1] - right_eye_center[1]
        ])
        
        # Average gaze vector
        gaze_vector = (left_gaze_vector + right_gaze_vector) / 2
        
        # Normalize gaze vector
        gaze_norm = np.linalg.norm(gaze_vector)
        if gaze_norm > 0:
            gaze_vector_normalized = gaze_vector / gaze_norm
        else:
            gaze_vector_normalized = gaze_vector
        
        # Determine gaze direction
        direction = self._vector_to_direction(gaze_vector_normalized)
        
        # Calculate confidence
        confidence = min(gaze_norm / 10.0, 1.0)
        
        # Calculate Eye Aspect Ratio (EAR) for blink detection
        left_ear = self._calculate_ear(landmarks, self.LANDMARKS["LEFT_EYE"], w, h)
        right_ear = self._calculate_ear(landmarks, self.LANDMARKS["RIGHT_EYE"], w, h)
        ear = (left_ear + right_ear) / 2.0
        
        # Estimate head pose (simplified)
        head_pose = self._estimate_head_pose(landmarks, w, h)
        
        gaze_info.update({
            "gaze_detected": True,
            "direction": direction,
            "confidence": float(confidence),
            "eye_aspect_ratio": float(ear),
            "head_pose": head_pose,
            "looking_away": direction != "center",
            "gaze_vector": gaze_vector_normalized.tolist(),
            "eye_centers": {
                "left": left_eye_center,
                "right": right_eye_center
            },
            "iris_centers": {
                "left": left_iris_center,
                "right": right_iris_center
            }
        })
        
        # Update history
        self.gaze_history.append({
            "direction": direction,
            "looking_away": direction != "center",
            "ear": ear
        })
        
        if len(self.gaze_history) > self.max_history:
            self.gaze_history.pop(0)
        
        return gaze_info
    
    def check_prolonged_gaze_away(self, threshold_seconds: int = 3) -> Dict:
        """
        Check if gaze has been away for prolonged period
        
        Args:
            threshold_seconds: Threshold in seconds
            
        Returns:
            Dictionary with gaze away analysis
        """
        if len(self.gaze_history) < 10:
            return {"prolonged_away": False, "duration": 0, "confidence": 0.0}
        
        # Check recent history
        recent_away = sum(1 for entry in self.gaze_history if entry["looking_away"])
        away_ratio = recent_away / len(self.gaze_history)
        
        # Assuming 2 FPS for analysis
        estimated_duration = (recent_away * 0.5)  # 0.5 seconds per sample
        
        return {
            "prolonged_away": estimated_duration >= threshold_seconds,
            "duration": estimated_duration,
            "away_ratio": away_ratio,
            "confidence": away_ratio,
            "sample_count": len(self.gaze_history)
        }
    
    def _get_center(self, landmarks, indices, w, h):
        """Calculate center of landmarks"""
        x = [landmarks[i].x * w for i in indices]
        y = [landmarks[i].y * h for i in indices]
        return [np.mean(x), np.mean(y)]
    
    def _calculate_ear(self, landmarks, eye_indices, w, h):
        """Calculate Eye Aspect Ratio (EAR)"""
        # Get eye landmark coordinates
        points = [(landmarks[i].x * w, landmarks[i].y * h) for i in eye_indices]
        
        # Calculate vertical distances
        v1 = np.linalg.norm(np.array(points[1]) - np.array(points[5]))
        v2 = np.linalg.norm(np.array(points[2]) - np.array(points[4]))
        
        # Calculate horizontal distance
        h1 = np.linalg.norm(np.array(points[0]) - np.array(points[3]))
        
        # Avoid division by zero
        if h1 == 0:
            return 0.0
        
        ear = (v1 + v2) / (2.0 * h1)
        return ear
    
    def _vector_to_direction(self, vector):
        """Convert gaze vector to direction string"""
        x, y = vector
        
        if abs(x) < 0.1 and abs(y) < 0.1:
            return "center"
        
        # Determine primary direction
        if abs(x) > abs(y):
            if x < -0.1:
                return "left"
            elif x > 0.1:
                return "right"
        else:
            if y < -0.1:
                return "up"
            elif y > 0.1:
                return "down"
        
        return "center"
    
    def _estimate_head_pose(self, landmarks, w, h):
        """Simple head pose estimation"""
        # Use nose and face center landmarks
        nose_tip = landmarks[1]  # Nose tip landmark
        face_center = landmarks[0]  # Center of face
        
        # Calculate horizontal offset
        offset_x = abs(nose_tip.x - 0.5)  # 0.5 is center of frame
        
        if offset_x < 0.1:
            return "frontal"
        elif nose_tip.x < 0.4:
            return "turned_left"
        elif nose_tip.x > 0.6:
            return "turned_right"
        else:
            return "frontal"
    
    def draw_gaze(self, frame: np.ndarray, gaze_info: Dict) -> np.ndarray:
        """Draw gaze information on frame"""
        display_frame = frame.copy()
        
        if not gaze_info["gaze_detected"]:
            return display_frame
        
        # Draw eye centers
        if "eye_centers" in gaze_info:
            for side, center in gaze_info["eye_centers"].items():
                cv2.circle(display_frame, 
                          (int(center[0]), int(center[1])), 
                          3, (0, 255, 255), -1)  # Yellow
        
        # Draw iris centers
        if "iris_centers" in gaze_info:
            for side, center in gaze_info["iris_centers"].items():
                cv2.circle(display_frame, 
                          (int(center[0]), int(center[1])), 
                          2, (255, 0, 0), -1)  # Blue
        
        # Draw gaze direction text
        direction = gaze_info["direction"]
        color = (0, 255, 0) if direction == "center" else (0, 0, 255)
        
        cv2.putText(display_frame, 
                   f"Gaze: {direction.upper()}", 
                   (10, 30),
                   cv2.FONT_HERSHEY_SIMPLEX,
                   0.7, color, 2)
        
        # Draw EAR value
        if "eye_aspect_ratio" in gaze_info:
            ear = gaze_info["eye_aspect_ratio"]
            ear_color = (0, 255, 0) if ear > 0.2 else (0, 0, 255)
            
            cv2.putText(display_frame,
                       f"EAR: {ear:.2f}",
                       (10, 60),
                       cv2.FONT_HERSHEY_SIMPLEX,
                       0.7, ear_color, 2)
        
        return display_frame
    
    def release(self):
        """Release resources"""
        self.face_mesh.close()