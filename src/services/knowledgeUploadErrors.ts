const TRANSPORT_ERROR_PATTERN = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return String(error || '');
};

export const isKnowledgeTransportError = (error: unknown): boolean =>
  TRANSPORT_ERROR_PATTERN.test(errorMessage(error));

export const toKnowledgeOperationError = (
  error: unknown,
  operation: string,
): Error => {
  const message = errorMessage(error).trim();
  if (isKnowledgeTransportError(error)) {
    return new Error(
      `${operation} Supabase bağlantısı kurulamadı. İnternet bağlantısını kontrol edip tekrar deneyin.`,
    );
  }
  if (error instanceof Error) return error;
  return new Error(message || `${operation} tamamlanamadı.`);
};
