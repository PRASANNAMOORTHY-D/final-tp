export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
export const WS_URL = process.env.REACT_APP_WS_URL || 'http://localhost:5000';
// Prefer calling AI through the backend proxy so it works in Docker/production.
export const AI_API_BASE_URL = (process.env.REACT_APP_API_URL || 'http://localhost:5000') + '/api/ai';

