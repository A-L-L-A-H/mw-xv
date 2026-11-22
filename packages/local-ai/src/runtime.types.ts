export interface LocalAiRequest {
  prompt: string;
  jsonSchema?: Readonly<Record<string, unknown>>;
}

export type LocalAiResult =
  | { status: 'disabled' }
  | { status: 'unavailable'; reason: 'timeout' | 'provider_unreachable' | 'invalid_response' }
  | { status: 'generated'; text: string };

export interface LocalAiRuntime {
  generate(request: LocalAiRequest): Promise<LocalAiResult>;
}
