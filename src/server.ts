import 'dotenv/config';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { createDefaultService } from './service.js';

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
const runtimeDir = resolve(process.env.SIGNGATE_RUNTIME_DIR ?? 'runtime');
const service = createDefaultService(runtimeDir);
const app = createApp(service);

app.listen(port, host, () => {
  console.log(`SignGate listening on http://${host}:${port}`);
  console.log(JSON.stringify(service.status()));
});
