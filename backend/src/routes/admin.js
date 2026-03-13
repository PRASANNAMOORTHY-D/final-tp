const express = require('express');
const router = express.Router();
const store = require('../data/store');

// Demo admin/instructor APIs (no auth enforced for now)

router.get('/exams', (req, res) => {
  res.json({ success: true, exams: store.exams });
});

router.post('/exams', (req, res) => {
  const body = req.body || {};
  const id = body.id || `EX${String(store.exams.length + 1).padStart(3, '0')}`;

  const exam = {
    id,
    courseCode: body.courseCode || 'CODE101',
    title: body.title || 'New Exam',
    description: body.description || '',
    date: body.date || new Date().toISOString().slice(0, 10),
    duration: Number(body.duration || 60),
    status: body.status || 'UPCOMING',
    questions: Array.isArray(body.questions) ? body.questions.length : Number(body.questions || 0),
    maxScore: Number(body.maxScore || 100),
    enrolledStudents: Number(body.enrolledStudents || 0),
    instructorId: body.instructorId || 'I1001',
    proctoring: body.proctoring || {}
  };

  store.exams.push(exam);
  res.json({ success: true, exam });
});

router.get('/students', (req, res) => {
  res.json({ success: true, students: store.students });
});

router.post('/students', (req, res) => {
  const { id, name, email } = req.body || {};
  if (!id || !name) {
    return res.status(400).json({ success: false, message: 'id and name are required' });
  }
  if (store.students.some(s => s.id === id)) {
    return res.status(400).json({ success: false, message: 'student id already exists' });
  }
  const student = { id, name, email: email || '', courses: [] };
  store.students.push(student);
  res.json({ success: true, student });
});

router.delete('/students/:studentId', (req, res) => {
  const { studentId } = req.params;
  const before = store.students.length;
  store.students = store.students.filter(s => s.id !== studentId);
  res.json({ success: true, deleted: before - store.students.length });
});

router.get('/results', (req, res) => {
  res.json({ success: true, results: store.examResults });
});

router.get('/analytics', (req, res) => {
  const totalExams = store.exams.length;
  const totalStudents = store.students.length;
  const totalResults = store.examResults.length;
  const avgScore = totalResults
    ? Math.round(store.examResults.reduce((a, r) => a + (r.score || 0), 0) / totalResults)
    : 0;

  res.json({
    success: true,
    analytics: {
      totalExams,
      totalStudents,
      totalResults,
      avgScore
    }
  });
});

module.exports = router;

