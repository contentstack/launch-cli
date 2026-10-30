export interface ServerLog {
  timestamp?: string | number;
  message?: string;
  source?: string;
  cursor?: string;
}

export interface ServerLogsPageInfo {
  hasOlder?: boolean | null;
  hasNewer?: boolean | null;
  oldestCursor?: string | null;
  newestCursor?: string | null;
}

export interface ServerLogsResponse {
  serverLogs: ServerLog[];
  pageInfo?: ServerLogsPageInfo;
}

export interface ServerLogsPage {
  logs: ServerLog[];
  pageInfo?: ServerLogsPageInfo;
}
