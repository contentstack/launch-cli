import { randomBytes } from 'node:crypto';

import {
  deploymentHeartbeatLine,
  deploymentLabel,
  deploymentLogLine,
  deploymentLogsUnavailableLine,
  deploymentStatusLine,
  deploymentUrlOf,
} from './deployment.presenter';

const UID = randomBytes(12).toString('hex');

describe('deployment presenter', () => {
  it('labels a deployment by its number when it has one', () => {
    expect(deploymentLabel({ uid: UID, deploymentNumber: 7 })).toBe('#7');
  });

  it('labels a deployment that carries neither a number nor a uid rather than printing undefined', () => {
    expect(deploymentLabel({})).toBe('with no number');
    expect(deploymentStatusLine({}, 'QUEUED', 'in-flight')).toBe('→ Deployment with no number is QUEUED');
  });

  it('labels a deployment by its uid when the number is absent or unusable', () => {
    expect(deploymentLabel({ uid: UID })).toBe(UID);
    expect(deploymentLabel({ uid: UID, deploymentNumber: Number.NaN })).toBe(UID);
    expect(deploymentLabel({ uid: UID, deploymentNumber: undefined })).toBe(UID);
  });

  it('marks an in-flight or unknown status with an arrow', () => {
    expect(deploymentStatusLine({ uid: UID, deploymentNumber: 1 }, 'DEPLOYING', 'in-flight')).toBe(
      '→ Deployment #1 is DEPLOYING',
    );
    expect(deploymentStatusLine({ uid: UID, deploymentNumber: 1 }, 'ROLLING_BACK', 'unknown')).toBe(
      '→ Deployment #1 is ROLLING_BACK',
    );
  });

  it('marks a success with a tick and a failure with a cross', () => {
    expect(deploymentStatusLine({ uid: UID, deploymentNumber: 2 }, 'LIVE', 'success')).toBe(
      '✔ Deployment #2 is LIVE',
    );
    expect(deploymentStatusLine({ uid: UID, deploymentNumber: 2 }, 'FAILED', 'failure')).toBe(
      '✖ Deployment #2 is FAILED',
    );
  });

  it('writes a heartbeat line with no escape codes in it', () => {
    const line = deploymentHeartbeatLine('DEPLOYING');

    expect(line).toBe('  … still DEPLOYING');
    expect(line).not.toContain('\u001b');
  });

  it('leaves an absolute deployment url alone and gives a bare host a scheme', () => {
    expect(deploymentUrlOf({ uid: UID, deploymentUrl: 'https://site.example.test' })).toBe('https://site.example.test');
    expect(deploymentUrlOf({ uid: UID, deploymentUrl: 'site.example.test' })).toBe('https://site.example.test');
  });

  it('falls back to the preview url and reports nothing when neither is usable', () => {
    expect(deploymentUrlOf({ uid: UID, previewUrl: 'preview.example.test' })).toBe('https://preview.example.test');
    expect(deploymentUrlOf({ uid: UID })).toBeUndefined();
    expect(deploymentUrlOf({ uid: UID, deploymentUrl: '', previewUrl: '' })).toBeUndefined();
  });

  it.each([
    [{ message: 'Build started' }, 'Build started'],
    [{ message: 'Build started', timestamp: '' }, 'Build started'],
    [{ message: 'Build started', timestamp: 'not a time' }, 'Build started'],
    [{ timestamp: '2026-09-25T10:00:03.000Z' }, '2026-09-25 10:00:03.000:'],
    [{ message: '', timestamp: '2026-09-25T10:00:03.000Z' }, '2026-09-25 10:00:03.000:'],
    [{}, ''],
  ])('renders the log %j as %j rather than crashing or printing undefined', (log, line) => {
    expect(deploymentLogLine(log)).toBe(line);
  });

  it('names what failed when a log fetch rejects with something other than an Error', () => {
    expect(deploymentLogsUnavailableLine('socket hang up')).toBe(
      '  ! Could not read the deployment logs (socket hang up). Still waiting on the deployment.',
    );
  });
});

