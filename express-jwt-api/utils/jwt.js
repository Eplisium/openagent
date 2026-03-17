const jwt = require('jsonwebtoken');

class JWTUtils {
  /**
   * Generate JWT token
   * @param {Object} payload - Data to include in token
   * @param {string} expiresIn - Token expiration time
   * @returns {string} JWT token
   */
  static generateToken(payload, expiresIn = process.env.JWT_EXPIRES_IN || '24h') {
    try {
      return jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { 
          expiresIn,
          issuer: 'express-jwt-api',
          audience: 'api-users'
        }
      );
    } catch (error) {
      throw new Error('Error generating token: ' + error.message);
    }
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token to verify
   * @returns {Object} Decoded token payload
   */
  static verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'express-jwt-api',
        audience: 'api-users'
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('Token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid token');
      } else {
        throw new Error('Token verification failed: ' + error.message);
      }
    }
  }

  /**
   * Generate access and refresh tokens
   * @param {Object} user - User object
   * @returns {Object} Object containing access and refresh tokens
   */
  static generateTokenPair(user) {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role
    };

    const accessToken = this.generateToken(payload, '15m'); // Short-lived access token
    const refreshToken = this.generateToken(
      { userId: user.id, type: 'refresh' }, 
      '7d' // Longer-lived refresh token
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60 // 15 minutes in seconds
    };
  }

  /**
   * Decode token without verification (for debugging)
   * @param {string} token - JWT token
   * @returns {Object} Decoded token
   */
  static decodeToken(token) {
    try {
      return jwt.decode(token, { complete: true });
    } catch (error) {
      throw new Error('Error decoding token: ' + error.message);
    }
  }

  /**
   * Check if token is expired
   * @param {string} token - JWT token
   * @returns {boolean} True if expired
   */
  static isTokenExpired(token) {
    try {
      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) {
        return true;
      }
      
      const currentTime = Math.floor(Date.now() / 1000);
      return decoded.exp < currentTime;
    } catch (error) {
      return true;
    }
  }
}

module.exports = JWTUtils;