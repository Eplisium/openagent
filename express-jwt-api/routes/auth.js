const express = require('express');
const router = express.Router();

const UserStorage = require('../data/users');
const PasswordUtils = require('../utils/password');
const JWTUtils = require('../utils/jwt');
const { 
  authenticateToken, 
  authorizeRoles, 
  rateLimiter, 
  validateInput 
} = require('../middleware/auth');

// Validation schemas
const registerSchema = {
  email: {
    required: true,
    type: 'string',
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    maxLength: 255
  },
  password: {
    required: true,
    type: 'string',
    minLength: 8,
    maxLength: 128
  },
  name: {
    required: true,
    type: 'string',
    minLength: 2,
    maxLength: 100
  }
};

const loginSchema = {
  email: {
    required: true,
    type: 'string',
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: {
    required: true,
    type: 'string'
  }
};

// Apply rate limiting to auth routes
router.use(rateLimiter(50, 15 * 60 * 1000)); // 50 requests per 15 minutes

/**
 * @route   POST /api/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', validateInput(registerSchema), async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Check if user already exists
    if (UserStorage.emailExists(email)) {
      return res.status(409).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Validate password strength
    const passwordValidation = PasswordUtils.validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Password does not meet requirements',
        errors: passwordValidation.errors
      });
    }

    // Hash password
    const hashedPassword = await PasswordUtils.hashPassword(password);

    // Create user
    const newUser = UserStorage.create({
      email,
      password: hashedPassword,
      name,
      role: 'user'
    });

    // Generate tokens
    const tokens = JWTUtils.generateTokenPair(newUser);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: newUser,
        ...tokens
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during registration'
    });
  }
});

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', validateInput(loginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = UserStorage.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Verify password
    const isPasswordValid = await PasswordUtils.comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Remove password from user object
    const { password: _, ...userWithoutPassword } = user;

    // Generate tokens
    const tokens = JWTUtils.generateTokenPair(userWithoutPassword);

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        user: userWithoutPassword,
        ...tokens
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during login'
    });
  }
});

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token
 * @access  Public
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    // Verify refresh token
    const decoded = JWTUtils.verifyToken(refreshToken);
    
    if (decoded.type !== 'refresh') {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token'
      });
    }

    // Find user
    const user = UserStorage.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove password from user object
    const { password, ...userWithoutPassword } = user;

    // Generate new tokens
    const tokens = JWTUtils.generateTokenPair(userWithoutPassword);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: tokens
    });

  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({
      success: false,
      message: error.message || 'Invalid refresh token'
    });
  }
});

/**
 * @route   GET /api/auth/profile
 * @desc    Get user profile
 * @access  Private
 */
router.get('/profile', authenticateToken, (req, res) => {
  res.json({
    success: true,
    message: 'Profile retrieved successfully',
    data: {
      user: req.user
    }
  });
});

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', authenticateToken, validateInput({
  name: {
    type: 'string',
    minLength: 2,
    maxLength: 100
  }
}), async (req, res) => {
  try {
    const { name } = req.body;
    const userId = req.user.id;

    // Update user
    const updatedUser = UserStorage.update(userId, { name });

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: updatedUser
      }
    });

  } catch (error) {
    console.error('Profile update error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during profile update'
    });
  }
});

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post('/change-password', authenticateToken, validateInput({
  currentPassword: {
    required: true,
    type: 'string'
  },
  newPassword: {
    required: true,
    type: 'string',
    minLength: 8,
    maxLength: 128
  }
}), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Get user with password
    const user = UserStorage.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await PasswordUtils.comparePassword(currentPassword, user.password);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Validate new password
    const passwordValidation = PasswordUtils.validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'New password does not meet requirements',
        errors: passwordValidation.errors
      });
    }

    // Hash new password
    const hashedNewPassword = await PasswordUtils.hashPassword(newPassword);

    // Update password
    UserStorage.update(userId, { password: hashedNewPassword });

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Password change error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error during password change'
    });
  }
});

/**
 * @route   GET /api/auth/users
 * @desc    Get all users (admin only)
 * @access  Private (Admin)
 */
router.get('/users', authenticateToken, authorizeRoles('admin'), (req, res) => {
  const users = UserStorage.getAll();
  
  res.json({
    success: true,
    message: 'Users retrieved successfully',
    data: {
      users,
      count: users.length
    }
  });
});

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (in a real app, you'd blacklist the token)
 * @access  Private
 */
router.post('/logout', authenticateToken, (req, res) => {
  // In a production app, you would:
  // 1. Add the token to a blacklist
  // 2. Store blacklisted tokens in Redis or database
  // 3. Check blacklist in authentication middleware
  
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = router;