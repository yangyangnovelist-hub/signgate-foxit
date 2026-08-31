import 'dotenv/config';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { createDefaultService } from './service.js';

const port = Number(process.env.PORT ?? 8787);
const service = createDefaultService(resolve('runtime'));
const app = createApp(service);

app.listen(port, '127.0.0.1', () => {
  console.log(`SignGate listening on http://127.0.0.1:${port}`);
  console.log(JSON.stringify(service.status()));
});
