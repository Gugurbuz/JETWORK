import { supabase } from '../supabase';

export const callGemini = async (params: {
  model: string;
  systemInstruction: string;
  contents: any[];
  responseSchema?: any;
  tools?: any[];
  onChunk: (text: string, thinking?: string, tokenCount?: number, functionCalls?: any[]) => void;
  onGrounding?: (urls: { uri: string; title: string }[]) => void;
}) => {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  
  const response = await fetch(`${supabaseUrl}/functions/v1/gemini-chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || ''
    },
    body: JSON.stringify({
      model: params.model,
      systemInstruction: params.systemInstruction,
      contents: params.contents,
      responseSchema: params.responseSchema,
      tools: params.tools
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `API error: ${response.status}`);
  }
  if (!response.body) throw new Error("No response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let fullThinking = '';
  let tokenCount = 0;
  let buffer = '';
  let allFunctionCalls: any[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6);
        if (dataStr === '[DONE]') continue;
        
        try {
          const chunk = JSON.parse(dataStr);
          if (chunk.usageMetadata) {
            tokenCount = chunk.usageMetadata.totalTokenCount;
          }
          
          const parts = chunk.candidates?.[0]?.content?.parts || [];
          let chunkFunctionCalls: any[] = [];
          
          for (const part of parts) {
            if (part.thought) {
              fullThinking += part.text;
            } else if (part.text) {
              fullText += part.text;
            } else if (part.functionCall) {
              chunkFunctionCalls.push(part.functionCall);
              allFunctionCalls.push(part.functionCall);
            }
          }
          
          const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
          if (groundingChunks && params.onGrounding) {
            const urls = groundingChunks
              .filter((c: any) => c.web?.uri && c.web?.title)
              .map((c: any) => ({ uri: c.web.uri, title: c.web.title }));
            if (urls.length > 0) params.onGrounding(urls);
          }
          
          params.onChunk(fullText, fullThinking, tokenCount, chunkFunctionCalls.length > 0 ? chunkFunctionCalls : undefined);
        } catch (e) {
          console.error("Error parsing chunk:", e, dataStr);
        }
      }
    }
  }
  return { text: fullText, thinking: fullThinking, tokenCount, functionCalls: allFunctionCalls };
};

export const callAiWithRetry = async (
  fn: () => Promise<any>,
  maxRetries = 5,
  initialDelay = 4000
) => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message || String(error);
      const isQuotaError = errorMsg.includes('429') || 
                          errorMsg.includes('RESOURCE_EXHAUSTED') || 
                          errorMsg.includes('quota');
      
      if (isQuotaError && i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Quota exceeded. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};
