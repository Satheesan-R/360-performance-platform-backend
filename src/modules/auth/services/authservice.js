const bcrypt = require('bcryptjs');
const User = require('../models/user.model');

const registerUser = async ({ email, password, role }) => {
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    throw new Error('User already exists');
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    email,
    password: hashedPassword,
    role,
  });

  return user;
};

module.exports = {
  registerUser,
};