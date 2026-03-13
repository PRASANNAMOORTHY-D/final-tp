import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const LoginPage = () => {
  const { login } = useAuth();
  const [role, setRole] = useState('student');
  const [email, setEmail] = useState(role === 'student' ? 'student@example.com' : 'instructor@example.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const onRoleChange = (nextRole) => {
    setRole(nextRole);
    setEmail(nextRole === 'student' ? 'student@example.com' : 'instructor@example.com');
    setError('');
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await login(email, password, role);
    if (!res.success) setError(res.error || 'Login failed');
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 520, margin: '40px auto', padding: 20 }}>
      <h2>Smart Proctoring Login</h2>
      <p style={{ color: '#555' }}>
        Demo accounts: <b>student@example.com</b> / <b>instructor@example.com</b>, password <b>password123</b>
      </p>

      <div style={{ display: 'flex', gap: 10, margin: '16px 0' }}>
        <button
          type="button"
          onClick={() => onRoleChange('student')}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 8,
            border: '1px solid #ddd',
            background: role === 'student' ? '#111827' : '#fff',
            color: role === 'student' ? '#fff' : '#111827',
            cursor: 'pointer'
          }}
        >
          Student
        </button>
        <button
          type="button"
          onClick={() => onRoleChange('instructor')}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 8,
            border: '1px solid #ddd',
            background: role === 'instructor' ? '#111827' : '#fff',
            color: role === 'instructor' ? '#fff' : '#111827',
            cursor: 'pointer'
          }}
        >
          Instructor
        </button>
      </div>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <label>
          Email
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', marginTop: 6 }}
            autoComplete="username"
          />
        </label>
        <label>
          Password
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', marginTop: 6 }}
            type="password"
            autoComplete="current-password"
          />
        </label>
        {error ? <div style={{ color: '#b91c1c' }}>{error}</div> : null}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 12,
            borderRadius: 10,
            border: 'none',
            background: '#2563eb',
            color: '#fff',
            cursor: 'pointer',
            fontWeight: 700
          }}
        >
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};

export default LoginPage;

