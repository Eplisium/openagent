// In-memory user storage for demo purposes
// In production, this would be replaced with a database

let users = [
  // Example user (password: "admin123")
  {
    id: 1,
    email: 'admin@example.com',
    password: '$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj/RK.s5uIoW',
    name: 'Admin User',
    role: 'admin',
    createdAt: new Date().toISOString()
  }
];

let nextUserId = 2;

class UserStorage {
  // Get all users (for admin purposes)
  static getAll() {
    return users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });
  }

  // Find user by email
  static findByEmail(email) {
    return users.find(user => user.email.toLowerCase() === email.toLowerCase());
  }

  // Find user by ID
  static findById(id) {
    return users.find(user => user.id === parseInt(id));
  }

  // Create new user
  static create(userData) {
    const newUser = {
      id: nextUserId++,
      email: userData.email.toLowerCase(),
      password: userData.password,
      name: userData.name,
      role: userData.role || 'user',
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    
    // Return user without password
    const { password, ...userWithoutPassword } = newUser;
    return userWithoutPassword;
  }

  // Update user
  static update(id, updateData) {
    const userIndex = users.findIndex(user => user.id === parseInt(id));
    if (userIndex === -1) {
      return null;
    }

    users[userIndex] = {
      ...users[userIndex],
      ...updateData,
      updatedAt: new Date().toISOString()
    };

    // Return user without password
    const { password, ...userWithoutPassword } = users[userIndex];
    return userWithoutPassword;
  }

  // Delete user
  static delete(id) {
    const userIndex = users.findIndex(user => user.id === parseInt(id));
    if (userIndex === -1) {
      return false;
    }

    users.splice(userIndex, 1);
    return true;
  }

  // Check if email exists
  static emailExists(email) {
    return users.some(user => user.email.toLowerCase() === email.toLowerCase());
  }

  // Get user count
  static count() {
    return users.length;
  }
}

module.exports = UserStorage;