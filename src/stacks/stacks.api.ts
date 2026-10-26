import { isRecord } from '../core/values';
import type { CmaSession } from '../transport/cma-client';
import { StackLookupError } from './stack.errors';

export interface Stack {
  name: string;
  apiKey: string;
}

export interface DeliveryToken {
  name: string;
  token: string;
  environment: string | undefined;
}

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function failureReason(error: unknown): string {
  if (isRecord(error)) {
    const reason = textOf(error.errorMessage) ?? textOf(error.message);

    if (reason !== undefined) {
      return reason;
    }
  }

  return textOf(error) ?? 'the Contentstack Management API gave no reason';
}

function ofAnotherOrganization(value: Record<string, unknown>, organizationUid: string): boolean {
  return textOf(value.org_uid) !== undefined && value.org_uid !== organizationUid;
}

function stackOf(value: unknown, organizationUid: string): Stack[] {
  if (!isRecord(value) || ofAnotherOrganization(value, organizationUid)) {
    return [];
  }

  const apiKey = textOf(value.api_key);

  return apiKey === undefined ? [] : [{ name: textOf(value.name) ?? apiKey, apiKey }];
}

function environmentOf(scope: unknown): string | undefined {
  if (!Array.isArray(scope)) {
    return undefined;
  }

  for (const entry of scope) {
    const environments: unknown = isRecord(entry) ? entry.environments : undefined;
    const first: unknown = Array.isArray(environments) ? environments[0] : undefined;
    const name = isRecord(first) ? textOf(first.name) : undefined;

    if (name !== undefined) {
      return name;
    }
  }

  return undefined;
}

function tokenOf(value: unknown, position: number): DeliveryToken[] {
  if (!isRecord(value)) {
    return [];
  }

  const token = textOf(value.token);

  if (token === undefined) {
    return [];
  }

  return [{ name: textOf(value.name) ?? `Delivery token ${position}`, token, environment: environmentOf(value.scope) }];
}

export class StacksApi {
  constructor(private readonly cma: CmaSession) {}

  async list(organizationUid: string): Promise<Stack[]> {
    try {
      const { items } = await this.cma.fetchStacks(organizationUid);

      return (items ?? []).flatMap((item) => stackOf(item, organizationUid));
    } catch (error) {
      throw new StackLookupError('the stacks of this organization', failureReason(error));
    }
  }

  async deliveryTokens(apiKey: string): Promise<DeliveryToken[]> {
    try {
      const { items } = await this.cma.fetchDeliveryTokens(apiKey);

      return (items ?? []).flatMap((item, index) => tokenOf(item, index + 1));
    } catch (error) {
      throw new StackLookupError(`the delivery tokens of stack ${apiKey}`, failureReason(error));
    }
  }
}
