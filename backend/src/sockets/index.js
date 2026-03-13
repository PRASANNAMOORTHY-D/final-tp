const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

class LiveMonitoringServer {
    constructor(server) {
        this.wss = new WebSocket.Server({ 
            server,
            path: '/ws/live-monitoring'
        });
        
        // Store active connections
        this.students = new Map(); // studentId -> { ws, examId, sessionId }
        this.instructors = new Map(); // instructorId -> { ws, monitoring: [examIds] }
        this.videoFrames = new Map(); // studentId -> lastFrameData
        
        // Alert history
        this.alertHistory = new Map(); // studentId -> [{ alert, timestamp }]
        
        this.setupWebSocket();
        console.log('📡 Live Monitoring WebSocket Server Started');
    }
    
    setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            console.log('🔌 New WebSocket connection');
            
            // Parse query parameters
            const urlParams = new URLSearchParams(req.url.split('?')[1]);
            const role = urlParams.get('role');
            const studentId = urlParams.get('studentId');
            const instructorId = urlParams.get('instructorId');
            const examId = urlParams.get('examId');
            const sessionId = urlParams.get('sessionId');
            
            ws.userData = { role, studentId, instructorId, examId, sessionId };
            
            if (role === 'student' && studentId && examId) {
                this.handleStudentConnection(ws, studentId, examId, sessionId);
            } else if (role === 'instructor' && instructorId) {
                this.handleInstructorConnection(ws, instructorId, examId);
            } else {
                ws.close(1008, 'Invalid connection parameters');
            }
            
            ws.on('message', (message) => {
                this.handleMessage(ws, message);
            });
            
            ws.on('close', () => {
                this.handleDisconnection(ws);
            });
            
            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
            });
        });
    }
    
    handleStudentConnection(ws, studentId, examId, sessionId) {
        console.log(`📱 Student connected: ${studentId} for exam ${examId}`);
        
        // Store student connection
        this.students.set(studentId, {
            ws,
            examId,
            sessionId,
            connectedAt: new Date(),
            lastHeartbeat: new Date()
        });
        
        // Notify instructors monitoring this exam
        this.notifyInstructors(examId, {
            type: 'STUDENT_CONNECTED',
            studentId,
            examId,
            sessionId,
            timestamp: new Date().toISOString()
        });
        
        // Send welcome message
        ws.send(JSON.stringify({
            type: 'CONNECTION_ESTABLISHED',
            message: 'Connected to live proctoring server',
            sessionId,
            timestamp: new Date().toISOString()
        }));
    }
    
    handleInstructorConnection(ws, instructorId, examId) {
        console.log(`👨‍🏫 Instructor connected: ${instructorId}`);
        
        // Store instructor connection
        this.instructors.set(instructorId, {
            ws,
            examId,
            connectedAt: new Date(),
            monitoring: examId ? [examId] : []
        });
        
        // Send current active students
        const activeStudents = this.getActiveStudents(examId);
        ws.send(JSON.stringify({
            type: 'ACTIVE_STUDENTS',
            students: activeStudents,
            count: activeStudents.length,
            timestamp: new Date().toISOString()
        }));
        
        // Send recent alerts if any
        const recentAlerts = this.getRecentAlerts(examId);
        if (recentAlerts.length > 0) {
            ws.send(JSON.stringify({
                type: 'RECENT_ALERTS',
                alerts: recentAlerts,
                timestamp: new Date().toISOString()
            }));
        }
    }
    
    handleMessage(ws, message) {
        try {
            const data = JSON.parse(message.toString());
            
            switch(data.type) {
                case 'exam_started':
                    this.handleExamStarted(data, ws);
                    break;
                    
                case 'proctoring_data':
                    this.handleProctoringData(data, ws);
                    break;
                    
                case 'video_frame':
                    this.handleVideoFrame(data, ws);
                    break;
                    
                case 'instructor_message':
                    this.handleInstructorMessage(data, ws);
                    break;
                    
                case 'heartbeat':
                    this.handleHeartbeat(data, ws);
                    break;
                    
                case 'request_student_feed':
                    this.handleFeedRequest(data, ws);
                    break;
                    
                case 'manual_alert':
                    this.handleManualAlert(data, ws);
                    break;
                    
                default:
                    console.log('Unknown message type:', data.type);
            }
            
        } catch (error) {
            console.error('Message parsing error:', error);
        }
    }
    
    handleExamStarted(data, ws) {
        const { studentId, examId, sessionId } = data;
        console.log(`🎬 Exam started: ${studentId} for ${examId}`);
        
        // Update student data
        const student = this.students.get(studentId);
        if (student) {
            student.sessionId = sessionId;
            student.examStarted = new Date();
        }
        
        // Broadcast to instructors
        this.broadcastToInstructors(examId, {
            type: 'EXAM_STARTED',
            studentId,
            examId,
            sessionId,
            timestamp: new Date().toISOString()
        });
    }
    
    handleProctoringData(data, ws) {
        const { studentId, examId, analysis, sessionId } = data;
        
        console.log(`📊 Proctoring data from ${studentId}:`, analysis.alerts?.length || 0, 'alerts');
        
        // Store latest analysis
        const student = this.students.get(studentId);
        if (student) {
            student.lastAnalysis = analysis;
            student.lastUpdate = new Date();
            
            // Calculate focus score
            if (analysis.focus_score !== undefined) {
                student.focusScore = analysis.focus_score;
            }
        }
        
        // Store alerts
        if (analysis.alerts && analysis.alerts.length > 0) {
            this.storeAlerts(studentId, examId, analysis.alerts);
        }
        
        // Broadcast to instructors
        this.broadcastToInstructors(examId, {
            type: 'PROCTORING_UPDATE',
            studentId,
            examId,
            sessionId,
            analysis: analysis,
            timestamp: new Date().toISOString()
        });
    }
    
    handleVideoFrame(data, ws) {
        const { studentId, examId, frame, timestamp } = data;
        
        // Store latest frame
        this.videoFrames.set(studentId, {
            frame,
            timestamp: new Date(timestamp),
            studentId,
            examId
        });
        
        // Broadcast to instructors monitoring this student
        this.broadcastToInstructors(examId, {
            type: 'LIVE_VIDEO_FRAME',
            studentId,
            examId,
            frame: frame.substring(0, 100) + '...', // Send truncated frame for demo
            thumbnail: this.createThumbnail(frame),
            timestamp: new Date().toISOString()
        });
    }
    
    handleInstructorMessage(data, ws) {
        const { studentId, examId, message } = data;
        const student = this.students.get(studentId);
        
        if (student && student.ws.readyState === WebSocket.OPEN) {
            student.ws.send(JSON.stringify({
                type: 'INSTRUCTOR_MESSAGE',
                message,
                timestamp: new Date().toISOString(),
                from: ws.userData.instructorId
            }));
        }
    }
    
    handleHeartbeat(data, ws) {
        const { studentId } = data;
        const student = this.students.get(studentId);
        
        if (student) {
            student.lastHeartbeat = new Date();
        }
    }
    
    handleFeedRequest(data, ws) {
        const { studentId } = data;
        const frame = this.videoFrames.get(studentId);
        
        if (frame && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'STUDENT_FEED',
                studentId,
                frame: frame.frame,
                timestamp: frame.timestamp.toISOString()
            }));
        }
    }
    
    handleManualAlert(data, ws) {
        const { studentId, examId, alert, reason } = data;
        
        const manualAlert = {
            type: 'MANUAL_ALERT',
            severity: 'HIGH',
            details: `Manual alert: ${alert}`,
            reason: reason,
            timestamp: new Date(),
            triggeredBy: ws.userData.instructorId
        };
        
        // Store alert
        this.storeAlerts(studentId, examId, [manualAlert]);
        
        // Broadcast to all instructors
        this.broadcastToInstructors(examId, {
            type: 'MANUAL_ALERT_ISSUED',
            studentId,
            examId,
            alert: manualAlert,
            timestamp: new Date().toISOString()
        });
        
        // Send to student
        const student = this.students.get(studentId);
        if (student && student.ws.readyState === WebSocket.OPEN) {
            student.ws.send(JSON.stringify({
                type: 'MANUAL_ALERT',
                alert: manualAlert,
                timestamp: new Date().toISOString()
            }));
        }
    }
    
    handleDisconnection(ws) {
        const { role, studentId, instructorId, examId } = ws.userData;
        
        if (role === 'student' && studentId) {
            this.students.delete(studentId);
            this.videoFrames.delete(studentId);
            console.log(`📱 Student disconnected: ${studentId}`);
            
            // Notify instructors
            this.notifyInstructors(examId, {
                type: 'STUDENT_DISCONNECTED',
                studentId,
                examId,
                timestamp: new Date().toISOString()
            });
            
        } else if (role === 'instructor' && instructorId) {
            this.instructors.delete(instructorId);
            console.log(`👨‍🏫 Instructor disconnected: ${instructorId}`);
        }
    }
    
    // Utility methods
    broadcastToInstructors(examId, data) {
        this.instructors.forEach((instructor, instructorId) => {
            if (instructor.ws.readyState === WebSocket.OPEN) {
                // Check if instructor is monitoring this exam
                if (!examId || instructor.monitoring.includes(examId)) {
                    instructor.ws.send(JSON.stringify(data));
                }
            }
        });
    }
    
    notifyInstructors(examId, data) {
        this.broadcastToInstructors(examId, data);
    }
    
    getActiveStudents(examId) {
        const active = [];
        
        this.students.forEach((student, studentId) => {
            if (!examId || student.examId === examId) {
                active.push({
                    studentId,
                    examId: student.examId,
                    sessionId: student.sessionId,
                    connectedAt: student.connectedAt,
                    focusScore: student.focusScore || 100,
                    lastUpdate: student.lastUpdate,
                    alertCount: this.getStudentAlertCount(studentId)
                });
            }
        });
        
        return active;
    }
    
    getRecentAlerts(examId, limit = 20) {
        const recentAlerts = [];
        
        this.alertHistory.forEach((alerts, studentId) => {
            const student = this.students.get(studentId);
            if (!examId || (student && student.examId === examId)) {
                alerts.forEach(alert => {
                    recentAlerts.push({
                        studentId,
                        ...alert
                    });
                });
            }
        });
        
        // Sort by timestamp and limit
        return recentAlerts
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, limit);
    }
    
    getStudentAlertCount(studentId) {
        const alerts = this.alertHistory.get(studentId) || [];
        return alerts.length;
    }
    
    storeAlerts(studentId, examId, alerts) {
        if (!this.alertHistory.has(studentId)) {
            this.alertHistory.set(studentId, []);
        }
        
        const studentAlerts = this.alertHistory.get(studentId);
        alerts.forEach(alert => {
            studentAlerts.push({
                ...alert,
                examId,
                timestamp: new Date(alert.timestamp || Date.now())
            });
        });
        
        // Keep only last 50 alerts per student
        if (studentAlerts.length > 50) {
            studentAlerts.splice(0, studentAlerts.length - 50);
        }
    }
    
    createThumbnail(frameData) {
        // In production, create actual thumbnail
        // For demo, return a placeholder
        return 'data:image/svg+xml;base64,' + btoa(`
            <svg width="100" height="75" xmlns="http://www.w3.org/2000/svg">
                <rect width="100" height="75" fill="#4a5568"/>
                <text x="50" y="40" text-anchor="middle" fill="white" font-family="Arial" font-size="12">
                    Live Feed
                </text>
            </svg>
        `);
    }
    
    // Cleanup inactive connections
    cleanupInactiveConnections() {
        const now = new Date();
        const timeout = 30000; // 30 seconds
        
        this.students.forEach((student, studentId) => {
            if (now - student.lastHeartbeat > timeout) {
                console.log(`Cleaning up inactive student: ${studentId}`);
                student.ws.close();
                this.students.delete(studentId);
            }
        });
    }
}

module.exports = LiveMonitoringServer;