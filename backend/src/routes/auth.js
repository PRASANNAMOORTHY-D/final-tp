const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { authenticateToken } = require('../middleware/auth');

// Mock users database
const users = [
    {
        id: 'S12345678',
        email: 'student@example.com',
        password: '$2a$10$N9qo8uLOickgx2ZMRZoMye3Z5c8Z6.5UQ9Z6b5fV9nQ0qJj5J5J5K', // password123
        name: 'John Student',
        role: 'student',
        courses: ['CS401', 'CS305', 'CS302']
    },
    {
        id: 'I1001',
        email: 'instructor@example.com',
        password: '$2a$10$N9qo8uLOickgx2ZMRZoMye3Z5c8Z6.5UQ9Z6b5fV9nQ0qJj5J5J5K', // password123
        name: 'Dr. Jane Instructor',
        role: 'instructor',
        department: 'Computer Science'
    }
];

// Login endpoint
router.post('/login', async (req, res) => {
    try {
        const { email, password, role } = req.body;
        
        // Find user
        const user = users.find(u => u.email === email && u.role === role);
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        // Check password (simplified for demo)
        const validPassword = password === 'password123';
        if (!validPassword) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid credentials' 
            });
        }
        
        // Create JWT token
        const token = jwt.sign(
            { 
                id: user.id, 
                email: user.email, 
                role: user.role, 
                name: user.name 
            },
            'your-secret-key-12345',
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Register endpoint (for testing)
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role, studentId } = req.body;
        
        // Check if user exists
        const existingUser = users.find(u => u.email === email);
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'User already exists' 
            });
        }
        
        // Create new user
        const newUser = {
            id: studentId || `U${Date.now()}`,
            email,
            password: await bcrypt.hash(password, 10),
            name,
            role,
            courses: role === 'student' ? ['CS401', 'CS305', 'CS302'] : []
        };
        
        users.push(newUser);
        
        // Create token
        const token = jwt.sign(
            { 
                id: newUser.id, 
                email: newUser.email, 
                role: newUser.role, 
                name: newUser.name 
            },
            'your-secret-key-12345',
            { expiresIn: '24h' }
        );
        
        res.json({
            success: true,
            token,
            user: {
                id: newUser.id,
                name: newUser.name,
                email: newUser.email,
                role: newUser.role
            }
        });
        
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Server error' 
        });
    }
});

// Verify token endpoint
router.post('/verify', (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'No token provided' 
            });
        }
        
        const decoded = jwt.verify(token, 'your-secret-key-12345');
        
        res.json({
            success: true,
            user: decoded
        });
        
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ 
            success: false, 
            message: 'Invalid token' 
        });
    }
});

// Current user (used by frontend to restore session)
router.get('/me', authenticateToken, (req, res) => {
    res.json({
        success: true,
        user: req.user
    });
});

module.exports = router;