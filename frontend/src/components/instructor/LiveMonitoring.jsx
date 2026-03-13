import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { API_BASE_URL, WS_URL } from '../../config';

const LiveMonitoring = ({ examId }) => {
    const [activeSessions, setActiveSessions] = useState([]);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [liveFeed, setLiveFeed] = useState(null);
    const [alerts, setAlerts] = useState([]);
    const socketRef = useRef(null);
    const videoRefs = useRef({});
    const selectedStudentRef = useRef(null);
    const selectedVideoCanvasRef = useRef(null);
    const selectedVideoElementRef = useRef(null);

    useEffect(() => {
        selectedStudentRef.current = selectedStudent;

        if (selectedVideoCanvasRef.current && selectedVideoElementRef.current) {
            const canvas = selectedVideoCanvasRef.current;
            const videoEl = selectedVideoElementRef.current;

            if (!videoEl.srcObject) {
                const stream = canvas.captureStream(15);
                videoEl.srcObject = stream;
            }
        }
    }, [selectedStudent]);

    useEffect(() => {
        if (liveFeed && selectedStudent) {
            updateSelectedStudentVideo(liveFeed);
        }
    }, [liveFeed, selectedStudent]);

    useEffect(() => {
        connectWebSocket();
        loadActiveSessions();
        
        return () => {
            if (socketRef.current) {
                socketRef.current.disconnect();
            }
        };
    }, [examId]);

    const connectWebSocket = () => {
        const socket = io(WS_URL, {
            transports: ['websocket'],
            query: {
                role: 'instructor',
                examId: examId
            }
        });

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('Instructor connected to monitoring server');
        });

        // Initial snapshot of active students
        socket.on('active_students', (data) => {
            const list = data?.students || [];
            setActiveSessions(list.map(s => ({
                studentId: s.studentId || s.id,
                studentName: s.studentName || s.studentId || s.id,
                examId: s.examId,
                joinedAt: s.joinedAt || new Date().toISOString(),
                alerts: s.alerts || [],
                focusScore: s.focusScore || 100
            })));
        });

        socket.on('new_student_session', (data) => {
            console.log('New student joined:', data);
            setActiveSessions(prev => {
                if (!prev.find(s => s.studentId === data.studentId)) {
                    return [...prev, {
                        ...data,
                        joinedAt: new Date().toISOString(),
                        alerts: [],
                        focusScore: 100
                    }];
                }
                return prev;
            });
        });

        socket.on('video_frame', (data) => {
            // Update specific student's video feed
            if (selectedStudentRef.current === data.studentId) {
                setLiveFeed(data.frame);
                updateSelectedStudentVideo(data.frame);
            }
            
            // Update thumbnail for student in list
            updateStudentThumbnail(data.studentId, data.frame);
        });

        socket.on('proctoring_alert', (data) => {
            console.log('Proctoring alert:', data);
            
            // Add to alerts list
            setAlerts(prev => [{
                ...data,
                id: Date.now() + Math.random()
            }, ...prev].slice(0, 50));
            
            // Update student's alert count
            setActiveSessions(prev => 
                prev.map(session => 
                    session.studentId === data.studentId 
                    ? { 
                        ...session, 
                        alerts: [...(session.alerts || []), ...data.alerts],
                        focusScore: data.focusScore || session.focusScore
                      } 
                    : session
                )
            );
        });

        socket.on('student_disconnected', (data) => {
            setActiveSessions(prev => 
                prev.filter(s => s.studentId !== data.studentId)
            );
        });
    };

    const loadActiveSessions = async () => {
        try {
            // Backend route is /api/exams/sessions/active for instructors in this project.
            const response = await fetch(`${API_BASE_URL}/api/exams/sessions/active`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            const data = await response.json();
            setActiveSessions(data.sessions || []);
        } catch (error) {
            console.error('Error loading sessions:', error);
        }
    };

    const updateStudentThumbnail = (studentId, frameData) => {
        // For real-time stability, avoid creating Blob URLs every frame.
        // Just set the data URL directly.
        const img = document.getElementById(`thumb-${studentId}`);
        if (img) img.src = frameData;
    };

    const updateSelectedStudentVideo = (frameData) => {
        if (!selectedVideoCanvasRef.current || !frameData) return;

        const canvas = selectedVideoCanvasRef.current;
        const ctx = canvas.getContext('2d');

        const img = new Image();
        img.onload = () => {
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = frameData;
    };

    const selectStudent = (student) => {
        setSelectedStudent(student.studentId);

        // Video frames are already broadcast by the backend; selecting just switches UI.
        setLiveFeed(null);
    };

    const sendMessageToStudent = (studentId, message) => {
        if (socketRef.current) {
            socketRef.current.emit('instructor_message', {
                studentId,
                examId,
                message,
                timestamp: new Date().toISOString()
            });
            
            alert(`Message sent to student: "${message}"`);
        }
    };

    const flagStudent = (studentId, reason) => {
        if (socketRef.current) {
            socketRef.current.emit('flag_student', {
                studentId,
                examId,
                reason,
                timestamp: new Date().toISOString()
            });
            
            // Update local state
            setActiveSessions(prev => 
                prev.map(s => 
                    s.studentId === studentId 
                    ? { ...s, flagged: true, flagReason: reason }
                    : s
                )
            );
        }
    };

    const getAlertStats = () => {
        const stats = {
            high: alerts.filter(a => a.severity === 'HIGH').length,
            medium: alerts.filter(a => a.severity === 'MEDIUM').length,
            low: alerts.filter(a => a.severity === 'LOW').length,
            total: alerts.length
        };
        return stats;
    };

    return (
        <div className="live-monitoring-container" style={{ width: '100%' }}>
            {/* Header */}
            <div className="monitoring-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <h1>📡 Live Proctoring Dashboard</h1>
                <div className="header-stats">
                    <div className="stat-card">
                        <div className="stat-value">{activeSessions.length}</div>
                        <div className="stat-label">Active Students</div>
                    </div>
                    <div className="stat-card alert-high">
                        <div className="stat-value">{getAlertStats().high}</div>
                        <div className="stat-label">High Alerts</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value">{getAlertStats().total}</div>
                        <div className="stat-label">Total Alerts</div>
                    </div>
                </div>
            </div>

            <div className="monitoring-content" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                {/* Left: Student Grid */}
                <div className="students-grid-section">
                    <div className="section-header">
                        <h2>👥 Active Students ({activeSessions.length})</h2>
                        <button 
                            className="btn-refresh"
                            onClick={loadActiveSessions}
                        >
                            ↻ Refresh
                        </button>
                    </div>
                    
                    <div className="students-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
                        {activeSessions.map((student) => (
                            <div 
                                key={student.studentId}
                                className={`student-card ${selectedStudent === student.studentId ? 'selected' : ''} ${student.flagged ? 'flagged' : ''}`}
                                onClick={() => selectStudent(student)}
                                style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff', cursor: 'pointer' }}
                            >
                                <div className="student-header">
                                    <div className="student-avatar">
                                        {student.studentName?.charAt(0) || 'S'}
                                    </div>
                                    <div className="student-info">
                                        <div className="student-name">{student.studentName}</div>
                                        <div className="student-id">{student.studentId}</div>
                                    </div>
                                    <div className={`alert-badge ${student.alerts?.length > 2 ? 'high' : student.alerts?.length > 0 ? 'medium' : 'none'}`}>
                                        {student.alerts?.length || 0}
                                    </div>
                                </div>
                                
                                <div className="video-thumbnail">
                                    <img 
                                        id={`thumb-${student.studentId}`}
                                        alt={`${student.studentName} live feed`}
                                        ref={el => videoRefs.current[student.studentId] = el}
                                        style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10, background: '#0b1020' }}
                                    />
                                    <div className="thumbnail-overlay">
                                        <div className="focus-score">
                                            🎯 {student.focusScore || 100}%
                                        </div>
                                        <div className="session-time">
                                            ⏱️ {Math.floor((Date.now() - new Date(student.joinedAt).getTime()) / 60000)} min
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="student-actions">
                                    <button 
                                        className="btn-message"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const message = prompt('Enter message to student:');
                                            if (message) sendMessageToStudent(student.studentId, message);
                                        }}
                                    >
                                        💬 Message
                                    </button>
                                    <button 
                                        className="btn-flag"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const reason = prompt('Flag student for (reason):');
                                            if (reason) flagStudent(student.studentId, reason);
                                        }}
                                    >
                                        🚩 Flag
                                    </button>
                                </div>
                            </div>
                        ))}
                        
                        {activeSessions.length === 0 && (
                            <div className="no-students">
                                <div className="empty-icon">👨‍🎓</div>
                                <p>No active exam sessions</p>
                                <small>Waiting for students to start exams...</small>
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: Live Feed & Controls */}
                <div className="live-feed-section">
                    {/* Selected Student Live Feed */}
                    <div className="live-feed-container">
                        <div className="feed-header">
                            <h3>📹 Live Student Feed</h3>
                            {selectedStudent && (
                                <div className="selected-student-info">
                                    {activeSessions.find(s => s.studentId === selectedStudent)?.studentName}
                                </div>
                            )}
                        </div>
                        
                        <div className="video-feed">
                            {selectedStudent ? (
                                <>
                                    <video
                                        ref={selectedVideoElementRef}
                                        autoPlay
                                        muted
                                        playsInline
                                        className="main-video-feed"
                                        style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10, background: '#0b1020' }}
                                    />
                                    <canvas
                                        ref={selectedVideoCanvasRef}
                                        style={{ display: 'none' }}
                                    />
                                    <div style={{ marginTop: 6, color: '#eaeaea' }}>
                                        <strong>Streaming as video:</strong> This displays incoming frames via a live canvas capture stream for smoother playback.
                                    </div>
                                    <div className="video-controls">
                                        <button className="btn-control">
                                            ⏸️ Pause
                                        </button>
                                        <button className="btn-control">
                                            📸 Snapshot
                                        </button>
                                        <button className="btn-control">
                                            🔍 Zoom
                                        </button>
                                        <button 
                                            className="btn-control alert"
                                            onClick={() => {
                                                const alert = prompt('Issue manual alert:');
                                                if (alert) {
                                                    socketRef.current.emit('manual_alert', {
                                                        studentId: selectedStudent,
                                                        examId,
                                                        alert
                                                    });
                                                }
                                            }}
                                        >
                                            🚨 Manual Alert
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="no-feed-selected">
                                    <div className="select-prompt">👆</div>
                                    <p>Select a student to view live feed</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Real-time Alerts Feed */}
                    <div className="alerts-feed">
                        <div className="alerts-header">
                            <h3>🚨 Live Alerts Feed</h3>
                            <button 
                                className="btn-clear-alerts"
                                onClick={() => setAlerts([])}
                            >
                                Clear All
                            </button>
                        </div>
                        
                        <div className="alerts-list">
                            {alerts.length === 0 ? (
                                <div className="no-alerts">
                                    <div className="check-icon">✅</div>
                                    <p>No alerts at the moment</p>
                                </div>
                            ) : (
                                alerts.map((alert, index) => (
                                    <div key={alert.id || index} className={`alert-feed-item ${alert.severity?.toLowerCase()}`}>
                                        <div className="alert-time">
                                            {new Date(alert.timestamp).toLocaleTimeString()}
                                        </div>
                                        <div className="alert-student">
                                            {alert.studentId}
                                        </div>
                                        <div className="alert-content">
                                            {alert.alerts?.[0]?.type || alert.type || 'Alert'}
                                        </div>
                                        <div className="alert-actions">
                                            <button 
                                                className="btn-dismiss"
                                                onClick={() => {
                                                    setAlerts(prev => prev.filter(a => a.id !== alert.id));
                                                }}
                                            >
                                                Dismiss
                                            </button>
                                            <button 
                                                className="btn-view"
                                                onClick={() => {
                                                    selectStudent({ studentId: alert.studentId });
                                                }}
                                            >
                                                View
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Quick Stats */}
                    <div className="quick-stats">
                        <h3>📊 Exam Overview</h3>
                        <div className="stats-grid">
                            <div className="stat-item">
                                <div className="stat-icon">👥</div>
                                <div className="stat-details">
                                    <div className="stat-title">Active Students</div>
                                    <div className="stat-value">{activeSessions.length}</div>
                                </div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-icon">🚨</div>
                                <div className="stat-details">
                                    <div className="stat-title">Active Alerts</div>
                                    <div className="stat-value">{getAlertStats().high}</div>
                                </div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-icon">🎯</div>
                                <div className="stat-details">
                                    <div className="stat-title">Avg Focus</div>
                                    <div className="stat-value">
                                        {activeSessions.length > 0 
                                            ? Math.round(activeSessions.reduce((a, s) => a + (s.focusScore || 100), 0) / activeSessions.length)
                                            : 0}%
                                    </div>
                                </div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-icon">⏱️</div>
                                <div className="stat-details">
                                    <div className="stat-title">Avg Time</div>
                                    <div className="stat-value">
                                        {activeSessions.length > 0 
                                            ? Math.round(activeSessions.reduce((a, s) => {
                                                const mins = (Date.now() - new Date(s.joinedAt).getTime()) / 60000;
                                                return a + mins;
                                            }, 0) / activeSessions.length)
                                            : 0} min
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LiveMonitoring;