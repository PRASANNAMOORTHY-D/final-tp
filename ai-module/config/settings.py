import os
from pathlib import Path

class Settings:
    # Paths
    BASE_DIR = Path(__file__).resolve().parent.parent
    MODELS_DIR = BASE_DIR / "models"
    
    # AI Model Configurations
    FACE_DETECTION_MODEL = "mediapipe"  # mediapipe, yolo, dlib
    OBJECT_DETECTION_MODEL = "yolov8n"  # yolov8n, yolov5s
    GAZE_TRACKING_MODEL = "mediapipe"
    
    # Detection Thresholds
    FACE_DETECTION_CONFIDENCE = 0.5
    OBJECT_DETECTION_CONFIDENCE = 0.5
    GAZE_AWAY_THRESHOLD = 0.15
    MULTIPLE_FACE_THRESHOLD = 2
    
    # Alert Configurations
    MAX_ABSENCE_DURATION = 5  # seconds
    MAX_GAZE_AWAY_DURATION = 3  # seconds
    MAX_TAB_SWITCH_COUNT = 3
    
    # Server Settings
    HOST = "0.0.0.0"
    PORT = 8000
    DEBUG = True
    
    # Storage
    SESSIONS_DIR = BASE_DIR / "sessions"
    LOGS_DIR = BASE_DIR / "logs"
    
    @classmethod
    def init_dirs(cls):
        """Initialize required directories"""
        cls.SESSIONS_DIR.mkdir(exist_ok=True)
        cls.LOGS_DIR.mkdir(exist_ok=True)

settings = Settings()