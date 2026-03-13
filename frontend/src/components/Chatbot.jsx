import React, { useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

const Chatbot = ({ scope = 'general' }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState([
    { role: 'assistant', content: `Hi ${user?.name || ''}. Ask me anything about exams, rules, or troubleshooting.` }
  ]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  const title = useMemo(() => {
    if (scope === 'student') return 'AI Assistant (Student)';
    if (scope === 'instructor') return 'AI Assistant (Instructor)';
    return 'AI Assistant';
  }, [scope]);

  const send = async () => {
    const q = text.trim();
    if (!q || loading) return;
    setText('');
    setLoading(true);
    // Append user message and an empty assistant message we will stream into
    setMessages((prev) => [...prev, { role: 'user', content: q }, { role: 'assistant', content: '' }]);

    try {
      const res = await fetch((axios.defaults.baseURL || '') + '/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(axios.defaults.headers.common || {}) },
        body: JSON.stringify({
          scope,
          user: { id: user?.id, role: user?.role, name: user?.name },
          message: q
        })
      });

      if (!res.ok || !res.body) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      const appendAssistant = (delta) => {
        setMessages((prev) => {
          const next = [...prev];
          // last message should be assistant placeholder
          const idx = next.length - 1;
          if (next[idx]?.role !== 'assistant') return next;
          next[idx] = { ...next[idx], content: (next[idx].content || '') + delta };
          return next;
        });
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE: split by blank line
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          const lines = part.split('\n').map(l => l.trim());
          const eventLine = lines.find(l => l.startsWith('event:'));
          const dataLine = lines.find(l => l.startsWith('data:'));
          const event = eventLine ? eventLine.replace('event:', '').trim() : 'message';
          const data = dataLine ? dataLine.replace('data:', '').trim() : '';
          if (!data) continue;
          const payload = JSON.parse(data);
          if (event === 'delta') appendAssistant(payload.text || '');
          if (event === 'error') throw new Error(typeof payload.error === 'string' ? payload.error : JSON.stringify(payload.error));
        }
      }
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.length - 1;
        if (next[idx]?.role === 'assistant') {
          next[idx] = { role: 'assistant', content: `Chatbot error: ${e.message}` };
          return next;
        }
        return [...next, { role: 'assistant', content: `Chatbot error: ${e.message}` }];
      });
    } finally {
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 0);
    }
  };

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: 12, borderBottom: '1px solid #e5e7eb', fontWeight: 800 }}>{title}</div>
      <div style={{ padding: 12, height: 260, overflow: 'auto', display: 'grid', gap: 8 }}>
        {messages.map((m, idx) => (
          <div
            key={idx}
            style={{
              justifySelf: m.role === 'user' ? 'end' : 'start',
              maxWidth: '85%',
              padding: '10px 12px',
              borderRadius: 12,
              background: m.role === 'user' ? '#111827' : '#f3f4f6',
              color: m.role === 'user' ? '#fff' : '#111827',
              whiteSpace: 'pre-wrap'
            }}
          >
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', gap: 10 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a question…"
          style={{ flex: 1, padding: 10, borderRadius: 10, border: '1px solid #ddd' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
        />
        <button
          onClick={send}
          disabled={loading}
          style={{ padding: '10px 14px', borderRadius: 10, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 800, cursor: 'pointer' }}
        >
          {loading ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
};

export default Chatbot;

