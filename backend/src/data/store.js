// In-memory data store for demo/testing.
// Replace with a real database layer for production.
const store = {
  exams: [
    {
      id: 'EX001',
      courseCode: 'CS401',
      title: 'Computer Science Final Exam',
      description: 'Final examination covering all chapters',
      date: '2024-03-15',
      duration: 120,
      status: 'ACTIVE',
      questions: 20,
      maxScore: 100,
      enrolledStudents: 25,
      instructorId: 'I1001'
    },
    {
      id: 'EX002',
      courseCode: 'CS305',
      title: 'Database Systems Quiz',
      description: 'SQL queries and normalization',
      date: '2024-03-18',
      duration: 60,
      status: 'UPCOMING',
      questions: 15,
      maxScore: 75,
      enrolledStudents: 30,
      instructorId: 'I1001'
    },
    {
      id: 'EX003',
      courseCode: 'CS302',
      title: 'Algorithms Midterm',
      description: 'Sorting and searching algorithms',
      date: '2024-03-20',
      duration: 90,
      status: 'UPCOMING',
      questions: 25,
      maxScore: 100,
      enrolledStudents: 28,
      instructorId: 'I1001'
    }
  ],
  examSessions: [],
  examResults: [],
  students: [
    { id: 'S12345678', name: 'John Student', email: 'student@example.com', courses: ['CS401', 'CS305', 'CS302'] }
  ]
};

module.exports = store;

