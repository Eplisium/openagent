# Express.js JWT Authentication API

A comprehensive REST API built with Express.js featuring JWT-based authentication, user management, and security best practices.

## Features

- ✅ User registration and login
- ✅ JWT token-based authentication
- ✅ Password hashing with bcrypt
- ✅ Input validation and sanitization
- ✅ Rate limiting
- ✅ Role-based access control
- ✅ Token refresh mechanism
- ✅ Password strength validation
- ✅ Comprehensive error handling
- ✅ Security headers and CORS

## Quick Start

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd express-jwt-api
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start the development server:
```bash
npm run dev
```

The server will start on `http://localhost:3000`

## Environment Variables

Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=24h

# Security Configuration
BCRYPT_SALT_ROUNDS=12
```

## API Endpoints

### Health Check
- **GET** `/api/health` - Check API status

### Authentication

#### Register User
- **POST** `/api/auth/register`
- **Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "John Doe"
}
```
- **Response:**
```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": 1,
      "email": "user@example.com",
      "name": "John Doe",
      "role": "user",
      "createdAt": "2023-..."
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": 900
  }
}
```

#### Login User
- **POST** `/api/auth/login`
- **Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

#### Refresh Token
- **POST** `/api/auth/refresh`
- **Body:**
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Get Profile
- **GET** `/api/auth/profile`
- **Headers:** `Authorization: Bearer <access_token>`

#### Update Profile
- **PUT** `/api/auth/profile`
- **Headers:** `Authorization: Bearer <access_token>`
- **Body:**
```json
{
  "name": "Updated Name"
}
```

#### Change Password
- **POST** `/api/auth/change-password`
- **Headers:** `Authorization: Bearer <access_token>`
- **Body:**
```json
{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass123!"
}
```

#### Logout
- **POST** `/api/auth/logout`
- **Headers:** `Authorization: Bearer <access_token>`

### Admin Only

#### Get All Users
- **GET** `/api/auth/users`
- **Headers:** `Authorization: Bearer <admin_access_token>`

## Authentication Flow

1. **Register/Login**: User provides credentials and receives access + refresh tokens
2. **API Requests**: Include access token in Authorization header: `Bearer <token>`
3. **Token Refresh**: When access token expires, use refresh token to get new tokens
4. **Logout**: Client discards tokens (server-side blacklisting in production)

## Password Requirements

- Minimum 8 characters
- At least one lowercase letter
- At least one uppercase letter
- At least one number
- At least one special character
- Not a common password

## Rate Limiting

- Authentication endpoints: 50 requests per 15 minutes per IP
- Configurable per endpoint

## Error Handling

All endpoints return consistent error responses:

```json
{
  "success": false,
  "message": "Error description",
  "errors": ["Detailed error messages"]
}
```

## HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate resource)
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error

## Security Features

### Password Security
- Bcrypt hashing with configurable salt rounds
- Password strength validation
- Protection against common passwords

### JWT Security
- Short-lived access tokens (15 minutes)
- Longer-lived refresh tokens (7 days)
- Token verification with issuer/audience claims
- Secure token generation

### Input Validation
- Email format validation
- Password strength requirements
- Input sanitization
- Request size limits

### Rate Limiting
- IP-based request limiting
- Configurable windows and limits
- Rate limit headers in responses

## Testing the API

### Using cURL

Register a new user:
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!",
    "name": "Test User"
  }'
```

Login:
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPass123!"
  }'
```

Access protected route:
```bash
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Using Postman

1. Import the API endpoints
2. Set up environment variables for tokens
3. Test the authentication flow
4. Verify protected routes

## Project Structure

```
express-jwt-api/
├── server.js              # Main application file
├── .env                   # Environment variables
├── package.json           # Dependencies and scripts
├── middleware/
│   └── auth.js           # Authentication middleware
├── routes/
│   └── auth.js           # Authentication routes
├── utils/
│   ├── jwt.js            # JWT utilities
│   └── password.js       # Password utilities
└── data/
    └── users.js          # User data storage
```

## Production Considerations

### Database Integration
Replace the in-memory user storage with a proper database:
- MongoDB with Mongoose
- PostgreSQL with Sequelize
- MySQL with TypeORM

### Token Blacklisting
Implement token blacklisting for logout:
- Redis for fast token lookups
- Database table for persistent storage

### Enhanced Security
- Implement HTTPS
- Add helmet.js for security headers
- Use express-rate-limit for production-grade rate limiting
- Add request logging
- Implement CSRF protection

### Monitoring and Logging
- Add structured logging (Winston)
- Implement health checks
- Add metrics collection
- Error tracking (Sentry)

### Deployment
- Use PM2 for process management
- Set up reverse proxy (Nginx)
- Configure environment-specific settings
- Implement CI/CD pipeline

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details