import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import io from 'socket.io-client';
import { API_BASE_URL, WS_URL, AI_API_BASE_URL } from '../config';
import './ExamRoom.css';

const ExamRoom = ({ examId, onComplete }) => {
    const { user } = useAuth();
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const socketRef = useRef(null);
    
    const [sessionId, setSessionId] = useState(null);
    const [isRecording, setIsRecording] = useState(false);
    const [cameraActive, setCameraActive] = useState(false);
    const [alerts, setAlerts] = useState([]);
    const [focusScore, setFocusScore] = useState(100);
    const [integrityScore, setIntegrityScore] = useState(100);
    const [timeRemaining, setTimeRemaining] = useState(7200);
    const [analysisMetrics, setAnalysisMetrics] = useState({
        faceDetection: 100,
        gazeAccuracy: 95,
        behaviorScore: 100,
        objectCount: 0,
        posture: 'sitting'
    });
    
    const [detections, setDetections] = useState({
        faceCount: 0,
        gazeDirection: 'center',
        eyeState: 'open',
        mouthState: 'closed',
        objects: [],
        handActivity: 'none'
    });
    
    const [aiStatus, setAiStatus] = useState({
        faceDetection: true,
        gazeTracking: true,
        objectDetection: true,
        behaviorAnalysis: true
    });

    // Initialize exam
    useEffect(() => {
        initializeExam();
        return () => cleanup();
    }, []);

    const initializeExam = async () => {
        try {
            // 1. Start camera
            await startCamera();
            
            // 2. Create session
            const session = await createSession();
            setSessionId(session.sessionId);
            
            // 3. Connect to WebSocket
            connectWebSocket(session.sessionId);
            
            // 4. Start AI proctoring
            startAIProctoring(session.sessionId);
            
            // 5. Start timer
            startTimer();
            
            setIsRecording(true);
            
        } catch (error) {
            console.error('Exam initialization error:', error);
            alert('Failed to start exam: ' + error.message);
        }
    };

    const startCamera = async () => {
        try {
            const constraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 15 },
                    facingMode: 'user'
                },
                audio: false
            };
            
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                setCameraActive(true);
            }
            
        } catch (error) {
            console.error('Camera error:', error);
            throw new Error('Camera access denied. Please allow camera permissions.');
        }
    };

    const createSession = async () => {
        const sessionId = `SESSION_${Date.now()}_${user.id}_${examId}`;
        
        // Initialize AI session
        try {
            await fetch(`${AI_API_BASE_URL}/analyze/advanced`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: sessionId,
                    student_id: user.id,
                    exam_id: examId,
                    frame: 'init' // Initial call
                })
            });
        } catch (error) {
            console.warn('AI session init failed, continuing without AI:', error);
        }
        
        return { sessionId };
    };

    const connectWebSocket = (sessionId) => {
        const socket = io(WS_URL, {
            transports: ['websocket'],
            query: {
                role: 'student',
                examId,
                studentId: user.id,
                sessionId
            }
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('✅ Connected to monitoring server');
        });

        socket.on('instructor_message', (data) => {
            addAlert({
                type: 'INSTRUCTOR_MESSAGE',
                severity: 'INFO',
                details: `Instructor: ${data.message}`,
                timestamp: new Date()
            });
        });

        socket.on('proctoring_update', (data) => {
            updateFromAI(data.analysis);
        });

        socket.on('manual_alert', (data) => {
            addAlert({
                ...data.alert,
                timestamp: new Date(data.timestamp)
            });
        });

        socket.on('student_flagged', (data) => {
            addAlert({
                type: 'FLAGGED',
                severity: 'HIGH',
                details: data.reason || 'You were flagged by the instructor',
                timestamp: new Date(data.timestamp || Date.now())
            });
        });

        socket.on('risk_score_update', (data) => {
            // Optional: show as an info alert when risk increases significantly
            if (typeof data?.delta === 'number' && data.delta >= 10) {
                addAlert({
                    type: 'RISK_SCORE_UPDATED',
                    severity: 'INFO',
                    details: `Risk score changed to ${data.riskScore}%`,
                    timestamp: new Date(data.timestamp || Date.now())
                });
            }
        });
    };

    const startAIProctoring = (sessionId) => {
        const interval = setInterval(async () => {
            if (!cameraActive || !isRecording) {
                clearInterval(interval);
                return;
            }
            
            // Capture frame
            const frameData = captureFrame();
            if (!frameData) return;
            
            try {
                // Send to AI service
                const response = await fetch(`${AI_API_BASE_URL}/analyze/advanced`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        frame: frameData,
                        session_id: sessionId,
                        student_id: user.id,
                        exam_id: examId
                    })
                });
                
                const data = await response.json();
                
                // Update UI with AI results
                updateFromAI(data.analysis);
                
                // Send to WebSocket
                if (socketRef.current?.connected) {
                    socketRef.current.emit('proctoring_data', {
                        sessionId,
                        studentId: user.id,
                        examId,
                        analysis: data.analysis,
                        timestamp: new Date().toISOString()
                    });
                }
                
            } catch (error) {
                console.error('AI analysis error:', error);
            }
        }, 2000); // Analyze every 2 seconds
        
        return () => clearInterval(interval);
    };

    const captureFrame = () => {
        if (!videoRef.current || !canvasRef.current) return null;
        
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        
        // Draw video frame
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Add overlay for detection visualization
        drawDetectionOverlay(ctx);
        
        return canvas.toDataURL('image/jpeg', 0.7);
    };

    const drawDetectionOverlay = (ctx) => {
        // Draw face bounding box
        if (detections.faceCount > 0) {
            ctx.strokeStyle = detections.faceCount > 1 ? '#f56565' : '#48bb78';
            ctx.lineWidth = 3;
            ctx.strokeRect(100, 100, 200, 200); // Example position
            
            // Draw gaze direction
            if (detections.gazeDirection !== 'center') {
                ctx.fillStyle = '#ed8936';
                ctx.font = '16px Arial';
                ctx.fillText(`Looking ${detections.gazeDirection}`, 120, 80);
            }
        }
        
        // Draw detected objects
        detections.objects.forEach(obj => {
            ctx.strokeStyle = '#f56565';
            ctx.lineWidth = 2;
            ctx.strokeRect(300, 300, 100, 100); // Example position
            
            ctx.fillStyle = '#f56565';
            ctx.font = '14px Arial';
            ctx.fillText(obj, 310, 290);
        });
    };

    const updateFromAI = (analysis) => {
        // Update focus score
        if (analysis.focus_score !== undefined) {
            setFocusScore(analysis.focus_score);
        }
        
        if (analysis.integrity_score !== undefined) {
            setIntegrityScore(analysis.integrity_score);
        }
        
        // Update metrics
        if (analysis.metrics) {
            setAnalysisMetrics(prev => ({
                ...prev,
                ...analysis.metrics
            }));
        }
        
        // Update current state
        if (analysis.current_state) {
            setDetections(prev => ({
                ...prev,
                ...analysis.current_state
            }));
        }
        
        // Add alerts
        if (analysis.alerts?.length > 0) {
            analysis.alerts.forEach(alert => {
                addAlert(alert);
            });
        }
        
        // Update detection status
        if (analysis.detections) {
            setAiStatus(prev => ({
                ...prev,
                faceDetection: analysis.detections.face_found !== false,
                objectDetection: !(analysis.detections.objects?.length > 0)
            }));
        }
    };

    const addAlert = (alert) => {
        const newAlert = {
            id: Date.now() + Math.random(),
            ...alert,
            timestamp: alert.timestamp || new Date()
        };
        
        setAlerts(prev => [newAlert, ...prev.slice(0, 9)]);
        
        // Show notification for high severity alerts
        if (alert.severity === 'HIGH') {
            showNotification(alert.type, alert.details);
        }
    };

    const showNotification = (title, message) => {
        if (Notification.permission === 'granted') {
            new Notification(`⚠️ ${title}`, {
                body: message,
                icon: '/favicon.ico'
            });
        }
    };

    const startTimer = () => {
        const interval = setInterval(() => {
            setTimeRemaining(prev => {
                if (prev <= 0) {
                    clearInterval(interval);
                    submitExam();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        
        return () => clearInterval(interval);
    };

    const submitExam = async () => {
        setIsRecording(false);
        
        // Stop camera
        if (videoRef.current?.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        }
        
        // Disconnect WebSocket
        if (socketRef.current) {
            socketRef.current.disconnect();
        }
        
        // Get final results from AI
        try {
            const response = await fetch(`${AI_API_BASE_URL}/sessions/${sessionId}`);
            const sessionData = await response.json();
            
            // Save results
            const examResult = {
                examId,
                studentId: user.id,
                score: calculateScore(),
                focusScore,
                integrityScore,
                alertCount: alerts.length,
                sessionSummary: sessionData,
                submittedAt: new Date().toISOString()
            };
            
            localStorage.setItem(`exam_${examId}_result`, JSON.stringify(examResult));
            
        } catch (error) {
            console.error('Error getting session data:', error);
        }
        
        onComplete();
    };

    const calculateScore = () => {
        // Calculate exam score based on answers
        // This would be replaced with actual answer checking
        return Math.floor(Math.random() * 30) + 70; // Random score 70-100
    };

    const cleanup = () => {
        if (videoRef.current?.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
        }
        if (socketRef.current) {
            socketRef.current.disconnect();
        }
    };

    const formatTime = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="exam-room-container">
            {/* Hidden canvas for frame capture */}
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            
            <div className="exam-header">
                <h2>🎓 AI-Proctored Exam - Live Monitoring</h2>
                <div className="exam-stats">
                    <div className="stat">
                        <span className="label">Time:</span>
                        <span className="value timer">{formatTime(timeRemaining)}</span>
                    </div>
                    <div className="stat">
                        <span className="label">Focus:</span>
                        <span className={`value focus ${focusScore > 70 ? 'good' : focusScore > 40 ? 'warning' : 'alert'}`}>
                            {focusScore}%
                        </span>
                    </div>
                    <div className="stat">
                        <span className="label">Integrity:</span>
                        <span className={`value integrity ${integrityScore > 80 ? 'good' : integrityScore > 60 ? 'warning' : 'alert'}`}>
                            {integrityScore}%
                        </span>
                    </div>
                </div>
            </div>
            
            <div className="main-content">
                {/* Left: Questions */}
                <div className="questions-panel">
                    <h3>📝 Exam Questions</h3>
                    <div className="questions-list">
                        {/* Questions would go here */}
                    </div>
                </div>
                
                {/* Right: AI Monitoring Panel */}
                <div className="monitoring-panel">
                    {/* Camera Feed */}
                    <div className="camera-section">
                        <div className="camera-header">
                            <h3>📹 Live Camera Feed</h3>
                            <div className={`camera-status ${cameraActive ? 'active' : 'inactive'}`}>
                                {cameraActive ? 'ACTIVE' : 'INACTIVE'}
                            </div>
                        </div>
                        <div className="camera-feed">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="live-video"
                            />
                            <div className="camera-overlay">
                                <div className="detection-overlay">
                                    {/* Detection visuals would be drawn here */}
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* AI Analysis Dashboard */}
                    <div className="ai-dashboard">
                        <h3>🤖 AI Proctoring Dashboard</h3>
                        
                        <div className="ai-metrics">
                            <div className="metric-card">
                                <div className="metric-icon">👁️</div>
                                <div className="metric-details">
                                    <div className="metric-label">Face Detection</div>
                                    <div className="metric-value">{analysisMetrics.faceDetection}%</div>
                                    <div className="metric-status">
                                        {aiStatus.faceDetection ? '✅ Active' : '❌ Inactive'}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="metric-card">
                                <div className="metric-icon">👀</div>
                                <div className="metric-details">
                                    <div className="metric-label">Gaze Tracking</div>
                                    <div className="metric-value">{analysisMetrics.gazeAccuracy}%</div>
                                    <div className="metric-status">
                                        Current: {detections.gazeDirection}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="metric-card">
                                <div className="metric-icon">📊</div>
                                <div className="metric-details">
                                    <div className="metric-label">Behavior Score</div>
                                    <div className="metric-value">{analysisMetrics.behaviorScore}%</div>
                                    <div className="metric-status">
                                        Posture: {detections.posture}
                                    </div>
                                </div>
                            </div>
                            
                            <div className="metric-card">
                                <div className="metric-icon">📱</div>
                                <div className="metric-details">
                                    <div className="metric-label">Objects Detected</div>
                                    <div className="metric-value">{detections.objects.length}</div>
                                    <div className="metric-status">
                                        {detections.objects.length > 0 ? '⚠️ Suspicious' : '✅ Clear'}
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Live Detections */}
                        <div className="live-detections">
                            <h4>Live Detections:</h4>
                            <div className="detection-list">
                                <div className="detection-item">
                                    <span className="detection-label">Faces:</span>
                                    <span className={`detection-value ${detections.faceCount > 1 ? 'alert' : 'good'}`}>
                                        {detections.faceCount} {detections.faceCount > 1 ? '(Multiple!)' : ''}
                                    </span>
                                </div>
                                <div className="detection-item">
                                    <span className="detection-label">Eyes:</span>
                                    <span className={`detection-value ${detections.eyeState === 'closed' ? 'warning' : 'good'}`}>
                                        {detections.eyeState}
                                    </span>
                                </div>
                                <div className="detection-item">
                                    <span className="detection-label">Mouth:</span>
                                    <span className={`detection-value ${detections.mouthState === 'open' ? 'warning' : 'good'}`}>
                                        {detections.mouthState}
                                    </span>
                                </div>
                                <div className="detection-item">
                                    <span className="detection-label">Hands:</span>
                                    <span className={`detection-value ${detections.handActivity === 'detected' ? 'warning' : 'good'}`}>
                                        {detections.handActivity}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    {/* Alerts Panel */}
                    <div className="alerts-panel">
                        <div className="alerts-header">
                            <h3>🚨 Proctoring Alerts ({alerts.length})</h3>
                            <button 
                                className="btn-clear"
                                onClick={() => setAlerts([])}
                            >
                                Clear All
                            </button>
                        </div>
                        <div className="alerts-list">
                            {alerts.length === 0 ? (
                                <div className="no-alerts">
                                    ✅ No alerts detected. Keep up the good work!
                                </div>
                            ) : (
                                alerts.map(alert => (
                                    <div 
                                        key={alert.id} 
                                        className={`alert-item ${alert.severity?.toLowerCase()}`}
                                    >
                                        <div className="alert-icon">
                                            {alert.severity === 'HIGH' ? '🔴' : 
                                             alert.severity === 'MEDIUM' ? '🟡' : '🟢'}
                                        </div>
                                        <div className="alert-content">
                                            <div className="alert-title">{alert.type}</div>
                                            <div className="alert-details">{alert.details}</div>
                                            <div className="alert-time">
                                                {new Date(alert.timestamp).toLocaleTimeString()}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="exam-footer">
                <button 
                    className="btn-submit"
                    onClick={submitExam}
                    disabled={!isRecording}
                >
                    📤 Submit Exam
                </button>
                
                <div className="exam-instructions">
                    <h4>📋 AI Proctoring Rules:</h4>
                    <ul>
                        <li>✅ Keep face visible to camera</li>
                        <li>✅ Maintain eye contact with screen</li>
                        <li>✅ Sit upright with good posture</li>
                        <li>❌ No mobile phones or other devices</li>
                        <li>❌ No looking away frequently</li>
                        <li>❌ No talking or whispering</li>
                        <li>❌ No suspicious hand movements</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default ExamRoom;