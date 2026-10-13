import { stripVTControlCharacters } from 'node:util';

import { styled } from '../core/style';
import { messageOf } from '../core/values';
import type { Deployment, DeploymentLog } from './types';

const GUTTER = '  ';
const CLOCK_WIDTH = 8;
const CONTINUATION = ' '.repeat(CLOCK_WIDTH + GUTTER.length);
const NARROWEST_WRAP = 24;

/* eslint-disable no-control-regex */
const OSC_SEQUENCE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\|$)/g;
const NON_SGR_CSI = /[\u001b\u009b]\[[0-?]*[ -/]*[@-ln-~]/g;
const LONE_ESCAPE = /\u001b[^[\]]/g;
const OVERWRITING_CONTROL = /[\u0007\u0008\u000b\u000c]|\r(?!\n)/g;
const COLOUR_SEQUENCE = /[\u001b\u009b]\[[0-9;:]*m/g;
/* eslint-enable no-control-regex */

export function deploymentUrlOf(deployment: Deployment): string | undefined {
  const url = deployment.deploymentUrl || deployment.previewUrl;

  if (!url) {
    return undefined;
  }

  return url.startsWith('http') ? url : `https://${url}`;
}

export function deploymentUrlLine(url: string, outputIsTTY: boolean): string {
  return `${styled('Deployment URL', 'bold', outputIsTTY)} ${styled(url, 'cyan', outputIsTTY)}`;
}

export function colouredLogMessage(message: string): string {
  return message
    .replace(OSC_SEQUENCE, '')
    .replace(NON_SGR_CSI, '')
    .replace(LONE_ESCAPE, '')
    .replace(OVERWRITING_CONTROL, '');
}

function printableUnits(message: string): string[] {
  const units: string[] = [];
  let plainFrom = 0;

  COLOUR_SEQUENCE.lastIndex = 0;

  for (let found = COLOUR_SEQUENCE.exec(message); found !== null; found = COLOUR_SEQUENCE.exec(message)) {
    units.push(...message.slice(plainFrom, found.index), found[0]);
    plainFrom = found.index + found[0].length;
  }

  units.push(...message.slice(plainFrom));

  return units;
}

export function wrapLogMessage(message: string, width: number): string[] {
  const rows: string[] = [];
  let row = '';
  let printed = 0;
  let breakAfter = -1;
  let breakPrinted = 0;

  for (const unit of printableUnits(message)) {
    const colour = unit.length > 1;

    if (!colour && printed === width) {
      const carried = breakAfter === -1 ? '' : row.slice(breakAfter);
      rows.push(breakAfter === -1 ? row : row.slice(0, breakAfter).trimEnd());
      row = carried;
      printed = breakAfter === -1 ? 0 : printed - breakPrinted;
      breakAfter = -1;
    }

    if (!colour && unit === ' ' && printed === 0 && rows.length > 0) {
      continue;
    }

    row += unit;

    if (!colour) {
      printed += 1;

      if (unit === ' ') {
        breakAfter = row.length;
        breakPrinted = printed;
      }
    }
  }

  rows.push(row);

  return rows;
}

function clockOf(time: number): string {
  const at = new Date(time);
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

function stampOf(time: number): string {
  return `${new Date(time).toISOString().slice(0, 23).replace('T', ' ')}:`;
}

export function deploymentLogLine(log: DeploymentLog, outputIsTTY: boolean, columns?: number): string {
  const time = Date.parse(log.timestamp ?? '');
  const raw = log.message ?? '';
  const message = outputIsTTY ? colouredLogMessage(raw) : stripVTControlCharacters(raw);

  if (Number.isNaN(time)) {
    return message;
  }

  if (!outputIsTTY) {
    return message === '' ? stampOf(time) : `${stampOf(time)}${GUTTER}${message}`;
  }

  const stamp = styled(clockOf(time), 'dim', outputIsTTY);

  if (message === '') {
    return stamp;
  }

  const width = (columns ?? 0) - CONTINUATION.length;

  if (width < NARROWEST_WRAP) {
    return `${stamp}${GUTTER}${message}`;
  }

  return wrapLogMessage(message, width)
    .map((row, index) => (index === 0 ? `${stamp}${GUTTER}${row}` : `${CONTINUATION}${row}`))
    .join('\n');
}

export function deploymentLogsUnavailableLine(error: unknown): string {
  const reason = messageOf(error);

  return `  ! Could not read the deployment logs (${reason}). Still waiting on the deployment.`;
}
