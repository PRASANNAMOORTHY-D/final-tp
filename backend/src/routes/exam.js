const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Public routes
router.get('/', examController.getAllExams);
router.get('/:examId', examController.getExamById);

// Instructor CRUD (demo store)
router.post('/', authenticateToken, authorizeRoles('instructor', 'admin'), examController.createExam);
router.put('/:examId', authenticateToken, authorizeRoles('instructor', 'admin'), examController.updateExam);
router.delete('/:examId', authenticateToken, authorizeRoles('instructor', 'admin'), examController.deleteExam);

// Student routes
router.post('/start', authenticateToken, authorizeRoles('student'), examController.startExam);
router.post('/submit', authenticateToken, authorizeRoles('student'), examController.submitExam);
router.get('/student/dashboard', authenticateToken, authorizeRoles('student'), examController.getStudentDashboard);

// Instructor routes
router.get('/instructor/dashboard', authenticateToken, authorizeRoles('instructor'), examController.getInstructorDashboard);
router.get('/sessions/active', authenticateToken, authorizeRoles('instructor'), examController.getActiveSessions);
router.get('/sessions/:sessionId', authenticateToken, authorizeRoles('instructor'), examController.getSessionDetails);

// Results publishing
router.get('/results', authenticateToken, authorizeRoles('instructor', 'admin'), examController.getAllResults);
router.post('/results/:resultId/publish', authenticateToken, authorizeRoles('instructor', 'admin'), examController.publishResult);

// Admin routes
router.post('/reset', authenticateToken, authorizeRoles('instructor', 'admin'), examController.resetExam);

module.exports = router;