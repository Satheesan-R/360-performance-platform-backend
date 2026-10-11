const express = require('express');
const cors = require('cors');
const { env } = require('./config/env');
const authRoutes = require('./modules/auth/routes/authroutes');
const employeeRoutes = require('./modules/employees/routes/employeeroutes');
const organizationRoutes = require('./modules/organization/routes/organizationroutes');
const departmentRoutes = require('./modules/organization/routes/departmentroutes');
const teamRoutes = require('./modules/organization/routes/teamroutes');

const app = express();

app.use(cors(
  {  origin: env.frontendUrl, credentials: true }
  ));
app.use(express.json({ limit: '20kb'}
   ));

app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/teams', teamRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

app.use((error, req, res, next) => {
  if (!error.statusCode || error.statusCode >= 500) console.error(error);
  if (error.code === 11000) {
    return res.status(409).json({ success: false, message: 'A record with that value already exists' });
  }
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.statusCode ? error.message : 'Internal server error',
  });
});

module.exports = app;
