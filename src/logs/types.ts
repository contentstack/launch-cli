export const SERVER_LOGS_PAGE_CAP = 5000;

export interface ServerLog {
  timestamp?: string | number;
  message?: string;
  source?: string;
}

export interface ServerLogsResponse {
  serverLogs: ServerLog[];
}
