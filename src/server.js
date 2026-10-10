const app = require('./app');
const connectDatabase = require('./config/db');
const { env, validateEnv } = require('./config/env');

async function startServer() {
  validateEnv();
  await connectDatabase();

  return new Promise((resolve, reject) => {
    const server = app.listen(env.port, () => {
      console.log(`Backend server running on port ${env.port}`);
      resolve(server);
    });
    server.once('error', reject);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Failed to start backend:', error.message);
    process.exit(1);
  });
}

module.exports = startServer;