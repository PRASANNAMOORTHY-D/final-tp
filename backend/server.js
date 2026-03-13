const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');

// Import routes (from src folder)
const authRoutes = require('./src/routes/auth');
const examRoutes = require('./src/routes/exam');
const adminRoutes = require('./src/routes/admin');
const store = require('./src/data/store');
const bus = require('./src/events/bus');

// Initialize app
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = socketIo(server, {
    cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
    }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store active connections
const activeConnections = {
    students: new Map(),
    instructors: new Map()
};

// In-memory risk score tracker (0-100) per session
// Keyed by `${examId}:${studentId}` to keep it simple for the demo store.
const riskScores = new Map();

function riskKey({ examId, studentId }) {
    return `${examId || 'unknown'}:${studentId || 'unknown'}`;
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function severityWeight(severity) {
    const s = String(severity || '').toUpperCase();
    if (s === 'HIGH') return 15;
    if (s === 'MEDIUM') return 7;
    if (s === 'LOW') return 3;
    if (s === 'INFO') return 0;
    return 5;
}

function getOrInitRiskScore({ examId, studentId }) {
    const key = riskKey({ examId, studentId });
    if (!riskScores.has(key)) riskScores.set(key, 0);
    return riskScores.get(key) || 0;
}

function updateRiskScore({ examId, studentId, delta }) {
    const key = riskKey({ examId, studentId });
    const prev = getOrInitRiskScore({ examId, studentId });
    const next = clamp(prev + (Number(delta) || 0), 0, 100);
    riskScores.set(key, next);
    return { prev, next };
}

function upsertSessionInStore({ examId, studentId, studentName }) {
    if (!examId || !studentId) return null;
    let session = store.examSessions.find(s => s.examId === examId && s.studentId === studentId);
    if (!session) {
        session = {
            sessionId: null,
            examId,
            studentId,
            studentName: studentName || studentId,
            startTime: new Date().toISOString(),
            status: 'active',
            proctoringEnabled: true,
            cameraActive: true,
            alerts: [],
            focusScore: 100,
            riskScore: 0
        };
        store.examSessions.push(session);
    } else {
        if (studentName && !session.studentName) session.studentName = studentName;
    }
    return session;
}

function pushAlertsToSession({ examId, studentId, alerts, focusScore, riskScore }) {
    const session = upsertSessionInStore({ examId, studentId });
    if (!session) return;
    if (Array.isArray(alerts) && alerts.length > 0) {
        session.alerts = [...(session.alerts || []), ...alerts].slice(-200);
    }
    if (typeof focusScore === 'number' && !Number.isNaN(focusScore)) {
        session.focusScore = clamp(focusScore, 0, 100);
    }
    if (typeof riskScore === 'number' && !Number.isNaN(riskScore)) {
        session.riskScore = clamp(riskScore, 0, 100);
    }
}

function broadcastRiskScore(ioOrSocket, payload) {
    // Payload: { studentId, examId, riskScore, delta, reason, timestamp }
    (ioOrSocket || io).emit('risk_score_update', payload);
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);
    
    // Handle authentication (used to drive instructor dashboard state)
    socket.on('authenticate', (data = {}) => {
        const { role, userId, examId, studentName } = data;

        if (!role || !userId) return;
        
        if (role === 'student') {
            activeConnections.students.set(userId, {
                socketId: socket.id,
                examId,
                studentName,
                connectedAt: new Date()
            });

            // Ensure we have a session record for dashboards that poll REST endpoints.
            upsertSessionInStore({ examId, studentId: userId, studentName });
            
            console.log(`Student ${userId} connected for exam ${examId}`);
            
            // Notify instructors in the format the frontend expects
            socket.broadcast.emit('new_student_session', {
                studentId: userId,
                studentName: studentName || userId,
                examId,
                sessionId: null,
                joinedAt: new Date().toISOString(),
                alerts: [],
                focusScore: 100
            });
            
        } else if (role === 'instructor') {
            activeConnections.instructors.set(userId, {
                socketId: socket.id,
                examId,
                connectedAt: new Date()
            });
            
            console.log(`Instructor ${userId} connected`);
            
            // Send current active students snapshot
            const activeStudents = Array.from(activeConnections.students.entries())
                .map(([id, data]) => ({
                    studentId: id,
                    studentName: data.studentName || id,
                    examId: data.examId,
                    joinedAt: data.connectedAt,
                    alerts: [],
                    focusScore: 100
                }));
            
            socket.emit('active_students', {
                students: activeStudents,
                timestamp: new Date().toISOString()
            });
        }
        
        socket.userData = { role, userId, examId };
    });
    
    // Handle video frame
    socket.on('video_frame', (data = {}) => {
        const { studentId, examId, frame, timestamp } = data;
        if (!studentId || !frame) return;
        
        // Broadcast to instructors; event name matches instructor dashboard
        socket.broadcast.emit('video_frame', {
            studentId,
            examId,
            frame,
            timestamp: timestamp || Date.now()
        });
    });
    
    // Handle proctoring alerts coming from AI / client
    socket.on('proctoring_alert', (data = {}) => {
        const { studentId, examId, alerts, focusScore } = data;
        if (!studentId || !examId) return;

        // Update risk score based on incoming alerts
        const incomingAlerts = Array.isArray(alerts) ? alerts : [];
        const totalDelta = incomingAlerts.reduce((sum, a) => sum + severityWeight(a?.severity), 0);
        const { next } = updateRiskScore({ examId, studentId, delta: totalDelta });

        // Keep REST dashboard data consistent
        pushAlertsToSession({
            examId,
            studentId,
            alerts: incomingAlerts,
            focusScore: typeof focusScore === 'number' ? focusScore : undefined,
            riskScore: next
        });
        
        // Forward directly in the shape the instructor UI expects
        socket.broadcast.emit('proctoring_alert', {
            studentId,
            examId,
            alerts: alerts || [],
            focusScore,
            riskScore: next,
            timestamp: new Date().toISOString()
        });

        // Also notify everyone of the updated risk score (student + instructors)
        broadcastRiskScore(io, {
            studentId,
            examId,
            riskScore: next,
            delta: totalDelta,
            reason: 'ALERTS',
            timestamp: new Date().toISOString()
        });
    });

    // Generic proctoring events (tab switch, copy/paste, fullscreen exit, etc.)
    socket.on('proctoring_event', (data) => {
        const { studentId, examId, sessionId, type, severity, details, meta, timestamp } = data || {};

        if (!studentId || !examId || !type) return;

        const delta = severityWeight(severity);
        const { next } = updateRiskScore({ examId, studentId, delta });

        // Persist into demo store so dashboards that poll can see it
        const normalizedAlert = {
            type,
            severity: severity || 'MEDIUM',
            confidence: meta?.confidence,
            details: details || type,
            timestamp: timestamp || new Date().toISOString(),
            meta: meta || {}
        };
        pushAlertsToSession({
            examId,
            studentId,
            alerts: [normalizedAlert],
            focusScore: typeof meta?.focusScore === 'number' ? meta.focusScore : undefined,
            riskScore: next
        });

        // Broadcast in a format the instructor dashboard already understands
        socket.broadcast.emit('proctoring_alert', {
            sessionId,
            studentId,
            examId,
            focusScore: meta?.focusScore,
            alerts: [
                normalizedAlert
            ],
            riskScore: next,
            timestamp: timestamp || new Date().toISOString()
        });

        broadcastRiskScore(io, {
            studentId,
            examId,
            riskScore: next,
            delta,
            reason: type,
            timestamp: timestamp || new Date().toISOString()
        });
    });

    // Handle rich proctoring data from legacy exam room (includes analysis + alerts)
    socket.on('proctoring_data', (data = {}) => {
        const { studentId, examId, analysis } = data;
        if (!studentId || !examId || !analysis) return;

        const alerts = analysis.alerts || [];
        const focusScore =
            analysis.focus_score ||
            analysis.integrity_score ||
            (analysis.metrics && analysis.metrics.focus_score);

        const incomingAlerts = Array.isArray(alerts) ? alerts : [];
        const totalDelta = incomingAlerts.reduce((sum, a) => sum + severityWeight(a?.severity), 0);
        const { next } = updateRiskScore({ examId, studentId, delta: totalDelta });

        pushAlertsToSession({
            examId,
            studentId,
            alerts: incomingAlerts,
            focusScore: typeof focusScore === 'number' ? focusScore : undefined,
            riskScore: next
        });

        socket.broadcast.emit('proctoring_alert', {
            studentId,
            examId,
            alerts,
            focusScore,
            riskScore: next,
            timestamp: new Date().toISOString()
        });

        if (totalDelta > 0) {
            broadcastRiskScore(io, {
                studentId,
                examId,
                riskScore: next,
                delta: totalDelta,
                reason: 'AI_ALERTS',
                timestamp: new Date().toISOString()
            });
        }
    });

    // Instructor manual alert -> forward to student and update dashboards/risk
    socket.on('manual_alert', (data = {}) => {
        const { studentId, examId, alert } = data;
        if (!studentId || !examId || !alert) return;

        const student = activeConnections.students.get(studentId);
        const manual = {
            type: 'MANUAL_ALERT',
            severity: 'HIGH',
            details: String(alert),
            timestamp: new Date().toISOString()
        };

        const delta = severityWeight(manual.severity);
        const { next } = updateRiskScore({ examId, studentId, delta });

        pushAlertsToSession({
            examId,
            studentId,
            alerts: [manual],
            riskScore: next
        });

        // Notify the student (so student dashboard updates immediately)
        if (student?.socketId) {
            io.to(student.socketId).emit('manual_alert', {
                studentId,
                examId,
                alert: manual,
                timestamp: manual.timestamp,
                riskScore: next
            });
        }

        // Notify instructors too (so instructor feed shows it)
        socket.broadcast.emit('proctoring_alert', {
            studentId,
            examId,
            alerts: [manual],
            focusScore: undefined,
            riskScore: next,
            timestamp: manual.timestamp
        });

        broadcastRiskScore(io, {
            studentId,
            examId,
            riskScore: next,
            delta,
            reason: 'MANUAL_ALERT',
            timestamp: manual.timestamp
        });
    });

    // Instructor flags student -> forward to student + update store
    socket.on('flag_student', (data = {}) => {
        const { studentId, examId, reason } = data;
        if (!studentId || !examId) return;

        const student = activeConnections.students.get(studentId);
        const ts = new Date().toISOString();

        const session = upsertSessionInStore({ examId, studentId });
        if (session) {
            session.flagged = true;
            session.flagReason = reason || 'Flagged by instructor';
            session.flaggedAt = ts;
        }

        if (student?.socketId) {
            io.to(student.socketId).emit('student_flagged', {
                studentId,
                examId,
                reason: reason || 'Flagged by instructor',
                timestamp: ts
            });
        }

        socket.broadcast.emit('student_flagged', {
            studentId,
            examId,
            reason: reason || 'Flagged by instructor',
            timestamp: ts
        });
    });
    
    // Handle instructor messages
    socket.on('instructor_message', (data) => {
        const { studentId, message } = data;
        const student = activeConnections.students.get(studentId);
        
        if (student) {
            io.to(student.socketId).emit('instructor_message', {
                message,
                timestamp: new Date().toISOString()
            });
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        if (socket.userData) {
            const { role, userId } = socket.userData;
            
            if (role === 'student') {
                const student = activeConnections.students.get(userId);
                activeConnections.students.delete(userId);
                
                // Notify instructors
                socket.broadcast.emit('student_disconnected', {
                    studentId: userId,
                    examId: student?.examId,
                    timestamp: new Date().toISOString()
                });
                
            } else if (role === 'instructor') {
                activeConnections.instructors.delete(userId);
            }
        }
    });
});

// Broadcast exam/result updates to connected clients
bus.on('exam:changed', (payload) => {
    io.emit('exam_changed', {
        ...payload,
        timestamp: new Date().toISOString()
    });
});

bus.on('result:published', (payload) => {
    io.emit('result_published', {
        ...payload,
        timestamp: new Date().toISOString()
    });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/admin', adminRoutes);

// Simple chatbot endpoint (works with OPENAI_API_KEY if provided)
app.post('/api/chat', async (req, res) => {
    try {
        const { message, scope, user } = req.body || {};
        if (!message) {
            return res.status(400).json({ error: 'message is required' });
        }

        // If no API key, return a helpful offline answer (demo mode)
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            return res.json({
                answer:
                    `Chatbot is running in demo mode (no OPENAI_API_KEY set).\n\n` +
                    `You asked: "${message}"\n\n` +
                    `Try setting OPENAI_API_KEY in backend environment to enable real AI responses.`
            });
        }

        // Minimal OpenAI-compatible call (Responses API via HTTPS)
        const system =
            scope === 'instructor'
                ? 'You are an assistant for an instructor using an online proctoring system. Be concise and actionable.'
                : scope === 'student'
                    ? 'You are an assistant for a student taking an online proctored exam. Be clear and supportive. Do not help cheat.'
                    : 'You are an assistant for an online proctoring system.';

        const payload = {
            model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
            input: [
                { role: 'system', content: system },
                { role: 'user', content: `User: ${JSON.stringify(user || {})}\nQuestion: ${message}` }
            ]
        };

        const { data } = await axios.post('https://api.openai.com/v1/responses', payload, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 20000
        });

        // Extract text from the response safely
        const text =
            data?.output_text ||
            data?.output?.[0]?.content?.map(c => c?.text).filter(Boolean).join('') ||
            'No response text.';

        return res.json({ answer: text });
    } catch (error) {
        return res.status(502).json({
            error: 'Chatbot request failed',
            details: error.response?.data || error.message
        });
    }
});

// Streaming chatbot (Server-Sent Events): POST /api/chat/stream
app.post('/api/chat/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    const sendEvent = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const { message, scope, user } = req.body || {};
        if (!message) {
            sendEvent('error', { error: 'message is required' });
            return res.end();
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            const demo =
                `Chatbot demo mode (no OPENAI_API_KEY set).\n\n` +
                `You asked: "${message}"\n\n` +
                `Set OPENAI_API_KEY on backend to enable real AI responses.`;

            // Stream it in chunks so UI feels real-time
            const chunks = demo.match(/.{1,40}(\s|$)/g) || [demo];
            for (const c of chunks) {
                sendEvent('delta', { text: c });
                await new Promise(r => setTimeout(r, 35));
            }
            sendEvent('done', { ok: true });
            return res.end();
        }

        // If you want true token streaming from OpenAI, we can upgrade to their streaming APIs.
        // For now, request a full answer and stream it out in chunks (still "real-time" UX).
        const system =
            scope === 'instructor'
                ? 'You are an assistant for an instructor using an online proctoring system. Be concise and actionable.'
                : scope === 'student'
                    ? 'You are an assistant for a student taking an online proctored exam. Be clear and supportive. Do not help cheat.'
                    : 'You are an assistant for an online proctoring system.';

        const payload = {
            model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
            input: [
                { role: 'system', content: system },
                { role: 'user', content: `User: ${JSON.stringify(user || {})}\nQuestion: ${message}` }
            ]
        };

        const { data } = await axios.post('https://api.openai.com/v1/responses', payload, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 20000
        });

        const text =
            data?.output_text ||
            data?.output?.[0]?.content?.map(c => c?.text).filter(Boolean).join('') ||
            'No response text.';

        const chunks = text.match(/.{1,40}(\s|$)/g) || [text];
        for (const c of chunks) {
            sendEvent('delta', { text: c });
            await new Promise(r => setTimeout(r, 20));
        }
        sendEvent('done', { ok: true });
        return res.end();
    } catch (error) {
        sendEvent('error', { error: error.response?.data || error.message });
        return res.end();
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'Smart Proctoring Backend',
        timestamp: new Date().toISOString(),
        connections: {
            students: activeConnections.students.size,
            instructors: activeConnections.instructors.size
        }
    });
});

// AI service health check
app.get('/api/ai/health', async (req, res) => {
    try {
        const AI_BASE = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        const { data } = await axios.get(`${AI_BASE}/health`, { timeout: 5000 });
        res.json({
            ai_service: data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(502).json({
            ai_service: 'unavailable',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Proxy: frontend -> backend -> AI service
app.post('/api/ai/analyze', async (req, res) => {
    try {
        const AI_BASE = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        const { data } = await axios.post(`${AI_BASE}/api/analyze`, req.body, { timeout: 20000 });
        res.json(data);
    } catch (error) {
        res.status(502).json({
            error: 'AI service request failed',
            details: error.response?.data || error.message
        });
    }
});

app.post('/api/ai/analyze/advanced', async (req, res) => {
    try {
        const AI_BASE = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        const { data } = await axios.post(`${AI_BASE}/api/analyze/advanced`, req.body, { timeout: 30000 });
        res.json(data);
    } catch (error) {
        res.status(502).json({
            error: 'AI service request failed',
            details: error.response?.data || error.message
        });
    }
});

app.get('/api/ai/sessions/:sessionId', async (req, res) => {
    try {
        const AI_BASE = process.env.AI_SERVICE_URL || 'http://localhost:8000';
        const { data } = await axios.get(`${AI_BASE}/api/sessions/${encodeURIComponent(req.params.sessionId)}`, { timeout: 10000 });
        res.json(data);
    } catch (error) {
        res.status(502).json({
            error: 'AI service request failed',
            details: error.response?.data || error.message
        });
    }
});

// Serve frontend in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../frontend/build')));
    
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
    });
}

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        message: 'Something went wrong!',
        error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`
    🚀 Server running on port ${PORT}
    📡 WebSocket server ready
    🔗 Health check: http://localhost:${PORT}/api/health
    🎯 AI Service: http://localhost:8000/health
    `);
});