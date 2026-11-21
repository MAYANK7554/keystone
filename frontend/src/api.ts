import type {
  ChatApiResponse,
  HealthStatus,
  SessionHistoryResponse,
} from './types';

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
).replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

function formatErrorDetail(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') {
    return fallback;
  }
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === 'string') {
    return detail;
  }
  if (Array.isArray(detail) && detail.length > 0) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const loc = Array.isArray((item as { loc?: unknown }).loc)
            ? (item as { loc: unknown[] }).loc.slice(-1)[0]
            : '';
          const msg = (item as { msg?: string }).msg || 'Validation error';
          return loc ? `${String(loc)}: ${msg}` : msg;
        }
        return 'Validation error';
      })
      .join('; ');
  }
  return fallback;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const response = await fetch(`${API_BASE_URL}/health`);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      formatErrorDetail(data, `Health check failed (${response.status})`),
    );
  }
  return data as HealthStatus;
}

export async function sendChatMessage(params: {
  sessionId: string;
  message: string;
  systemPrompt?: string;
  simulateFailure?: string;
}): Promise<ChatApiResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (params.simulateFailure && params.simulateFailure.trim()) {
    headers['X-Simulate-Failure'] = params.simulateFailure.trim();
  }

  const body: Record<string, string> = {
    session_id: params.sessionId,
    message: params.message,
  };

  if (params.systemPrompt && params.systemPrompt.trim()) {
    body.system_prompt = params.systemPrompt.trim();
  }

  const response = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      formatErrorDetail(data, `Request failed with HTTP ${response.status}`),
    );
  }

  return data as ChatApiResponse;
}

export async function fetchSessionMessages(
  sessionId: string,
): Promise<SessionHistoryResponse> {
  const response = await fetch(
    `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/messages`,
  );
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      formatErrorDetail(data, `Failed to load session (${response.status})`),
    );
  }
  return data as SessionHistoryResponse;
}
