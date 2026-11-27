export interface EpistemicCitation {
  title: string;
  source: string;
  href?: string;
}

export interface EpistemicAnswer {
  query: string;
  answer: string;
  confidence: 'high' | 'medium' | 'low';
  citations: EpistemicCitation[];
}

export interface ParsedEpistemicQuery {
  isExplicitQuestion: boolean;
  normalizedQuery: string;
}

const QUESTION_PREFIX_RE = /^(?:\?|ask\s+|explain\s+|why\s+|how\s+|what\s+|where\s+|who\s+)/iu;

export function parseEpistemicQuery(raw: string): ParsedEpistemicQuery {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { isExplicitQuestion: false, normalizedQuery: '' };
  }
  const hasPrefix = QUESTION_PREFIX_RE.test(trimmed);
  const stripped = trimmed.replace(/^(?:\?\s*|ask\s+)/iu, '').trim();
  const wordCount = stripped.split(/\s+/u).filter(Boolean).length;
  return {
    isExplicitQuestion: hasPrefix || wordCount >= 3 || trimmed.endsWith('?'),
    normalizedQuery: stripped || trimmed,
  };
}

export function normalizeEpistemicAnswer(
  query: string,
  payload: unknown
): EpistemicAnswer {
  const root =
    payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).data ?? payload)
      : {};
  const record = root && typeof root === 'object' ? (root as Record<string, unknown>) : {};

  const answer =
    typeof record.answer === 'string' && record.answer.trim().length > 0
      ? record.answer.trim()
      : typeof record.summary === 'string' && record.summary.trim().length > 0
        ? record.summary.trim()
        : 'No verified epistemic answer was returned for this query.';

  const rawConfidence = typeof record.confidence === 'string' ? record.confidence.toLowerCase() : '';
  const confidence: EpistemicAnswer['confidence'] =
    rawConfidence === 'high' || rawConfidence === 'medium' || rawConfidence === 'low'
      ? rawConfidence
      : 'medium';

  const rawCitations = Array.isArray(record.citations)
    ? record.citations
    : Array.isArray(record.sources)
      ? record.sources
      : [];

  const citations: EpistemicCitation[] = rawCitations
    .map((entry): EpistemicCitation | null => {
      if (!entry || typeof entry !== 'object') return null;
      const item = entry as Record<string, unknown>;
      const title =
        typeof item.title === 'string' && item.title.trim().length > 0
          ? item.title.trim()
          : typeof item.source === 'string'
            ? item.source
            : 'Knowledge Source';
      const source =
        typeof item.source === 'string' && item.source.trim().length > 0
          ? item.source.trim()
          : 'epistemic-graph';
      const href = typeof item.href === 'string' && item.href.startsWith('/') ? item.href : undefined;
      return { title, source, href };
    })
    .filter((item): item is EpistemicCitation => item !== null);

  return {
    query,
    answer,
    confidence,
    citations,
  };
}
