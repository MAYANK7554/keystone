export type ResolutionSource = 'LIVE_INFERENCE' | 'LLM_CACHE';

export interface MessageMetadata {
  resolution_source: ResolutionSource;
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  key_id: string | null;
  fallback_attempts: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  metadata?: MessageMetadata;
}

export interface SessionSummary {
  id: string;
  label: string;
  turnCount: number;
}

export interface HealthStatus {
  status: string;
  keys_configured: number;
  cache_enabled: boolean;
}

export interface ChatApiResponse {
  session_id: string;
  reply: string;
  metadata: MessageMetadata;
}

export interface SessionHistoryResponse {
  session_id: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    metadata?: MessageMetadata;
  }>;
}
