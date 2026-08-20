const TRANSPORT_ERROR_PATTERN = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i;

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message || '');
  }
  return String(error || '');
};

const functionResponseErrorMessage = async (error: unknown): Promise<string> => {
  if (!error || typeof error !== 'object' || !('context' in error)) return '';
  const context = (error as { context?: unknown }).context;
  if (!context || typeof context !== 'object' || !('json' in context)) return '';

  try {
    const response = 'clone' in context && typeof context.clone === 'function'
      ? context.clone()
      : context;
    if (!('json' in response) || typeof response.json !== 'function') return '';
    const payload = await response.json() as { error?: unknown } | null;
    return typeof payload?.error === 'string' ? payload.error.trim() : '';
  } catch {
    return '';
  }
};

const localizeKnowledgeFunctionError = (message: string, operation: string): string => {
  if (!message) return `${operation} tamamlanamadı. Lütfen tekrar deneyin.`;
  if (/bilgi|dosya|kaynak|oturum|erişim|sınır|çıkarılamadı|destekler/i.test(message)) return message;
  if (/access denied|outside the authenticated knowledge scope/i.test(message)) {
    return 'Bu bilgi bankasına dosya ekleme yetkiniz yok.';
  }
  if (/valid user session|authentication is required|permanent user account/i.test(message)) {
    return 'Bilgi kaynağı yüklemek için geçerli bir kullanıcı oturumu gerekli.';
  }
  if (/exceeds the 20 mb limit/i.test(message)) {
    return 'Bilgi kaynağı 20 MB dosya sınırını aşıyor.';
  }
  if (/source text exceeds the 5 mb limit/i.test(message)) {
    return 'Dosyadan çıkarılan metin 5 MB sınırını aşıyor; kaynağı daha küçük parçalara ayırın.';
  }
  return `${operation} sunucu tarafında tamamlanamadı. Lütfen tekrar deneyin.`;
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

export const toKnowledgeFunctionOperationError = async (
  error: unknown,
  operation: string,
): Promise<Error> => {
  if (isKnowledgeTransportError(error)) return toKnowledgeOperationError(error, operation);
  const responseMessage = await functionResponseErrorMessage(error);
  if (responseMessage) {
    return new Error(localizeKnowledgeFunctionError(responseMessage, operation));
  }
  if (/edge function returned a non-2xx status code/i.test(errorMessage(error))) {
    return new Error(`${operation} sunucu tarafında tamamlanamadı. Lütfen tekrar deneyin.`);
  }
  return toKnowledgeOperationError(error, operation);
};
