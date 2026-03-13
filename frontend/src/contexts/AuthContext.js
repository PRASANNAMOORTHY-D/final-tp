import React, { createContext, useState, useContext, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../config';

const AuthContext = createContext({});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const navigate = useNavigate();

  // Configure axios defaults
  useEffect(() => {
    axios.defaults.baseURL = API_BASE_URL;
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete axios.defaults.headers.common['Authorization'];
    }
  }, [token]);

  // Load user on initial render
  useEffect(() => {
    const loadUser = async () => {
      if (token) {
        try {
          const response = await axios.get('/api/auth/me');
          setUser(response.data.user);
        } catch (error) {
          console.error('Failed to load user:', error);
          localStorage.removeItem('token');
          setToken(null);
          setUser(null);
        }
      }
      setLoading(false);
    };

    loadUser();
  }, [token]);

  // Login function
  const login = async (email, password) => {
    try {
      setLoading(true);
      const response = await axios.post('/api/auth/login', { email, password });
      
      const { token: authToken, user: userData } = response.data;
      
      // Store token
      localStorage.setItem('token', authToken);
      setToken(authToken);
      setUser(userData);
      
      // Set axios header
      axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
      
      // Redirect based on role
      if (userData.role === 'admin' || userData.role === 'instructor') {
        navigate('/instructor');
      } else {
        navigate('/student');
      }
      
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Login failed. Please try again.';
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  // Register function
  const register = async (userData) => {
    try {
      setLoading(true);
      const response = await axios.post('/api/auth/register', userData);
      
      const { token: authToken, user: userDataResp } = response.data;
      
      // Store token
      localStorage.setItem('token', authToken);
      setToken(authToken);
      setUser(userDataResp);
      
      // Set axios header
      axios.defaults.headers.common['Authorization'] = `Bearer ${authToken}`;
      
      navigate('/student');
      
      return { success: true };
    } catch (error) {
      const message = error.response?.data?.message || 'Registration failed. Please try again.';
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  // Logout function
  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    delete axios.defaults.headers.common['Authorization'];
    navigate('/login');
  };

  // Update user profile
  const updateProfile = async (profileData) => {
    // Not implemented in backend demo
    setUser(prev => ({ ...prev, ...profileData }));
    return { success: true, user: { ...user, ...profileData } };
  };

  // Change password
  const changePassword = async (currentPassword, newPassword) => {
    return { success: false, error: 'Not implemented in demo backend' };
  };

  // Forgot password
  const forgotPassword = async (email) => {
    return { success: false, error: 'Not implemented in demo backend' };
  };

  // Reset password
  const resetPassword = async (token, newPassword) => {
    return { success: false, error: 'Not implemented in demo backend' };
  };

  // Check if user has specific role
  const hasRole = (role) => {
    if (!user) return false;
    return user.role === role;
  };

  // Check if user has any of the specified roles
  const hasAnyRole = (roles) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  const value = {
    user,
    token,
    loading,
    login,
    register,
    logout,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword,
    hasRole,
    hasAnyRole,
    isAuthenticated: !!user
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;