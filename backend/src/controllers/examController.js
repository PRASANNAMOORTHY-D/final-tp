const store = require('../data/store');
const bus = require('../events/bus');

const examController = {
    // Get all exams
    getAllExams: (req, res) => {
        const role = req.user?.role || 'guest';

        res.json({
            success: true,
            exams: store.exams.map(exam => ({
                ...exam,
                canStart: exam.status === 'ACTIVE' && role === 'student'
            }))
        });
    },
    
    // Get exam by ID
    getExamById: (req, res) => {
        const { examId } = req.params;
        const exam = store.exams.find(e => e.id === examId);
        
        if (!exam) {
            return res.status(404).json({ 
                success: false, 
                message: 'Exam not found' 
            });
        }
        
        res.json({
            success: true,
            exam
        });
    },

    // Instructor: create exam
    createExam: (req, res) => {
        const exam = req.body || {};
        if (!exam.id || !exam.title || !exam.courseCode) {
            return res.status(400).json({
                success: false,
                message: 'Exam id, title, and courseCode are required'
            });
        }

        const exists = store.exams.find(e => e.id === exam.id);
        if (exists) {
            return res.status(409).json({
                success: false,
                message: `Exam with id ${exam.id} already exists`
            });
        }

        const newExam = {
            id: String(exam.id),
            courseCode: String(exam.courseCode),
            title: String(exam.title),
            description: String(exam.description || ''),
            date: String(exam.date || ''),
            duration: Number(exam.duration || 60),
            status: String(exam.status || 'UPCOMING'),
            questions: Number(exam.questions || 0),
            maxScore: Number(exam.maxScore || 100),
            enrolledStudents: Number(exam.enrolledStudents || 0),
            instructorId: req.user.id
        };

        store.exams.push(newExam);

        bus.emit('exam:changed', { action: 'created', exam: newExam });

        return res.status(201).json({
            success: true,
            exam: newExam
        });
    },

    // Instructor: update exam
    updateExam: (req, res) => {
        const { examId } = req.params;
        const exam = store.exams.find(e => e.id === examId);
        if (!exam) {
            return res.status(404).json({ success: false, message: 'Exam not found' });
        }

        const patch = req.body || {};
        Object.assign(exam, {
            courseCode: patch.courseCode ?? exam.courseCode,
            title: patch.title ?? exam.title,
            description: patch.description ?? exam.description,
            date: patch.date ?? exam.date,
            duration: patch.duration ?? exam.duration,
            status: patch.status ?? exam.status,
            questions: patch.questions ?? exam.questions,
            maxScore: patch.maxScore ?? exam.maxScore,
            enrolledStudents: patch.enrolledStudents ?? exam.enrolledStudents
        });

        bus.emit('exam:changed', { action: 'updated', exam });

        return res.json({ success: true, exam });
    },

    // Instructor: delete exam
    deleteExam: (req, res) => {
        const { examId } = req.params;
        const idx = store.exams.findIndex(e => e.id === examId);
        if (idx === -1) {
            return res.status(404).json({ success: false, message: 'Exam not found' });
        }

        // Also remove any sessions/results for this exam in demo store
        const deleted = store.exams.splice(idx, 1)[0];
        store.examSessions = store.examSessions.filter(s => s.examId !== examId);
        store.examResults = store.examResults.filter(r => r.examId !== examId);

        bus.emit('exam:changed', { action: 'deleted', exam: deleted || { id: examId } });

        return res.json({ success: true, message: 'Exam deleted' });
    },
    
    // Start exam session
    startExam: (req, res) => {
        const { examId } = req.body;
        const exam = store.exams.find(e => e.id === examId);
        
        if (!exam) {
            return res.status(404).json({ 
                success: false, 
                message: 'Exam not found' 
            });
        }
        
        if (exam.status !== 'ACTIVE') {
            return res.status(400).json({ 
                success: false, 
                message: 'Exam is not active' 
            });
        }
        
        // Check if already started
        const existingSession = store.examSessions.find(
            s => s.examId === examId && s.studentId === req.user.id
        );
        
        if (existingSession) {
            return res.json({
                success: true,
                sessionId: existingSession.sessionId,
                message: 'Resuming existing session'
            });
        }
        
        // Create new session
        const sessionId = `SESS_${Date.now()}_${req.user.id}`;
        const newSession = {
            sessionId,
            examId,
            studentId: req.user.id,
            studentName: req.user.name,
            startTime: new Date().toISOString(),
            status: 'active',
            proctoringEnabled: true,
            cameraActive: false,
            alerts: [],
            focusScore: 100
        };
        
        store.examSessions.push(newSession);
        
        res.json({
            success: true,
            sessionId,
            exam,
            proctoringConfig: {
                faceDetection: true,
                gazeTracking: true,
                objectDetection: true,
                audioMonitoring: false,
                screenRecording: false
            }
        });
    },
    
    // Submit exam
    submitExam: (req, res) => {
        const { sessionId, answers, focusScore, alertCount } = req.body;
        
        // Find session
        const sessionIndex = store.examSessions.findIndex(s => s.sessionId === sessionId);
        
        if (sessionIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                message: 'Session not found' 
            });
        }
        
        const session = store.examSessions[sessionIndex];
        
        // Calculate score (simplified)
        const score = Math.floor(Math.random() * 30) + 70; // 70-100

        const riskScore = typeof session.riskScore === 'number' ? session.riskScore : 0;
        
        // Create result
        const result = {
            resultId: `RES_${Date.now()}`,
            sessionId,
            examId: session.examId,
            studentId: session.studentId,
            studentName: session.studentName,
            score,
            maxScore: 100,
            focusScore: focusScore || 100,
            riskScore,
            alertCount: alertCount || 0,
            submittedAt: new Date().toISOString(),
            answers,
            published: false,
            publishedAt: null,
            publishedBy: null
        };
        
        store.examResults.push(result);
        
        // Remove session
        store.examSessions.splice(sessionIndex, 1);
        
        res.json({
            success: true,
            message: 'Exam submitted successfully',
            result
        });
    },
    
    // Get active sessions
    getActiveSessions: (req, res) => {
        res.json({
            success: true,
            sessions: store.examSessions
        });
    },
    
    // Get session details
    getSessionDetails: (req, res) => {
        const { sessionId } = req.params;
        const session = store.examSessions.find(s => s.sessionId === sessionId);
        
        if (!session) {
            return res.status(404).json({ 
                success: false, 
                message: 'Session not found' 
            });
        }
        
        res.json({
            success: true,
            session
        });
    },
    
    // Reset exam for testing
    resetExam: (req, res) => {
        const { examId } = req.body;
        
        // Remove results for this exam
        store.examResults = store.examResults.filter(r => r.examId !== examId);
        
        // Remove sessions for this exam
        store.examSessions = store.examSessions.filter(s => s.examId !== examId);
        
        res.json({
            success: true,
            message: `Exam ${examId} reset successfully`
        });
    },
    
    // Get student dashboard data
    getStudentDashboard: (req, res) => {
        const studentId = req.user.id;

        // In this demo project, student course enrollment lives in the in-memory store.
        const student = store.students?.find(s => s.id === studentId);
        const enrolledCourses = student?.courses || [];
        const visibleExams = enrolledCourses.length > 0
            ? store.exams.filter(e => enrolledCourses.includes(e.courseCode))
            : store.exams;
        
        const studentExams = visibleExams.map(exam => ({
            ...exam,
            studentStatus: exam.status === 'ACTIVE' ? 'START_EXAM' : 'VIEW_DETAILS'
        }));
        
        const studentResults = store.examResults.filter(r => r.studentId === studentId);
        const publishedResults = studentResults.filter(r => r.published);
        
        res.json({
            success: true,
            student: {
                id: req.user.id,
                name: req.user.name,
                email: req.user.email
            },
            stats: {
                upcomingExams: visibleExams.filter(e => e.status === 'UPCOMING').length,
                completedExams: publishedResults.length,
                pendingAssignments: 2,
                averageScore: publishedResults.length > 0 
                    ? Math.round(publishedResults.reduce((sum, r) => sum + (r.score || 0), 0) / publishedResults.length)
                    : 0
            },
            availableExams: studentExams,
            recentResults: publishedResults.slice(-5)
        });
    },

    // Instructor: list results (optionally filter by examId)
    getAllResults: (req, res) => {
        const { examId, studentId, published } = req.query || {};
        let results = [...store.examResults];

        if (examId) results = results.filter(r => r.examId === examId);
        if (studentId) results = results.filter(r => r.studentId === studentId);
        if (published === 'true') results = results.filter(r => r.published);
        if (published === 'false') results = results.filter(r => !r.published);

        // newest first
        results.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

        return res.json({ success: true, results });
    },

    // Instructor: publish a result (and optionally set/override risk score)
    publishResult: (req, res) => {
        const { resultId } = req.params;
        const result = store.examResults.find(r => r.resultId === resultId);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Result not found' });
        }

        const { riskScore } = req.body || {};
        if (riskScore !== undefined) {
            const n = Number(riskScore);
            if (Number.isNaN(n) || n < 0 || n > 100) {
                return res.status(400).json({ success: false, message: 'riskScore must be a number between 0 and 100' });
            }
            result.riskScore = n;
        }

        result.published = true;
        result.publishedAt = new Date().toISOString();
        result.publishedBy = req.user.id;

        bus.emit('result:published', { result });

        return res.json({ success: true, result });
    },
    
    // Get instructor dashboard data
    getInstructorDashboard: (req, res) => {
        res.json({
            success: true,
            instructor: {
                id: req.user.id,
                name: req.user.name,
                email: req.user.email,
                department: 'Computer Science'
            },
            stats: {
                totalExams: store.exams.length,
                totalStudents: 45,
                activeExams: store.exams.filter(e => e.status === 'ACTIVE').length,
                activeAlerts: store.examSessions.reduce((sum, s) => sum + s.alerts.length, 0)
            },
            activeExams: store.exams.map(exam => ({
                ...exam,
                alerts: store.examSessions.filter(s => s.examId === exam.id).reduce((sum, s) => sum + s.alerts.length, 0)
            })),
            alerts: store.examSessions.flatMap(session => 
                session.alerts.map(alert => ({
                    ...alert,
                    studentName: session.studentName,
                    courseCode: store.exams.find(e => e.id === session.examId)?.courseCode
                }))
            ).slice(0, 5)
        });
    }
};

module.exports = examController;