import { randomBytes } from 'node:crypto';

import {
  deploymentLogLine,
  deploymentLogsUnavailableLine,
  deploymentUrlOf,
} from './deployment.presenter';

const UID = randomBytes(12).toString('hex');

describe('deployment presenter', () => {
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

