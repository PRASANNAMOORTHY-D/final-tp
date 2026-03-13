from flask import Flask, request, jsonify
from flask_cors import CORS
import base64
import json
from datetime import datetime
import random

app = Flask(__name__)
CORS(app)

# Mock AI analysis
sessions = {}

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "healthy",
        "service": "Mock AI Proctoring",
        "version": "1.0.0",
        "timestamp": datetime.now().isoformat()
    })

@app.route('/api/analyze', methods=['POST'])
def analyze_frame():
    data = request.json
    
    if not data or 'frame' not in data:
        return jsonify({"error": "No frame provided"}), 400
    
    session_id = data.get('session_id', 'default')
    student_id = data.get('student_id', 'unknown')
    
    # Generate mock analysis
    face_detected = random.random() > 0.1  # 90% chance face detected
    face_count = 1 if face_detected else 0
    
    if random.random() > 0.9:  # 10% chance multiple faces
        face_count = 2
    
    gaze_directions = ['center', 'left', 'right', 'up', 'down']
    gaze_direction = random.choice(gaze_directions)
    
    # Mock alerts
    alerts = []
    if not face_detected:
        alerts.append({
            "type": "FACE_NOT_FOUND",
            "severity": "HIGH",
            "confidence": 0.9,
            "details": "Face not detected",
            "timestamp": datetime.now().isoformat()
        })
    
    if face_count > 1:
        alerts.append({
            "type": "MULTIPLE_FACES",
            "severity": "HIGH",
            "confidence": 0.85,
            "details": f"{face_count} faces detected",
            "timestamp": datetime.now().isoformat()
        })
    
    if gaze_direction != 'center' and random.random() > 0.7:
        alerts.append({
            "type": "GAZE_AWAY",
            "severity": "MEDIUM",
            "confidence": 0.7,
            "details": f"Looking {gaze_direction} from screen",
            "timestamp": datetime.now().isoformat()
        })
    
    # Mock focus score
    focus_score = max(0, 100 - (len(alerts) * 10))
    
    return jsonify({
        "session_id": session_id,
        "student_id": student_id,
        "timestamp": datetime.now().isoformat(),
        "analysis": {
            "face_detected": face_detected,
            "face_count": face_count,
            "gaze_direction": gaze_direction,
            "focus_score": focus_score,
            "alerts": alerts,
            "metrics": {
                "face_detection_rate": 95 if face_detected else 0,
                "gaze_accuracy": 90 if gaze_direction == 'center' else 70,
                "behavior_score": 85
            }
        }
    })

@app.route('/api/sessions/active', methods=['GET'])
def get_active_sessions():
    return jsonify({
        "active_sessions": [
            {
                "session_id": "mock_session_1",
                "student_id": "S12345678",
                "start_time": datetime.now().isoformat(),
                "focus_score": 85,
                "alert_count": 2
            }
        ],
        "timestamp": datetime.now().isoformat()
    })

@app.route('/api/sessions/clear', methods=['POST'])
def clear_sessions():
    sessions.clear()
    return jsonify({
        "message": "Sessions cleared",
        "timestamp": datetime.now().isoformat()
    })

if __name__ == '__main__':
    print("🤖 Mock AI Proctoring Service Starting...")
    print("🔗 http://localhost:8000/health")
    app.run(host='0.0.0.0', port=8000, debug=True)