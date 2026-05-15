import { buildApp } from './app';
import { config } from './config';

async function startServer() {
  try {
    const app = await buildApp();
    
    await app.listen({
      port: config.PORT,
      host: config.HOST,
    });
    
    app.log.info(`Server listening on ${config.HOST}:${config.PORT}`);

    // Graceful shutdown
    const signals = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
      process.on(signal, async () => {
        app.log.info(`Received ${signal}, shutting down gracefully...`);
        await app.close();
        process.exit(0);
      });
    }

  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

startServer();
