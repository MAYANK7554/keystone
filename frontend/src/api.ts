import type {
  ChatResponse,
  HealthResponse,
  SessionMessagesResponse,
} from './types';

const envBase = (
  import.meta as unknown as { env?: Record<string, string | undefined> }
).env?.VITE_API_BASE_URL;

export const API_BASE_URL = (envBase || 'http://localhost:8000').replace(/\/+$/, '');

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function parseErrorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data?.detail === 'string') {
      return data.detail;
    }
    if (Array.isArray(data?.detail)) {
      return data.detail
        .map((item: { msg?: string }) => item?.msg || JSON.stringify(item))
        .join('; ');
    }
    return JSON.stringify(data);
  } catch {
    return res.statusText || 'Request failed';
  }
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`);
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorDetail(res));
  }
  return res.json();
}

export async function sendChatMessage(params: {
  sessionId: string;
  message: string;
  systemPrompt?: string;
  simulateFailure?: string;
}): Promise<ChatResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const sim = params.simulateFailure?.trim();
  if (sim) {
    headers['X-Simulate-Failure'] = sim;
  }

  const body: Record<string, string> = {
    session_id: params.sessionId,
    message: params.message,
  };
  const sys = params.systemPrompt?.trim();
  if (sys) {
    body.system_prompt = sys;
  }

  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorDetail(res));
  }
  return res.json();
}

export async function fetchSessionMessages(
  sessionId: string
): Promise<SessionMessagesResponse> {
  const res = await fetch(
    `${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}/messages`
  );
  if (!res.ok) {
    throw new ApiError(res.status, await parseErrorDetail(res));
  }
  return res.json();
}
