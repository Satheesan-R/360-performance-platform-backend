const { verifyMailConnection } = require('../src/services/mailservice');

verifyMailConnection().then(() => {
  console.log('SMTP connection and authentication succeeded. No email was sent.');
}).catch((error) => {
  // Avoid dumping SMTP responses or configuration into terminal logs.
  console.error('SMTP verification failed:', error.code || (error.statusCode === 503 ? 'NOT_CONFIGURED' : 'CONNECTION_FAILED'));
  process.exitCode = 1;
});
