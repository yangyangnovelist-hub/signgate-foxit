import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { AuditTrail } from '../src/audit.js';
import { DemoESignProvider } from '../src/esign.js';
import { DemoPdfEngine } from '../src/pdf-engine.js';
import { DeterministicPlanner } from '../src/planner.js';
import { SignGateService } from '../src/service.js';

const input = {
  prompt: 'Prepare a 14-day mutual evaluation agreement governed by Hong Kong law for an AI workflow pilot.',
  recipient: { firstName: 'Jordan', lastName: 'Lee', email: 'jordan@example.com' },
};

describe('HTTP app', () => {
  let runtimeDir: string;
  let service: SignGateService;

  beforeEach(async () => {
    runtimeDir = await mkdtemp(join(tmpdir(), 'signgate-app-'));
    service = new SignGateService({
      runtimeDir,
      planner: new DeterministicPlanner(),
      pdfEngine: new DemoPdfEngine(),
      eSignProvider: new DemoESignProvider(),
      audit: new AuditTrail(),
    });
  });

  afterEach(async () => {
    await rm(runtimeDir, { recursive: true, force: true });
  });

  it('reports the honest runtime mode and official MCP package', async () => {
    const response = await request(createApp(service)).get('/api/status').expect(200);
    expect(response.body).toMatchObject({
      product: 'SignGate',
      pdfMode: 'demo',
      eSignMode: 'demo',
      officialMcpPackage: '@foxitsoftware/foxit-pdf-api-mcp-server@0.2.3',
      auditChainValid: true,
    });
  });

  it('runs prepare → approve → simulation through public endpoints', async () => {
    const app = createApp(service);
    const prepared = await request(app).post('/api/drafts').send(input).expect(201);
    const approved = await request(app)
      .post(`/api/drafts/${prepared.body.id}/approve`)
      .send({ phrase: prepared.body.approvalPhrase, attestExactRecipient: true, attestAuthority: true })
      .expect(200);
    const sent = await request(app).post(`/api/drafts/${prepared.body.id}/send`).send({}).expect(200);

    expect(approved.body.status).toBe('approved');
    expect(sent.body).toMatchObject({ status: 'simulated', envelope: { status: 'simulated' } });
  });

  it('returns structured validation errors', async () => {
    const response = await request(createApp(service)).post('/api/drafts').send({ prompt: 'short' }).expect(422);
    expect(response.body).toMatchObject({ error: 'VALIDATION_FAILED', message: 'Input failed validation' });
  });

  it('returns a structured hard block after the tamper proof', async () => {
    const app = createApp(service);
    const prepared = await request(app).post('/api/drafts').send(input).expect(201);
    await request(app)
      .post(`/api/drafts/${prepared.body.id}/approve`)
      .send({ phrase: prepared.body.approvalPhrase, attestExactRecipient: true, attestAuthority: true })
      .expect(200);
    await request(app).post(`/api/drafts/${prepared.body.id}/tamper`).send({ kind: 'recipient' }).expect(200);
    const response = await request(app).post(`/api/drafts/${prepared.body.id}/send`).send({}).expect(409);

    expect(response.body).toMatchObject({ error: 'APPROVAL_BINDING_BROKEN' });
  });

  it('refuses final collection when no live envelope exists', async () => {
    const app = createApp(service);
    const prepared = await request(app).post('/api/drafts').send(input).expect(201);
    const response = await request(app).post(`/api/drafts/${prepared.body.id}/collect-final`).send({}).expect(409);
    expect(response.body).toMatchObject({ error: 'LIVE_ENVELOPE_REQUIRED' });
  });

  it('serves only prepared artifacts from the runtime directory', async () => {
    const app = createApp(service);
    const prepared = await request(app).post('/api/drafts').send(input).expect(201);
    const artifact = await request(app).get(prepared.body.artifactUrl).expect(200);

    expect(artifact.text).toContain('<!doctype html>');
    expect(artifact.text).toContain('Mutual Evaluation Agreement');
  });

  it('exposes a verifiable audit feed', async () => {
    const app = createApp(service);
    await request(app).post('/api/drafts').send(input).expect(201);
    const response = await request(app).get('/api/audit').expect(200);

    expect(response.body.valid).toBe(true);
    expect(response.body.events[0]).toMatchObject({ type: 'artifact_prepared', previousHash: 'GENESIS' });
  });
});
