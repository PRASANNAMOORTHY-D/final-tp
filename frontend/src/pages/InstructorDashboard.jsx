import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import LiveMonitoring from '../components/instructor/LiveMonitoring';
import Chatbot from '../components/Chatbot';

const emptyExam = {
  id: '',
  courseCode: '',
  title: '',
  description: '',
  date: '',
  duration: 60,
  status: 'UPCOMING',
  questions: 20,
  maxScore: 100,
  enrolledStudents: 0
};

const InstructorDashboard = () => {
  const { user, logout } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyExam);
  const [selectedExamId, setSelectedExamId] = useState('EX001');
  const [results, setResults] = useState([]);
  const [publishingId, setPublishingId] = useState(null);
  const [editingExamId, setEditingExamId] = useState(null);

  const activeExams = useMemo(() => data?.activeExams || [], [data]);

  const load = async () => {
    setLoading(true);
    const res = await axios.get('/api/exams/instructor/dashboard');
    setData(res.data);
    const res2 = await axios.get('/api/exams/results?published=false');
    setResults(res2.data.results || []);
    setLoading(false);
  };

  useEffect(() => {
    load().catch((e) => {
      console.error(e);
      setLoading(false);
    });
  }, []);

  const createExam = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await axios.post('/api/exams', form);
      setForm(emptyExam);
      await load();
    } finally {
      setCreating(false);
    }
  };

  const publish = async (r) => {
    setPublishingId(r.resultId);
    try {
      const risk = prompt('Publish risk score (0-100). Leave blank to keep current:', String(r.riskScore ?? ''));
      const body = {};
      if (risk !== null && String(risk).trim() !== '') body.riskScore = Number(risk);
      await axios.post(`/api/exams/results/${r.resultId}/publish`, body);
      await load();
      alert('Published.');
    } catch (e) {
      alert(e.response?.data?.message || e.message);
    } finally {
      setPublishingId(null);
    }
  };

  return (
    <div style={{ maxWidth: 1200, margin: '20px auto', padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Instructor Dashboard</h2>
          <div style={{ color: '#555' }}>{user?.name} ({user?.id})</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={load} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd' }}>Refresh</button>
          <button onClick={logout} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #ddd' }}>Logout</button>
        </div>
      </div>

      {loading ? <div style={{ marginTop: 16 }}>Loading…</div> : null}

      <div style={{ marginTop: 18, display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>Create New Exam</h3>
          <form onSubmit={createExam} style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <label>
              Exam ID
              <input value={form.id} onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', marginTop: 6 }} />
            </label>
            <label>
              Course Code
              <input value={form.courseCode} onChange={(e) => setForm((p) => ({ ...p, courseCode: e.target.value }))} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', marginTop: 6 }} />
            </label>
            <label>
              Title
              <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', marginTop: 6 }} />
            </label>
            <label>
              Date (YYYY-MM-DD)
              <input value={form.date} onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', marginTop: 6 }} />
            </label>
            <label>
              Duration (mins)
              <input type="number" value={form.duration} onChange={(e) => setForm((p) => ({ ...p, duration: Number(e.target.value) }))} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', marginTop: 6 }} />
            </label>
            <label>
              Status
              <select value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', marginTop: 6 }}>
                <option value="UPCOMING">UPCOMING</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="COMPLETED">COMPLETED</option>
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>
              Description
              <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', marginTop: 6 }} />
            </label>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              <button disabled={creating} style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: '#111827', color: '#fff', cursor: 'pointer', fontWeight: 800 }}>
                {creating ? 'Creating…' : 'Create Exam'}
              </button>
            </div>
          </form>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
          <h3 style={{ marginTop: 0 }}>Real-time Monitoring</h3>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
            <span style={{ color: '#555' }}>Monitor exam:</span>
            <select value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid #ddd' }}>
              {(activeExams.length ? activeExams : [{ id: 'EX001', title: 'Default EX001' }]).map((ex) => (
                <option key={ex.id} value={ex.id}>{ex.id} — {ex.title}</option>
              ))}
            </select>
          </div>
          <LiveMonitoring examId={selectedExamId} />
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' }}>
          <h3 style={{ marginTop: 0 }}>Manage Exams</h3>
          <div style={{ color: '#555', marginBottom: 10 }}>
            Changes here update student dashboards in real time.
          </div>

          <div style={{ display: 'grid', gap: 10 }}>
            {(data?.activeExams || []).map((ex) => (
              <div key={ex.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>{ex.id} — {ex.title}</div>
                    <div style={{ color: '#555', marginTop: 6 }}>
                      {ex.courseCode} • {ex.duration} mins • Status: <b>{ex.status}</b>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setSelectedExamId(ex.id)}
                      style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}
                    >
                      Monitor
                    </button>
                    <button
                      onClick={async () => {
                        const nextStatus = ex.status === 'ACTIVE' ? 'UPCOMING' : 'ACTIVE';
                        await axios.put(`/api/exams/${ex.id}`, { status: nextStatus });
                        await load();
                      }}
                      style={{ padding: '8px 10px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 800 }}
                    >
                      {ex.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      onClick={() => setEditingExamId(ex.id)}
                      style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Delete exam ${ex.id}?`)) return;
                        await axios.delete(`/api/exams/${ex.id}`);
                        await load();
                      }}
                      style={{ padding: '8px 10px', borderRadius: 10, border: 'none', background: '#b91c1c', color: '#fff', cursor: 'pointer', fontWeight: 800 }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff' }}>
          <h3 style={{ marginTop: 0 }}>Publish Results (students can only see after publish)</h3>
          {results.length === 0 ? (
            <div style={{ color: '#555' }}>No unpublished results.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {results.slice(0, 20).map((r) => (
                <div key={r.resultId} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
                  <div style={{ fontWeight: 900 }}>{r.examId} — {r.studentName} ({r.studentId})</div>
                  <div style={{ color: '#555', marginTop: 6 }}>
                    Score: <b>{r.score}</b> / {r.maxScore} • Focus: <b>{r.focusScore ?? '—'}%</b> • Risk: <b>{r.riskScore ?? 0}%</b>
                  </div>
                  <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => publish(r)}
                      disabled={publishingId === r.resultId}
                      style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#111827', color: '#fff', cursor: 'pointer', fontWeight: 800 }}
                    >
                      {publishingId === r.resultId ? 'Publishing…' : 'Publish'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Chatbot scope="instructor" />
      </div>

      {editingExamId ? (
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
          onClick={() => setEditingExamId(null)}
        >
          <div
            style={{ width: 'min(720px, 100%)', background: '#fff', borderRadius: 14, padding: 16 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Edit Exam: {editingExamId}</div>
              <button
                onClick={() => setEditingExamId(null)}
                style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 10, padding: '8px 10px', cursor: 'pointer' }}
              >
                Close
              </button>
            </div>
            <div style={{ marginTop: 10, color: '#555' }}>
              Quick edit via prompts (demo). We can build a full form next.
            </div>
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={async () => {
                  const title = prompt('New title (leave blank to keep):', '');
                  const date = prompt('New date YYYY-MM-DD (leave blank to keep):', '');
                  const duration = prompt('New duration mins (leave blank to keep):', '');
                  const patch = {};
                  if (title) patch.title = title;
                  if (date) patch.date = date;
                  if (duration) patch.duration = Number(duration);
                  await axios.put(`/api/exams/${editingExamId}`, patch);
                  await load();
                  setEditingExamId(null);
                }}
                style={{ padding: '10px 12px', borderRadius: 10, border: 'none', background: '#111827', color: '#fff', cursor: 'pointer', fontWeight: 800 }}
              >
                Edit fields
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default InstructorDashboard;

