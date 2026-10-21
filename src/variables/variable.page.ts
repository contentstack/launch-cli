import type { Pagination } from '../core/render';
import type { EnvironmentVariable } from '../environments/types';

export interface VariablePage {
  variables: EnvironmentVariable[];
  pagination: Pagination;
}

export function pageOfVariables(held: EnvironmentVariable[], limit: number, skip: number): VariablePage {
  return {
    variables: held.slice(skip, skip + limit),
    pagination: { count: held.length, limit, skip },
  };
}
