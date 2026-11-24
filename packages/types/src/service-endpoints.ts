/**
 * Canonical default local service endpoint URLs and origins shared across workspace packages.
 * Issue #247: single source of truth for local control-plane, ISP, Board, and Ollama endpoints.
 */
export const DEFAULT_CONTROL_PLANE_URL = 'http://127.0.0.1:3003' as const;
export const DEFAULT_ISP_SERVICE_URL = 'http://127.0.0.1:3002' as const;
export const DEFAULT_BOARD_ORIGIN = 'http://127.0.0.1:5173' as const;
export const DEFAULT_LOCALHOST_BOARD_ORIGIN = 'http://localhost:5173' as const;
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434' as const;
