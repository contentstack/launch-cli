import { DEPLOYMENT_STATUSES } from './types';
import { classifyStatus, normalizeStatus } from './deployment.status';

describe('deployment status classification', () => {
  it('treats QUEUED and DEPLOYING as in-flight', () => {
    expect(classifyStatus('QUEUED')).toBe('in-flight');
    expect(classifyStatus('DEPLOYING')).toBe('in-flight');
  });

  it('treats LIVE and DEPLOYED as success', () => {
    expect(classifyStatus('LIVE')).toBe('success');
    expect(classifyStatus('DEPLOYED')).toBe('success');
  });

  it('treats the remaining declared statuses as failure', () => {
    expect(classifyStatus('FAILED')).toBe('failure');
    expect(classifyStatus('CANCELLED')).toBe('failure');
    expect(classifyStatus('SKIPPED')).toBe('failure');
    expect(classifyStatus('ARCHIVED')).toBe('failure');
  });

  it('classifies every declared status as something other than unknown', () => {
    expect(DEPLOYMENT_STATUSES.map((status) => classifyStatus(status))).not.toContain('unknown');
  });

  it('classifies a status the enum does not contain as unknown', () => {
    expect(classifyStatus('ROLLING_BACK')).toBe('unknown');
  });

  it('classifies a case-different or padded status by its canonical form', () => {
    expect(classifyStatus(' live ')).toBe('success');
    expect(classifyStatus('deploying')).toBe('in-flight');
  });

  it('classifies an absent or non-string status as unknown', () => {
    expect(classifyStatus(undefined)).toBe('unknown');
    expect(classifyStatus(null)).toBe('unknown');
    expect(classifyStatus('')).toBe('unknown');
    expect(classifyStatus('   ')).toBe('unknown');
    expect(classifyStatus(0)).toBe('unknown');
    expect(classifyStatus(false)).toBe('unknown');
    expect(classifyStatus({ status: 'LIVE' })).toBe('unknown');
  });

  it('reports the canonical form of a status it was given', () => {
    expect(normalizeStatus(' live ')).toBe('LIVE');
    expect(normalizeStatus('ROLLING_BACK')).toBe('ROLLING_BACK');
  });

  it('reports UNKNOWN when there is no status to canonicalise', () => {
    expect(normalizeStatus(undefined)).toBe('UNKNOWN');
    expect(normalizeStatus(null)).toBe('UNKNOWN');
    expect(normalizeStatus('')).toBe('UNKNOWN');
    expect(normalizeStatus(12)).toBe('UNKNOWN');
  });
});
