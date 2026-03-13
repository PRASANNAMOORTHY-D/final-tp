# ai-module/app.py
from flask import Flask, request, jsonify, Response
from flask_cors import CORS
import cv2
import numpy as np
import mediapipe as mp
import base64
import json
import time
import threading
import queue
from datetime import datetime
from ultralytics import YOLO
import torch
from collections import deque
import warnings
warnings.filterwarnings('ignore')

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Initialize MediaPipe
mp_face_detection = mp.solutions.face_detection
mp_face_mesh = mp.solutions.face_mesh
mp_pose = mp.solutions.pose
mp_hands = mp.solutions.hands

face_detector = mp_face_detection.FaceDetection(
    model_selection=1,
    min_detection_confidence=0.5
)

face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=2,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

pose_detector = mp_pose.Pose(
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

hand_detector = mp_hands.Hands(
    max_num_hands=2,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

# Initialize YOLO for object detection
try:
    object_detector = YOLO('yolov8n.pt')
    print("✅ YOLO model loaded successfully")
except:
    print("⚠️ YOLO model not available, using fallback")
    object_detector = None

# Session management
sessions = {}
session_lock = threading.Lock()

# Alert thresholds
ALERT_THRESHOLDS = {
    "FACE_NOT_FOUND": {"duration": 5, "severity": "HIGH"},
    "MULTIPLE_FACES": {"count": 1, "severity": "HIGH"},
    "GAZE_AWAY": {"duration": 3, "severity": "MEDIUM"},
    "PHONE_DETECTED": {"count": 1, "severity": "HIGH"},
    "BOOK_DETECTED": {"count": 1, "severity": "MEDIUM"},
    "PERSON_STANDING": {"duration": 2, "severity": "MEDIUM"},
    "HAND_NEAR_FACE": {"duration": 2, "severity": "MEDIUM"},
    "LOOKING_DOWN": {"duration": 3, "severity": "MEDIUM"},
    "EYE_CLOSED": {"duration": 2, "severity": "LOW"},
    "MOUTH_OPEN": {"duration": 3, "severity": "LOW"},
    "NOISE_DETECTED": {"duration": 2, "severity": "LOW"}
}

class ProctoringSession:
    def __init__(self, session_id, student_id, exam_id):
        self.session_id = session_id
        self.student_id = student_id
        self.exam_id = exam_id
        self.start_time = datetime.now()
        self.last_update = datetime.now()
        
        # Detection history
        self.face_history = deque(maxlen=30)  # Last 30 frames
        self.gaze_history = deque(maxlen=30)
        self.object_history = deque(maxlen=30)
        self.pose_history = deque(maxlen=30)
        self.alert_history = deque(maxlen=100)
        
        # Metrics
        self.metrics = {
            "face_detection_rate": 100,
            "gaze_attention_score": 100,
            "behavior_score": 100,
            "object_penalty": 0,
            "integrity_score": 100
        }
        
        # Real-time states
        self.current_state = {
            "face_detected": False,
            "face_count": 0,
            "gaze_direction": "center",
            "head_pose": "frontal",
            "eye_state": "open",
            "mouth_state": "closed",
            "posture": "sitting",
            "hand_activity": "none",
            "objects_detected": [],
            "audio_level": 0
        }
        
        # Alert counters
        self.alert_counters = {
            "HIGH": 0,
            "MEDIUM": 0,
            "LOW": 0
        }
        
        # Focus tracking
        self.focus_score = 100
        self.focus_drops = []
        
        # Screenshot buffer for suspicious activity
        self.screenshot_buffer = deque(maxlen=10)
        
    def add_alert(self, alert_type, confidence, details, frame_data=None):
        """Add a new alert to the session"""
        alert = {
            "id": len(self.alert_history) + 1,
            "type": alert_type,
            "severity": ALERT_THRESHOLDS.get(alert_type, {}).get("severity", "MEDIUM"),
            "confidence": confidence,
            "details": details,
            "timestamp": datetime.now().isoformat(),
            "frame_data": frame_data  # Store suspicious frame
        }
        
        self.alert_history.append(alert)
        self.alert_counters[alert["severity"]] += 1
        
        # Store screenshot for high severity alerts
        if alert["severity"] == "HIGH" and frame_data:
            self.screenshot_buffer.append({
                "timestamp": alert["timestamp"],
                "alert_type": alert_type,
                "frame": frame_data[:500]  # Store first 500 chars
            })
        
        return alert
    
    def update_metrics(self):
        """Update session metrics based on detection history"""
        # Face detection rate
        if len(self.face_history) > 0:
            face_detected = sum(1 for f in self.face_history if f)
            self.metrics["face_detection_rate"] = (face_detected / len(self.face_history)) * 100
        
        # Gaze attention score
        if len(self.gaze_history) > 0:
            center_gaze = sum(1 for g in self.gaze_history if g == "center")
            self.metrics["gaze_attention_score"] = (center_gaze / len(self.gaze_history)) * 100
        
        # Calculate integrity score
        self.metrics["integrity_score"] = max(0, 100 - (
            self.alert_counters["HIGH"] * 5 +
            self.alert_counters["MEDIUM"] * 2 +
            self.alert_counters["LOW"] * 1
        ))
        
        # Update focus score
        self.focus_score = self.calculate_focus_score()
    
    def calculate_focus_score(self):
        """Calculate overall focus score"""
        base_score = 100
        
        # Penalties
        penalties = 0
        
        # High alerts penalty
        penalties += self.alert_counters["HIGH"] * 10
        
        # Medium alerts penalty
        penalties += self.alert_counters["MEDIUM"] * 5
        
        # Low face detection penalty
        if self.metrics["face_detection_rate"] < 80:
            penalties += (80 - self.metrics["face_detection_rate"])
        
        # Gaze away penalty
        if self.metrics["gaze_attention_score"] < 70:
            penalties += (70 - self.metrics["gaze_attention_score"])
        
        # Object detection penalty
        penalties += self.metrics["object_penalty"] * 3
        
        return max(0, base_score - penalties)
    
    def get_session_summary(self):
        """Get session summary for reporting"""
        return {
            "session_id": self.session_id,
            "student_id": self.student_id,
            "exam_id": self.exam_id,
            "duration": (datetime.now() - self.start_time).total_seconds(),
            "metrics": self.metrics,
            "focus_score": self.focus_score,
            "alert_summary": dict(self.alert_counters),
            "total_alerts": len(self.alert_history),
            "current_state": self.current_state,
            "recent_alerts": list(self.alert_history)[-5:]
        }

class AdvancedProctoringAnalyzer:
    def __init__(self):
        # Gaze tracking parameters
        self.EYE_AR_THRESH = 0.23  # Eye aspect ratio threshold
        self.EYE_AR_CONSEC_FRAMES = 3
        
        # Mouth aspect ratio for speaking detection
        self.MAR_THRESH = 0.7
        
        # Head pose estimation
        self.head_pose_history = deque(maxlen=10)
        
        # Behavior patterns
        self.behavior_patterns = {
            "suspicious_looking": 0,
            "frequent_movement": 0,
            "hand_to_face": 0,
            "looking_down": 0
        }
        
    def analyze_frame(self, frame, session):
        """Main analysis function for each frame"""
        # Convert frame to RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        analysis_results = {
            "alerts": [],
            "metrics": {},
            "current_state": {},
            "detections": {}
        }

        def merge_results(dst, src):
            """Merge partial detector results without overwriting accumulated fields."""
            if not src:
                return

            # Merge alerts
            if isinstance(src.get("alerts"), list) and src["alerts"]:
                dst.setdefault("alerts", [])
                dst["alerts"].extend(src["alerts"])

            # Merge dict fields
            for k in ("detections", "metrics", "current_state", "behavior_patterns"):
                if isinstance(src.get(k), dict):
                    dst.setdefault(k, {})
                    dst[k].update(src[k])

            # Merge any other top-level scalars
            for k, v in src.items():
                if k in ("alerts", "detections", "metrics", "current_state", "behavior_patterns"):
                    continue
                dst[k] = v
        
        try:
            # 1. Face Detection & Analysis
            face_results = self.analyze_face(rgb_frame, session)
            merge_results(analysis_results, face_results)
            
            # 2. Gaze Tracking
            if face_results["detections"].get("face_found", False):
                gaze_results = self.analyze_gaze(rgb_frame, session)
                merge_results(analysis_results, gaze_results)
            
            # 3. Pose Estimation (for posture)
            pose_results = self.analyze_pose(rgb_frame, session)
            merge_results(analysis_results, pose_results)
            
            # 4. Hand Detection
            hand_results = self.analyze_hands(rgb_frame, session)
            merge_results(analysis_results, hand_results)
            
            # 5. Object Detection (for phones, books, etc.)
            object_results = self.analyze_objects(frame, session)
            merge_results(analysis_results, object_results)
            
            # 6. Behavior Pattern Analysis
            behavior_results = self.analyze_behavior(session)
            merge_results(analysis_results, behavior_results)
            
            # 7. Update session metrics
            session.update_metrics()

            # Always include latest state/metrics snapshots
            analysis_results["current_state"] = dict(session.current_state)
            analysis_results["metrics"] = dict(session.metrics)
            
            # Add focus score to results
            analysis_results["focus_score"] = session.focus_score
            analysis_results["integrity_score"] = session.metrics["integrity_score"]
            
        except Exception as e:
            print(f"Analysis error: {e}")
            analysis_results["error"] = str(e)
        
        return analysis_results
    
    def analyze_face(self, rgb_frame, session):
        """Analyze face for presence, count, and facial expressions"""
        results = {
            "detections": {},
            "alerts": []
        }
        
        # Face detection
        face_results = face_detector.process(rgb_frame)
        
        if face_results.detections:
            face_count = len(face_results.detections)
            results["detections"]["face_found"] = True
            results["detections"]["face_count"] = face_count
            results["detections"]["face_bboxes"] = []
            
            session.face_history.append(True)
            session.current_state["face_detected"] = True
            session.current_state["face_count"] = face_count
            
            # Check for multiple faces
            if face_count > 1:
                alert = session.add_alert(
                    "MULTIPLE_FACES",
                    0.9,
                    f"{face_count} faces detected",
                    self.get_frame_snippet(rgb_frame)
                )
                results["alerts"].append(alert)
            
            # Analyze each face
            for detection in face_results.detections:
                bbox = detection.location_data.relative_bounding_box
                results["detections"]["face_bboxes"].append({
                    "x": bbox.xmin,
                    "y": bbox.ymin,
                    "width": bbox.width,
                    "height": bbox.height,
                    "confidence": detection.score[0]
                })
        
        else:
            results["detections"]["face_found"] = False
            results["detections"]["face_count"] = 0
            session.face_history.append(False)
            session.current_state["face_detected"] = False
            
            # Check for prolonged face absence
            recent_faces = list(session.face_history)
            if len(recent_faces) >= 15 and sum(recent_faces[-15:]) == 0:
                alert = session.add_alert(
                    "FACE_NOT_FOUND",
                    0.85,
                    "Face not detected for 15 frames",
                    self.get_frame_snippet(rgb_frame)
                )
                results["alerts"].append(alert)
        
        # Face mesh for detailed analysis
        mesh_results = face_mesh.process(rgb_frame)
        if mesh_results.multi_face_landmarks:
            landmarks = mesh_results.multi_face_landmarks[0]
            
            # Eye state analysis
            eye_state = self.analyze_eye_state(landmarks)
            session.current_state["eye_state"] = eye_state
            
            if eye_state == "closed":
                alert = session.add_alert(
                    "EYE_CLOSED",
                    0.7,
                    "Eyes closed detected",
                    self.get_frame_snippet(rgb_frame)
                )
                results["alerts"].append(alert)
            
            # Mouth state analysis
            mouth_state = self.analyze_mouth_state(landmarks)
            session.current_state["mouth_state"] = mouth_state
            
            if mouth_state == "open":
                alert = session.add_alert(
                    "MOUTH_OPEN",
                    0.6,
                    "Mouth open detected (possible speaking)",
                    self.get_frame_snippet(rgb_frame)
                )
                results["alerts"].append(alert)
        
        return results
    
    def analyze_gaze(self, rgb_frame, session):
        """Analyze gaze direction and attention"""
        results = {
            "detections": {},
            "alerts": []
        }
        
        mesh_results = face_mesh.process(rgb_frame)
        if not mesh_results.multi_face_landmarks:
            return results
        
        landmarks = mesh_results.multi_face_landmarks[0]
        
        # Simple gaze estimation based on face landmarks
        gaze_direction = self.estimate_gaze_direction(landmarks)
        session.current_state["gaze_direction"] = gaze_direction
        session.gaze_history.append(gaze_direction)
        
        results["detections"]["gaze_direction"] = gaze_direction
        
        # Check for gaze away from screen
        if gaze_direction != "center":
            recent_gaze = list(session.gaze_history)
            away_frames = sum(1 for g in recent_gaze if g != "center")
            
            if away_frames >= 10:  # 10 frames looking away
                alert = session.add_alert(
                    "GAZE_AWAY",
                    0.8,
                    f"Looking {gaze_direction} from screen",
                    self.get_frame_snippet(rgb_frame)
                )
                results["alerts"].append(alert)
        
        # Check for looking down (possible cheating)
        if gaze_direction == "down":
            recent_down = sum(1 for g in list(session.gaze_history)[-15:] if g == "down")
            if recent_down >= 10:
                alert = session.add_alert(
                    "LOOKING_DOWN",
                    0.75,
                    "Frequently looking down",
                    self.get_frame_snippet(rgb_frame)
                )
                results["alerts"].append(alert)
        
        return results
    
    def analyze_pose(self, rgb_frame, session):
        """Analyze body pose for posture and movement"""
        results = {
            "detections": {},
            "alerts": []
        }
        
        pose_results = pose_detector.process(rgb_frame)
        
        if pose_results.pose_landmarks:
            landmarks = pose_results.pose_landmarks
            
            # Detect if standing vs sitting
            posture = self.detect_posture(landmarks)
            session.current_state["posture"] = posture
            session.pose_history.append(posture)
            
            results["detections"]["posture"] = posture
            
            if posture == "standing":
                recent_standing = sum(1 for p in list(session.pose_history)[-10:] if p == "standing")
                if recent_standing >= 5:
                    alert = session.add_alert(
                        "PERSON_STANDING",
                        0.7,
                        "Person standing up",
                        self.get_frame_snippet(rgb_frame)
                    )
                    results["alerts"].append(alert)
            
            # Detect excessive movement
            movement_score = self.calculate_movement(landmarks)
            if movement_score > 0.3:
                alert = session.add_alert(
                    "EXCESSIVE_MOVEMENT",
                    0.6,
                    "Excessive body movement detected",
                    self.get_frame_snippet(rgb_frame)
                )
                results["alerts"].append(alert)
        
        return results
    
    def analyze_hands(self, rgb_frame, session):
        """Analyze hand positions and activities"""
        results = {
            "detections": {},
            "alerts": []
        }
        
        hand_results = hand_detector.process(rgb_frame)
        
        if hand_results.multi_hand_landmarks:
            hands = hand_results.multi_hand_landmarks
            
            # Check hand positions relative to face
            for hand in hands:
                hand_position = self.get_hand_position(hand)
                
                if hand_position == "near_face":
                    session.behavior_patterns["hand_to_face"] += 1
                    
                    if session.behavior_patterns["hand_to_face"] >= 5:
                        alert = session.add_alert(
                            "HAND_NEAR_FACE",
                            0.7,
                            "Hand near face (possible communication)",
                            self.get_frame_snippet(rgb_frame)
                        )
                        results["alerts"].append(alert)
                        session.behavior_patterns["hand_to_face"] = 0
            
            session.current_state["hand_activity"] = "detected" if hands else "none"
        
        return results
    
    def analyze_objects(self, frame, session):
        """Detect forbidden objects using YOLO"""
        results = {
            "detections": {},
            "alerts": []
        }
        
        if object_detector is None:
            return results
        
        try:
            # Run YOLO detection
            detections = object_detector(frame, verbose=False)[0]
            
            forbidden_objects = []
            object_details = []
            
            for box in detections.boxes:
                class_id = int(box.cls[0])
                class_name = detections.names[class_id]
                confidence = float(box.conf[0])
                
                if confidence > 0.5:  # Only consider confident detections
                    object_info = {
                        "class": class_name,
                        "confidence": confidence,
                        "bbox": box.xyxy[0].tolist()
                    }
                    object_details.append(object_info)
                    
                    # Check if object is forbidden
                    if self.is_forbidden_object(class_name):
                        forbidden_objects.append(class_name)
                        
                        # Add alert based on object type
                        if "phone" in class_name.lower():
                            alert = session.add_alert(
                                "PHONE_DETECTED",
                                confidence,
                                f"Mobile phone detected (confidence: {confidence:.2f})",
                                self.get_frame_snippet(frame)
                            )
                            results["alerts"].append(alert)
                            session.metrics["object_penalty"] += 5
                        
                        elif "book" in class_name.lower():
                            alert = session.add_alert(
                                "BOOK_DETECTED",
                                confidence,
                                f"Book/notes detected (confidence: {confidence:.2f})",
                                self.get_frame_snippet(frame)
                            )
                            results["alerts"].append(alert)
                            session.metrics["object_penalty"] += 3
            
            results["detections"]["objects"] = object_details
            results["detections"]["forbidden_objects"] = forbidden_objects
            session.current_state["objects_detected"] = forbidden_objects
            session.object_history.append(len(forbidden_objects) > 0)
            
        except Exception as e:
            print(f"Object detection error: {e}")
        
        return results
    
    def analyze_behavior(self, session):
        """Analyze behavior patterns over time"""
        results = {
            "behavior_patterns": {},
            "alerts": []
        }
        
        # Check for suspicious patterns
        recent_alerts = list(session.alert_history)[-20:]
        high_alert_count = sum(1 for a in recent_alerts if a["severity"] == "HIGH")
        
        if high_alert_count >= 3:
            alert = session.add_alert(
                "SUSPICIOUS_PATTERN",
                0.8,
                "Multiple suspicious activities detected",
                None
            )
            results["alerts"].append(alert)
        
        # Check focus drops
        if len(session.focus_drops) >= 3:
            recent_drops = session.focus_drops[-3:]
            if all(d < 60 for d in recent_drops):
                alert = session.add_alert(
                    "LOW_FOCUS",
                    0.7,
                    "Consistently low focus detected",
                    None
                )
                results["alerts"].append(alert)
        
        results["behavior_patterns"] = dict(session.behavior_patterns)
        return results
    
    def estimate_gaze_direction(self, landmarks):
        """Estimate gaze direction from face landmarks"""
        # Use eye landmarks to estimate gaze
        left_eye = landmarks.landmark[33]  # Left eye corner
        right_eye = landmarks.landmark[263]  # Right eye corner
        nose_tip = landmarks.landmark[1]  # Nose tip
        
        eye_center_x = (left_eye.x + right_eye.x) / 2
        offset_x = nose_tip.x - eye_center_x
        
        if offset_x < -0.05:
            return "left"
        elif offset_x > 0.05:
            return "right"
        elif nose_tip.y > 0.6:  # Looking down
            return "down"
        elif nose_tip.y < 0.4:  # Looking up
            return "up"
        else:
            return "center"
    
    def analyze_eye_state(self, landmarks):
        """Analyze if eyes are open or closed"""
        # Calculate eye aspect ratio (EAR)
        # Simplified version using selected landmarks
        left_eye_points = [33, 160, 158, 133, 153, 144]
        right_eye_points = [362, 385, 387, 263, 373, 380]
        
        def calculate_ear(eye_points):
            # Vertical distances
            v1 = np.linalg.norm(np.array([
                landmarks.landmark[eye_points[1]].x - landmarks.landmark[eye_points[5]].x,
                landmarks.landmark[eye_points[1]].y - landmarks.landmark[eye_points[5]].y
            ]))
            v2 = np.linalg.norm(np.array([
                landmarks.landmark[eye_points[2]].x - landmarks.landmark[eye_points[4]].x,
                landmarks.landmark[eye_points[2]].y - landmarks.landmark[eye_points[4]].y
            ]))
            
            # Horizontal distance
            h = np.linalg.norm(np.array([
                landmarks.landmark[eye_points[0]].x - landmarks.landmark[eye_points[3]].x,
                landmarks.landmark[eye_points[0]].y - landmarks.landmark[eye_points[3]].y
            ]))
            
            ear = (v1 + v2) / (2.0 * h) if h != 0 else 0
            return ear
        
        left_ear = calculate_ear(left_eye_points)
        right_ear = calculate_ear(right_eye_points)
        avg_ear = (left_ear + right_ear) / 2.0
        
        return "closed" if avg_ear < self.EYE_AR_THRESH else "open"
    
    def analyze_mouth_state(self, landmarks):
        """Analyze if mouth is open or closed"""
        # Mouth landmarks indices
        mouth_points = [61, 291, 39, 181, 0, 17, 269, 405]
        
        # Calculate mouth aspect ratio (MAR)
        vertical = np.linalg.norm(np.array([
            landmarks.landmark[61].x - landmarks.landmark[291].x,
            landmarks.landmark[61].y - landmarks.landmark[291].y
        ]))
        
        horizontal = np.linalg.norm(np.array([
            landmarks.landmark[39].x - landmarks.landmark[181].x,
            landmarks.landmark[39].y - landmarks.landmark[181].y
        ]))
        
        mar = vertical / horizontal if horizontal != 0 else 0
        
        return "open" if mar > self.MAR_THRESH else "closed"
    
    def detect_posture(self, landmarks):
        """Detect if person is sitting or standing"""
        # Use shoulder and hip positions
        left_shoulder = landmarks.landmark[11]
        right_shoulder = landmarks.landmark[12]
        left_hip = landmarks.landmark[23]
        right_hip = landmarks.landmark[24]
        
        shoulder_y = (left_shoulder.y + right_shoulder.y) / 2
        hip_y = (left_hip.y + right_hip.y) / 2
        
        # If hips are significantly lower than shoulders, likely sitting
        if hip_y - shoulder_y > 0.15:
            return "sitting"
        else:
            return "standing"
    
    def get_hand_position(self, hand_landmarks):
        """Determine hand position relative to face"""
        # Simplified: check if hand is near face region
        wrist = hand_landmarks.landmark[0]
        
        # If wrist is in upper part of frame, consider near face
        return "near_face" if wrist.y < 0.5 else "away"
    
    def calculate_movement(self, landmarks):
        """Calculate movement score based on landmark changes"""
        if not hasattr(self, 'prev_landmarks'):
            self.prev_landmarks = landmarks
            return 0
        
        # Calculate average movement of key points
        key_points = [11, 12, 23, 24]  # Shoulders and hips
        movement = 0
        
        for point in key_points:
            curr = landmarks.landmark[point]
            prev = self.prev_landmarks.landmark[point]
            
            movement += np.sqrt((curr.x - prev.x)**2 + (curr.y - prev.y)**2)
        
        self.prev_landmarks = landmarks
        return movement / len(key_points)
    
    def is_forbidden_object(self, class_name):
        """Check if object is forbidden during exam"""
        forbidden = ['cell phone', 'mobile phone', 'phone', 'book', 'notebook',
                    'laptop', 'computer', 'remote', 'controller', 'tablet',
                    'ipad', 'headphones', 'earphones', 'earbuds']
        
        return any(f in class_name.lower() for f in forbidden)
    
    def get_frame_snippet(self, frame, max_chars=500):
        """Convert frame to base64 snippet for storage"""
        try:
            # Resize frame to reduce size
            small_frame = cv2.resize(frame, (160, 120))
            
            # Convert to base64
            _, buffer = cv2.imencode('.jpg', small_frame, [cv2.IMWRITE_JPEG_QUALITY, 50])
            frame_base64 = base64.b64encode(buffer).decode('utf-8')
            
            # Return truncated version
            return frame_base64[:max_chars] + '...' if len(frame_base64) > max_chars else frame_base64
        except:
            return None

# Initialize analyzer
analyzer = AdvancedProctoringAnalyzer()

# Utility functions
def base64_to_image(base64_string):
    """Convert base64 string to OpenCV image"""
    try:
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        
        img_data = base64.b64decode(base64_string)
        nparr = np.frombuffer(img_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        print(f"Image conversion error: {e}")
        return None

# API Routes
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "healthy",
        "service": "Advanced AI Proctoring",
        "version": "2.0.0",
        "timestamp": datetime.now().isoformat(),
        "features": [
            "Face Detection & Counting",
            "Gaze Tracking",
            "Facial Expression Analysis",
            "Posture Detection",
            "Hand Activity Monitoring",
            "Object Detection (YOLO)",
            "Behavior Pattern Analysis",
            "Real-time Alert System",
            "Focus Score Calculation"
        ]
    })

@app.route('/api/analyze/advanced', methods=['POST'])
def advanced_analysis():
    """Advanced analysis endpoint with multiple detectors"""
    try:
        data = request.json
        
        if not data or 'frame' not in data:
            return jsonify({"error": "No frame provided"}), 400
        
        session_id = data.get('session_id', 'default')
        student_id = data.get('student_id', 'unknown')
        exam_id = data.get('exam_id', 'unknown')
        
        # Get or create session
        with session_lock:
            if session_id not in sessions:
                sessions[session_id] = ProctoringSession(session_id, student_id, exam_id)
            
            session = sessions[session_id]
        
        # Convert base64 to image
        frame = base64_to_image(data['frame'])
        if frame is None:
            return jsonify({"error": "Invalid image data"}), 400
        
        # Resize for processing
        frame = cv2.resize(frame, (640, 480))
        
        # Perform analysis
        analysis_results = analyzer.analyze_frame(frame, session)
        
        # Update session timestamp
        session.last_update = datetime.now()
        
        # Prepare response
        response = {
            "session_id": session_id,
            "student_id": student_id,
            "exam_id": exam_id,
            "timestamp": datetime.now().isoformat(),
            "analysis": analysis_results,
            "session_summary": session.get_session_summary()
        }
        
        return jsonify(response)
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/analyze', methods=['POST'])
def analyze_compat():
    """
    Backwards-compatible analysis endpoint expected by the frontend.
    Wraps the advanced analyzer but returns a simplified structure:
    {
      session_id, student_id, timestamp,
      focus_score, alerts, analysis: { ...full analysis... }
    }
    """
    try:
        data = request.json

        if not data or 'frame' not in data:
            return jsonify({"error": "No frame provided"}), 400

        session_id = data.get('session_id', 'default')
        student_id = data.get('student_id', 'unknown')
        exam_id = data.get('exam_id', 'unknown')

        # Get or create session
        with session_lock:
            if session_id not in sessions:
                sessions[session_id] = ProctoringSession(session_id, student_id, exam_id)

            session = sessions[session_id]

        # Convert base64 to image
        frame = base64_to_image(data['frame'])
        if frame is None:
            return jsonify({"error": "Invalid image data"}), 400

        # Resize for processing
        frame = cv2.resize(frame, (640, 480))

        # Perform analysis
        analysis_results = analyzer.analyze_frame(frame, session)

        # Update session timestamp
        session.last_update = datetime.now()

        alerts = analysis_results.get("alerts", [])
        focus_score = analysis_results.get("focus_score", session.focus_score)

        return jsonify({
            "session_id": session_id,
            "student_id": student_id,
            "exam_id": exam_id,
            "timestamp": datetime.now().isoformat(),
            "focus_score": focus_score,
            "alerts": alerts,
            "analysis": analysis_results
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/analyze/batch', methods=['POST'])
def batch_analysis():
    """Analyze multiple frames at once"""
    try:
        data = request.json
        
        if not data or 'frames' not in data:
            return jsonify({"error": "No frames provided"}), 400
        
        session_id = data.get('session_id', 'default')
        frames = data['frames']
        
        results = []
        for i, frame_data in enumerate(frames[:10]):  # Limit to 10 frames
            if i >= 10:
                break
                
            # Simulate analysis for each frame
            result = {
                "frame_index": i,
                "analysis": {
                    "face_detected": True if i % 3 != 0 else False,
                    "gaze_direction": ["center", "left", "right"][i % 3],
                    "focus_score": max(50, 100 - (i * 2))
                }
            }
            results.append(result)
        
        return jsonify({
            "session_id": session_id,
            "total_frames": len(results),
            "results": results,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/sessions/<session_id>', methods=['GET'])
def get_session(session_id):
    """Get session data and analytics"""
    with session_lock:
        if session_id in sessions:
            session = sessions[session_id]
            return jsonify(session.get_session_summary())
        return jsonify({"error": "Session not found"}), 404

@app.route('/api/sessions/<session_id>/alerts', methods=['GET'])
def get_session_alerts(session_id):
    """Get all alerts for a session"""
    with session_lock:
        if session_id in sessions:
            session = sessions[session_id]
            return jsonify({
                "session_id": session_id,
                "total_alerts": len(session.alert_history),
                "alerts": list(session.alert_history),
                "alert_summary": dict(session.alert_counters)
            })
        return jsonify({"error": "Session not found"}), 404

@app.route('/api/sessions/<session_id>/screenshots', methods=['GET'])
def get_suspicious_screenshots(session_id):
    """Get suspicious activity screenshots"""
    with session_lock:
        if session_id in sessions:
            session = sessions[session_id]
            return jsonify({
                "session_id": session_id,
                "screenshot_count": len(session.screenshot_buffer),
                "screenshots": list(session.screenshot_buffer)
            })
        return jsonify({"error": "Session not found"}), 404

@app.route('/api/sessions/active', methods=['GET'])
def get_active_sessions():
    """Get all active sessions"""
    with session_lock:
        active_sessions = []
        for session_id, session in sessions.items():
            active_sessions.append({
                "session_id": session_id,
                "student_id": session.student_id,
                "exam_id": session.exam_id,
                "start_time": session.start_time.isoformat(),
                "duration": (datetime.now() - session.start_time).total_seconds(),
                "focus_score": session.focus_score,
                "total_alerts": len(session.alert_history),
                "alert_summary": dict(session.alert_counters)
            })
        
        return jsonify({
            "active_sessions": active_sessions,
            "total_sessions": len(active_sessions),
            "timestamp": datetime.now().isoformat()
        })

@app.route('/api/sessions/clear', methods=['POST'])
def clear_sessions():
    """Clear all sessions (for testing)"""
    with session_lock:
        count = len(sessions)
        sessions.clear()
        return jsonify({
            "message": f"Cleared {count} sessions",
            "timestamp": datetime.now().isoformat()
        })

@app.route('/api/test/detection', methods=['POST'])
def test_detection():
    """Test endpoint for individual detectors"""
    try:
        data = request.json
        
        if not data or 'frame' not in data:
            return jsonify({"error": "No frame provided"}), 400
        
        frame = base64_to_image(data['frame'])
        if frame is None:
            return jsonify({"error": "Invalid image data"}), 400
        
        frame = cv2.resize(frame, (640, 480))
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        results = {}
        
        # Test face detection
        face_results = face_detector.process(rgb_frame)
        results["face_detection"] = {
            "faces_found": len(face_results.detections) if face_results.detections else 0,
            "detections": [
                {
                    "confidence": float(detection.score[0]),
                    "bbox": {
                        "x": detection.location_data.relative_bounding_box.xmin,
                        "y": detection.location_data.relative_bounding_box.ymin,
                        "width": detection.location_data.relative_bounding_box.width,
                        "height": detection.location_data.relative_bounding_box.height
                    }
                }
                for detection in (face_results.detections or [])
            ]
        }
        
        # Test object detection
        if object_detector:
            detections = object_detector(frame, verbose=False)[0]
            results["object_detection"] = {
                "objects_found": len(detections.boxes) if detections.boxes else 0,
                "detections": [
                    {
                        "class": detections.names[int(box.cls[0])],
                        "confidence": float(box.conf[0]),
                        "bbox": box.xyxy[0].tolist()
                    }
                    for box in (detections.boxes or [])
                ]
            }
        
        return jsonify({
            "test_results": results,
            "timestamp": datetime.now().isoformat()
        })
        
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("🤖 ADVANCED AI PROCTORING SYSTEM")
    print("=" * 60)
    print("Features:")
    print("  ✅ Face Detection & Counting")
    print("  ✅ Gaze Tracking & Attention Analysis")
    print("  ✅ Facial Expression Analysis")
    print("  ✅ Posture & Movement Detection")
    print("  ✅ Hand Activity Monitoring")
    print("  ✅ Object Detection (Phones, Books, etc.)")
    print("  ✅ Behavior Pattern Analysis")
    print("  ✅ Real-time Alert System")
    print("  ✅ Focus & Integrity Scoring")
    print("=" * 60)
    print(f"🚀 Server starting on http://0.0.0.0:8000")
    print("=" * 60)
    
    app.run(host='0.0.0.0', port=8000, debug=True, threaded=True)