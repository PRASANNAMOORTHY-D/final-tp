import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import StudentExamRoom from '../components/student/ExamRoom';
import Chatbot from '../components/Chatbot';
import io from 'socket.io-client';
import { WS_URL } from '../config';

const StudentDashboard = () => {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [activeExamId, setActiveExamId] = useState(null);
  const [detailsExam, setDetailsExam] = useState(null);
  const [detailsResult, setDetailsResult] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data } = await axios.get('/api/exams/student/dashboard');
    setDashboard(data);
    setLoading(false);
  };

  useEffect(() => {
    load().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, []);

  // Real-time refresh: if instructor changes exams or publishes results, refresh dashboard.
  useEffect(() => {
    const socket = io(WS_URL, { transports: ['websocket'] });
    socket.on('exam_changed', () => load().catch(() => {}));
    socket.on('result_published', (data) => {
      // If it's this student, refresh.
      if (!data?.result?.studentId || data.result.studentId === user?.id) {
        load().catch(() => {});
      }
    });
    return () => socket.disconnect();
  }, [user?.id]);

  if (activeExamId) {
    return (
      <StudentExamRoom
        examId={activeExamId}
        onComplete={() => {
          setActiveExamId(null);
          load();
        }}
      />
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '20px auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Student Dashboard</h2>
          <div style={{ color: '#555' }}>{user?.name} ({user?.id})</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={load} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd' }}>Refresh</button>
          <button onClick={logout} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd' }}>Logout</button>
        </div>
      </div>

      {loading ? <div style={{ marginTop: 20 }}>Loading…</div> : null}

      {!loading && dashboard?.availableExams ? (
        <div style={{ marginTop: 18 }}>
          <h3>Available Exams</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            {dashboard.availableExams.map((exam) => (
              <div key={exam.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 800 }}>{exam.title}</div>
                <div style={{ color: '#555', marginTop: 6 }}>{exam.courseCode} • {exam.duration} mins</div>
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 12, padding: '4px 8px', borderRadius: 999, background: exam.status === 'ACTIVE' ? '#dcfce7' : '#f3f4f6' }}>
                    {exam.status}
                  </span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => setDetailsExam(exam)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid #e5e7eb',
                        background: '#fff',
                        cursor: 'pointer'
                      }}
                    >
                      View details
                    </button>
                    <button
                      disabled={exam.status !== 'ACTIVE'}
                      onClick={() => setActiveExamId(exam.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: 'none',
                        background: exam.status === 'ACTIVE' ? '#111827' : '#9ca3af',
                        color: '#fff',
                        cursor: exam.status === 'ACTIVE' ? 'pointer' : 'not-allowed'
                      }}
                    >
                      Start exam
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!loading && dashboard?.recentResults ? (
        <div style={{ marginTop: 18 }}>
          <h3>Published Results & Risk Score</h3>
          {dashboard.recentResults.length === 0 ? (
            <div style={{ color: '#555' }}>No published results yet. Your instructor will publish results after review.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
              {dashboard.recentResults.map((r) => (
                <div key={r.resultId} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' }}>
                  <div style={{ fontWeight: 900 }}>{r.examId} — {r.studentName}</div>
                  <div style={{ color: '#555', marginTop: 6 }}>
                    Score: <b>{r.score}</b> / {r.maxScore} • Risk: <b>{typeof r.riskScore === 'number' ? `${r.riskScore}%` : '—'}</b>
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, padding: '4px 8px', borderRadius: 999, background: '#dcfce7' }}>
                      Published
                    </span>
                    <button
                      onClick={() => setDetailsResult(r)}
                      style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}
                    >
                      View result
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {detailsExam ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onClick={() => setDetailsExam(null)}
        >
          <div
            style={{ width: 'min(720px, 100%)', background: '#fff', borderRadius: 14, padding: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>{detailsExam.title}</div>
                <div style={{ color: '#555', marginTop: 4 }}>
                  {detailsExam.id} • {detailsExam.courseCode} • {detailsExam.duration} mins
                </div>
              </div>
              <button
                onClick={() => setDetailsExam(null)}
                style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 10, padding: '8px 10px', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div><b>Status:</b> {detailsExam.status}</div>
              <div><b>Date:</b> {detailsExam.date || '—'}</div>
              <div><b>Questions:</b> {detailsExam.questions ?? '—'}</div>
              <div><b>Max score:</b> {detailsExam.maxScore ?? '—'}</div>
              <div><b>Description:</b> {detailsExam.description || '—'}</div>
            </div>

            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={() => setDetailsExam(null)}
                style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}
              >
                OK
              </button>
              <button
                disabled={detailsExam.status !== 'ACTIVE'}
                onClick={() => {
                  const id = detailsExam.id;
                  setDetailsExam(null);
                  setActiveExamId(id);
                }}
                style={{
                  border: 'none',
                  background: detailsExam.status === 'ACTIVE' ? '#111827' : '#9ca3af',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '10px 12px',
                  cursor: detailsExam.status === 'ACTIVE' ? 'pointer' : 'not-allowed',
                  fontWeight: 800
                }}
              >
                Start exam
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detailsResult ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16
          }}
          onClick={() => setDetailsResult(null)}
        >
          <div
            style={{ width: 'min(720px, 100%)', background: '#fff', borderRadius: 14, padding: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18 }}>Result: {detailsResult.examId}</div>
                <div style={{ color: '#555', marginTop: 4 }}>
                  Published at: {detailsResult.publishedAt ? new Date(detailsResult.publishedAt).toLocaleString() : '—'}
                </div>
              </div>
              <button
                onClick={() => setDetailsResult(null)}
                style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 10, padding: '8px 10px', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <div><b>Score:</b> {detailsResult.score} / {detailsResult.maxScore}</div>
              <div><b>Focus score:</b> {detailsResult.focusScore ?? '—'}%</div>
              <div><b>Risk score:</b> {detailsResult.riskScore ?? '—'}%</div>
              <div><b>Alert count:</b> {detailsResult.alertCount ?? 0}</div>
              <div><b>Submitted at:</b> {detailsResult.submittedAt ? new Date(detailsResult.submittedAt).toLocaleString() : '—'}</div>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 18 }}>
        <Chatbot scope="student" />
      </div>
    </div>
  );
};

export default StudentDashboard;

