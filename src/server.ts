import { createChatServer } from './app.ts';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

const app = createChatServer();
app.http.on('error', (error) => {
  console.error(
    JSON.stringify({ event: 'server_error', message: error.message }),
  );
  process.exitCode = 1;
});
app.http.listen(port, '127.0.0.1', () => {
  console.log(
    JSON.stringify({
      event: 'server_listening',
      url: `ws://127.0.0.1:${port}/ws`,
    }),
  );
});

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    await app.close();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
