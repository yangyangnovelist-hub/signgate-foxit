import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { resolve, sep } from 'node:path';
import { ZodError } from 'zod';
import { GateError, type SignGateService } from './service.js';

export function createApp(service: SignGateService): Express {
  const app = express();
  const publicDir = resolve('public');
  const runtimeDir = resolve(service.runtimeDir);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(publicDir, { extensions: ['html'] }));

  app.get('/api/status', (_request, response) => response.json(service.status()));
  app.get('/api/audit', (_request, response) => response.json({ valid: service.audit.verify(), events: service.audit.events }));
  app.get('/api/drafts/:id', (request, response) => response.json(service.get(request.params.id!)));

  app.post('/api/drafts', async (request, response) => {
    response.status(201).json(await service.prepare(request.body));
  });

  app.post('/api/drafts/:id/approve', async (request, response) => {
    response.json(await service.approve(request.params.id!, request.body ?? {}));
  });

  app.post('/api/drafts/:id/send', async (request, response) => {
    response.json(await service.send(request.params.id!));
  });

  app.post('/api/drafts/:id/collect-final', async (request, response) => {
    response.json(await service.collectFinal(request.params.id!));
  });

  app.post('/api/drafts/:id/tamper', async (request, response) => {
    const kind = request.body?.kind === 'artifact' ? 'artifact' : 'recipient';
    response.json(await service.tamper(request.params.id!, kind));
  });

  app.get('/artifacts/:name', (request, response, next) => {
    const path = resolve(runtimeDir, request.params.name!);
    if (!path.startsWith(`${runtimeDir}${sep}`)) return next(new GateError('INVALID_PATH', 'Invalid artifact path', 400));
    return response.sendFile(path);
  });

  app.use((_request, response) => response.status(404).json({ error: 'NOT_FOUND', message: 'Route not found' }));
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof ZodError) {
      return response.status(422).json({ error: 'VALIDATION_FAILED', message: 'Input failed validation', issues: error.issues });
    }
    if (error instanceof GateError) {
      return response.status(error.httpStatus).json({ error: error.code, message: error.message });
    }
    console.error(error);
    return response.status(500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
  });

  return app;
}
