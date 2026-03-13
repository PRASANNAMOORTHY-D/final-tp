import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import io from 'socket.io-client';
import { API_BASE_URL, WS_URL, AI_API_BASE_URL } from '../../config';
import './ExamRoom.css';

const ExamRoom = ({ examId, onComplete }) => {
    const { user } = useAuth();
    const videoRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const socketRef = useRef(null);
    const [sessionId, setSessionId] = useState(null);
    const [isRecording, setIsRecording] = useState(false);
    const [cameraActive, setCameraActive] = useState(false);
    const [alerts, setAlerts] = useState([]);
    const [focusScore, setFocusScore] = useState(100);
    const [timeRemaining, setTimeRemaining] = useState(7200);
    const [questions] = useState([
        { id: 1, text: "What is the time complexity of binary search?", options: ["O(n)", "O(log n)", "O(n^2)", "O(1)"] },
        { id: 2, text: "Which data structure uses LIFO?", options: ["Queue", "Stack", "Array", "Linked List"] },
        { id: 3, text: "What does SQL stand for?", options: ["Structured Query Language", "Simple Query Language", "Standard Query Language", "System Query Language"] }
    ]);
    const [answers, setAnswers] = useState({});
    const [stream, setStream] = useState(null);
    const [isStreaming, setIsStreaming] = useState(false);
    const audioMonitorRef = useRef(null);
    const screenStreamRef = useRef(null);
    const proctoringIntervalsRef = useRef({ audio: null });
    const isRecordingRef = useRef(false);
    const isStreamingRef = useRef(false);

    useEffect(() => {
        isRecordingRef.current = isRecording;
    }, [isRecording]);

    useEffect(() => {
        isStreamingRef.current = isStreaming;
    }, [isStreaming]);

    // Initialize camera and streaming
    useEffect(() => {
        initializeCamera();
        setupBrowserProctoringListeners();
        return () => {
            stopCamera();
            stopScreenMonitoring();
            stopAudioMonitoring();
            teardownBrowserProctoringListeners();
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, []);

    const emitProctoringEvent = (payload) => {
        const baseAlert = {
            type: payload.type,
            severity: payload.severity || 'MEDIUM',
            details: payload.details,
            timestamp: payload.timestamp || new Date().toISOString()
        };

        // Always show it immediately in the student's alerts panel
        setAlerts(prev => [baseAlert, ...prev].slice(0, 10));

        // Also send to backend/instructor if socket is connected
        if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit('proctoring_event', {
                sessionId,
                studentId: user.id,
                examId,
                ...baseAlert,
                meta: payload.meta || {}
            });
        }
    };

    const initializeCamera = async () => {
        try {
            const constraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 15 },
                    facingMode: 'user'
                },
                audio: true
            };

            const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            setStream(mediaStream);
            
            if (videoRef.current) {
                videoRef.current.srcObject = mediaStream;
                setCameraActive(true);
            }

            // Connect to WebSocket for live streaming
            connectWebSocket();

        } catch (error) {
            console.error('Camera error:', error);
            alert(`Camera access required: ${error.message}`);
        }
    };

    // ---------- Browser-based proctoring (no AI needed) ----------
    const browserListenerRefs = useRef({
        visibilityHandler: null,
        blurHandler: null,
        focusHandler: null,
        keydownHandler: null,
        copyHandler: null,
        pasteHandler: null,
        cutHandler: null,
        contextMenuHandler: null,
        fullscreenHandler: null
    });

    const setupBrowserProctoringListeners = () => {
        const onVisibilityChange = () => {
            if (!isRecordingRef.current) return;
            if (document.visibilityState === 'hidden') {
                emitProctoringEvent({
                    type: 'TAB_SWITCH_OR_MINIMIZE',
                    severity: 'HIGH',
                    details: 'Tab changed / window minimized'
                });
            }
        };

        const onBlur = () => {
            if (!isRecordingRef.current) return;
            emitProctoringEvent({
                type: 'WINDOW_BLUR',
                severity: 'MEDIUM',
                details: 'Exam window lost focus'
            });
        };

        const onFocus = () => {
            if (!isRecordingRef.current) return;
            emitProctoringEvent({
                type: 'WINDOW_FOCUS',
                severity: 'LOW',
                details: 'Exam window focused again'
            });
        };

        const onKeyDown = (e) => {
            if (!isRecordingRef.current) return;
            const key = (e.key || '').toLowerCase();
            const ctrl = e.ctrlKey || e.metaKey;

            // Block common copy/paste/select-all/print/save shortcuts during exam
            if (ctrl && (key === 'c' || key === 'v' || key === 'x' || key === 'a' || key === 'p' || key === 's')) {
                e.preventDefault();
                emitProctoringEvent({
                    type: 'SHORTCUT_BLOCKED',
                    severity: 'HIGH',
                    details: `Blocked shortcut: ${ctrl ? 'CTRL+' : ''}${e.key}`
                });
            }

            // Block Alt+Tab signal (we can't truly stop OS switch, but we can detect Alt key combos)
            if (e.altKey && key === 'tab') {
                emitProctoringEvent({
                    type: 'ALT_TAB_ATTEMPT',
                    severity: 'HIGH',
                    details: 'Alt+Tab attempt detected'
                });
            }
        };

        const onCopy = (e) => {
            if (!isRecordingRef.current) return;
            e.preventDefault();
            emitProctoringEvent({
                type: 'COPY_ATTEMPT',
                severity: 'HIGH',
                details: 'Copy attempt blocked'
            });
        };

        const onPaste = (e) => {
            if (!isRecordingRef.current) return;
            e.preventDefault();
            emitProctoringEvent({
                type: 'PASTE_ATTEMPT',
                severity: 'HIGH',
                details: 'Paste attempt blocked'
            });
        };

        const onCut = (e) => {
            if (!isRecordingRef.current) return;
            e.preventDefault();
            emitProctoringEvent({
                type: 'CUT_ATTEMPT',
                severity: 'MEDIUM',
                details: 'Cut attempt blocked'
            });
        };

        const onContextMenu = (e) => {
            if (!isRecordingRef.current) return;
            e.preventDefault();
            emitProctoringEvent({
                type: 'RIGHT_CLICK_BLOCKED',
                severity: 'LOW',
                details: 'Right click blocked'
            });
        };

        const onFullscreenChange = () => {
            if (!isRecordingRef.current) return;
            const isFs = !!document.fullscreenElement;
            if (!isFs) {
                emitProctoringEvent({
                    type: 'EXIT_FULLSCREEN',
                    severity: 'HIGH',
                    details: 'Exited fullscreen during exam'
                });
            }
        };

        browserListenerRefs.current.visibilityHandler = onVisibilityChange;
        browserListenerRefs.current.blurHandler = onBlur;
        browserListenerRefs.current.focusHandler = onFocus;
        browserListenerRefs.current.keydownHandler = onKeyDown;
        browserListenerRefs.current.copyHandler = onCopy;
        browserListenerRefs.current.pasteHandler = onPaste;
        browserListenerRefs.current.cutHandler = onCut;
        browserListenerRefs.current.contextMenuHandler = onContextMenu;
        browserListenerRefs.current.fullscreenHandler = onFullscreenChange;

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        window.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('copy', onCopy);
        document.addEventListener('paste', onPaste);
        document.addEventListener('cut', onCut);
        document.addEventListener('contextmenu', onContextMenu);
        document.addEventListener('fullscreenchange', onFullscreenChange);
    };

    const teardownBrowserProctoringListeners = () => {
        const r = browserListenerRefs.current;
        if (r.visibilityHandler) document.removeEventListener('visibilitychange', r.visibilityHandler);
        if (r.blurHandler) window.removeEventListener('blur', r.blurHandler);
        if (r.focusHandler) window.removeEventListener('focus', r.focusHandler);
        if (r.keydownHandler) window.removeEventListener('keydown', r.keydownHandler, true);
        if (r.copyHandler) document.removeEventListener('copy', r.copyHandler);
        if (r.pasteHandler) document.removeEventListener('paste', r.pasteHandler);
        if (r.cutHandler) document.removeEventListener('cut', r.cutHandler);
        if (r.contextMenuHandler) document.removeEventListener('contextmenu', r.contextMenuHandler);
        if (r.fullscreenHandler) document.removeEventListener('fullscreenchange', r.fullscreenHandler);
    };

    const connectWebSocket = () => {
        const socket = io(WS_URL, {
            transports: ['websocket'],
            query: {
                studentId: user.id,
                examId: examId,
                role: 'student'
            }
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Connected to WebSocket server');

            // Let backend know this is a student session for instructor dashboard
            socket.emit('authenticate', {
                role: 'student',
                userId: user.id,
                studentName: user.name,
                examId
            });
        });

        socket.on('instructor_message', (data) => {
            alert(`Instructor: ${data.message}`);
        });

        socket.on('proctoring_alert', (data) => {
            setAlerts(prev => [data, ...prev].slice(0, 10));
        });
    };

    const startExamSession = async () => {
        try {
            // Start exam session on backend
            const response = await fetch(`${API_BASE_URL}/api/exams/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    examId,
                    studentId: user.id,
                    studentName: user.name
                })
            });

            const data = await response.json();
            setSessionId(data.sessionId);
            setIsRecording(true);

            // Request fullscreen for better integrity
            try {
                if (!document.fullscreenElement) {
                    await document.documentElement.requestFullscreen();
                }
            } catch (e) {
                // ignore; still continue exam
            }
            
            // Start live video streaming
            startVideoStreaming(data.sessionId);
            
            // Start periodic frame capture for AI analysis
            startAIProctoring(data.sessionId);

            // Start audio & screen monitoring (optional)
            startAudioMonitoring();
            
            // Start timer
            startTimer();

        } catch (error) {
            console.error('Start exam error:', error);
        }
    };

    const startAudioMonitoring = async () => {
        if (!stream) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            const ctx = new AudioContext();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            source.connect(analyser);

            const data = new Uint8Array(analyser.fftSize);
            let loudFrames = 0;

            const interval = setInterval(() => {
                if (!isRecording) return;
                analyser.getByteTimeDomainData(data);
                let sum = 0;
                for (let i = 0; i < data.length; i++) {
                    const v = (data[i] - 128) / 128;
                    sum += v * v;
                }
                const rms = Math.sqrt(sum / data.length);

                // Simple threshold; tune later
                if (rms > 0.12) loudFrames += 1;
                else loudFrames = Math.max(0, loudFrames - 1);

                if (loudFrames >= 4) { // sustained loudness ~4 seconds
                    loudFrames = 0;
                    emitProctoringEvent({
                        type: 'NOISE_DETECTED',
                        severity: 'LOW',
                        details: 'Sustained audio activity detected',
                        meta: { rms }
                    });
                }
            }, 1000);

            audioMonitorRef.current = { ctx, interval };
            proctoringIntervalsRef.current.audio = interval;
        } catch (e) {
            console.error('Audio monitoring failed:', e);
        }
    };

    const stopAudioMonitoring = () => {
        try {
            const a = audioMonitorRef.current;
            if (a?.interval) clearInterval(a.interval);
            if (a?.ctx) a.ctx.close();
        } catch (_) {}
        audioMonitorRef.current = null;
    };

    const startScreenMonitoring = async () => {
        // Optional: requires user permission; we can detect if they stop sharing
        try {
            const displayStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: false
            });
            screenStreamRef.current = displayStream;

            emitProctoringEvent({
                type: 'SCREEN_SHARE_STARTED',
                severity: 'LOW',
                details: 'Screen sharing started'
            });

            const track = displayStream.getVideoTracks()[0];
            track.onended = () => {
                emitProctoringEvent({
                    type: 'SCREEN_SHARE_STOPPED',
                    severity: 'HIGH',
                    details: 'Screen sharing stopped'
                });
            };
        } catch (e) {
            emitProctoringEvent({
                type: 'SCREEN_SHARE_DENIED',
                severity: 'MEDIUM',
                details: 'Screen sharing permission denied'
            });
        }
    };

    const stopScreenMonitoring = () => {
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(t => t.stop());
            screenStreamRef.current = null;
        }
    };

    const startVideoStreaming = (sessionId) => {
        if (!stream || !socketRef.current) return;

        setIsStreaming(true);
        
        // Send video frames via WebSocket
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        const sendFrame = () => {
            if (!isStreamingRef.current || !cameraActive) return;

            canvas.width = videoRef.current.videoWidth || 320;
            canvas.height = videoRef.current.videoHeight || 240;
            
            // Draw video frame
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            
            // Convert to low-quality JPEG for bandwidth
            const frameData = canvas.toDataURL('image/jpeg', 0.3);
            
            // Send via WebSocket
            if (socketRef.current && socketRef.current.connected) {
                socketRef.current.emit('video_frame', {
                    sessionId,
                    studentId: user.id,
                    examId,
                    frame: frameData,
                    timestamp: Date.now()
                });
            }
            
            // Continue streaming
            setTimeout(sendFrame, 100); // ~10 FPS
        };

        sendFrame();
    };

    const startAIProctoring = (sessionId) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const analyzeFrame = async () => {
            if (!isRecording || !cameraActive) return;

            canvas.width = 320;
            canvas.height = 240;
            ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
            
            const frameData = canvas.toDataURL('image/jpeg', 0.7);

            try {
                // Send to AI service
                const response = await fetch(`${AI_API_BASE_URL}/analyze`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        frame: frameData,
                        session_id: sessionId,
                        student_id: user.id
                    })
                });

                const data = await response.json();

                // Support both mock_server.py and advanced app.py response shapes
                const analysis = data.analysis || {};
                const aiAlerts = data.alerts || analysis.alerts || [];
                const focus =
                    data.focus_score ??
                    analysis.focus_score ??
                    analysis.metrics?.focus_score;

                if (typeof focus === 'number') {
                    setFocusScore(focus);
                }

                if (aiAlerts.length > 0) {
                    setAlerts(prev => [...aiAlerts, ...prev].slice(0, 10));

                    // Send alerts to instructor
                    if (socketRef.current && socketRef.current.connected) {
                        socketRef.current.emit('proctoring_alert', {
                            sessionId,
                            studentId: user.id,
                            alerts: aiAlerts,
                            focusScore: focus,
                            timestamp: Date.now()
                        });
                    }
                }

            } catch (error) {
                console.error('AI analysis error:', error);
            }
            
            // Continue analysis every 2 seconds
            setTimeout(() => analyzeFrame(), 2000);
        };

        analyzeFrame();
    };

    const startTimer = () => {
        const timer = setInterval(() => {
            setTimeRemaining(prev => {
                if (prev <= 0) {
                    clearInterval(timer);
                    submitExam();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
    };

    const stopCamera = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            setStream(null);
            setCameraActive(false);
            setIsStreaming(false);
        }
    };

    const submitExam = async () => {
        setIsRecording(false);
        setIsStreaming(false);
        stopAudioMonitoring();
        stopScreenMonitoring();
        stopCamera();
        
        if (socketRef.current) {
            socketRef.current.disconnect();
        }

        try {
            await fetch(`${API_BASE_URL}/api/exams/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    examId,
                    sessionId,
                    answers,
                    focusScore,
                    alertCount: alerts.length
                })
            });

            onComplete();
            
        } catch (error) {
            console.error('Submit error:', error);
        }
    };

    const formatTime = (seconds) => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    };

    const handleAnswerChange = (questionId, answer) => {
        setAnswers(prev => ({
            ...prev,
            [questionId]: answer
        }));
    };

    return (
        <div className="exam-room-container">
            <div className="exam-header">
                <h2>🎓 Exam in Progress - Live Proctoring Active</h2>
                <div className="exam-info">
                    <div className="timer">⏱️ Time: {formatTime(timeRemaining)}</div>
                    <div className={`focus-score ${focusScore > 70 ? 'good' : focusScore > 40 ? 'warning' : 'alert'}`}>
                        🎯 Focus: {focusScore}%
                    </div>
                    <div className="stream-status">
                        {isStreaming ? '📹 Live Streaming' : '📴 Stream Offline'}
                    </div>
                </div>
            </div>

            <div className="exam-content">
                {/* Left: Exam Questions */}
                <div className="questions-section">
                    <div className="section-header">
                        <h3>📝 Exam Questions</h3>
                        <div className="progress">3/{questions.length} questions</div>
                    </div>
                    
                    <div className="questions-list">
                        {questions.map((question, index) => (
                            <div key={question.id} className="question-card">
                                <div className="question-header">
                                    <span className="question-number">Q{index + 1}</span>
                                    <span className="question-points">1 point</span>
                                </div>
                                <p className="question-text">{question.text}</p>
                                <div className="options">
                                    {question.options.map((option, optIndex) => (
                                        <label key={optIndex} className={`option ${answers[question.id] === option ? 'selected' : ''}`}>
                                            <input
                                                type="radio"
                                                name={`question-${question.id}`}
                                                value={option}
                                                checked={answers[question.id] === option}
                                                onChange={() => handleAnswerChange(question.id, option)}
                                            />
                                            <span className="option-text">{option}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Right: Live Monitoring */}
                <div className="monitoring-section">
                    {/* Live Camera Feed */}
                    <div className="camera-feed-container">
                        <div className="feed-header">
                            <h3>📹 Live Proctoring Feed</h3>
                            <div className="camera-status">
                                {cameraActive ? '✅ Camera Active' : '❌ Camera Inactive'}
                            </div>
                        </div>
                        
                        <div className="video-wrapper">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="live-video-feed"
                            />
                            <div className="video-overlay">
                                <div className="student-info">
                                    <div className="student-name">{user.name}</div>
                                    <div className="student-id">{user.id}</div>
                                </div>
                                <div className="recording-indicator">
                                    <div className={`recording-dot ${isRecording ? 'recording' : ''}`}></div>
                                    {isRecording ? 'REC' : 'PAUSED'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Live Proctoring Alerts */}
                    <div className="alerts-container">
                        <div className="alerts-header">
                            <h3>🚨 Proctoring Alerts</h3>
                            <span className="alert-count">{alerts.length} alerts</span>
                        </div>
                        
                        <div className="alerts-list">
                            {alerts.length === 0 ? (
                                <div className="no-alerts">
                                    <div className="check-icon">✅</div>
                                    <p>All proctoring checks passing</p>
                                </div>
                            ) : (
                                alerts.map((alert, index) => (
                                    <div key={index} className={`alert-item ${alert.severity?.toLowerCase() || 'medium'}`}>
                                        <div className="alert-icon">
                                            {alert.severity === 'HIGH' ? '🔴' : 
                                             alert.severity === 'MEDIUM' ? '🟡' : '🟢'}
                                        </div>
                                        <div className="alert-content">
                                            <div className="alert-title">{alert.type || 'Alert'}</div>
                                            <div className="alert-desc">{alert.details || 'Anomaly detected'}</div>
                                            <div className="alert-time">
                                                {new Date(alert.timestamp || Date.now()).toLocaleTimeString()}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Proctoring Metrics */}
                    <div className="metrics-container">
                        <h3>📊 Live Metrics</h3>
                        <div className="metrics-grid">
                            <div className="metric-card">
                                <div className="metric-value">{focusScore}%</div>
                                <div className="metric-label">Focus Score</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-value">{alerts.filter(a => a.severity === 'HIGH').length}</div>
                                <div className="metric-label">High Alerts</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-value">
                                    {Math.floor((7200 - timeRemaining) / 60)} min
                                </div>
                                <div className="metric-label">Time Elapsed</div>
                            </div>
                            <div className="metric-card">
                                <div className="metric-value">
                                    {Object.keys(answers).filter(k => answers[k]).length}/{questions.length}
                                </div>
                                <div className="metric-label">Answered</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="exam-footer">
                {!isRecording ? (
                    <button 
                        className="btn-start-exam"
                        onClick={startExamSession}
                        disabled={!cameraActive}
                    >
                        {cameraActive ? '🚀 Start Exam with Live Proctoring' : '📷 Enable Camera First'}
                    </button>
                ) : (
                    <button 
                        className="btn-submit-exam"
                        onClick={submitExam}
                    >
                        📤 Submit Exam
                    </button>
                )}

                {isRecording && (
                    <button
                        className="btn-start-exam"
                        style={{ marginLeft: 12, backgroundColor: '#6b46c1' }}
                        onClick={startScreenMonitoring}
                    >
                        🖥️ Start Screen Monitoring
                    </button>
                )}
                
                <div className="proctoring-instructions">
                    <h4>📋 Proctoring Rules:</h4>
                    <ul>
                        <li>✅ Keep your face visible to camera</li>
                        <li>✅ Stay in frame during entire exam</li>
                        <li>❌ No mobile phones or secondary devices</li>
                        <li>❌ No looking away from screen</li>
                        <li>❌ No talking or communication</li>
                    </ul>
                </div>
            </div>
        </div>
    );
};

export default ExamRoom;