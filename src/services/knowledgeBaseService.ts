import { supabase } from '../supabase';

// Basit Metin Parçalama (Chunking) Algoritması
const splitTextIntoChunks = (text: string, maxChunkSize = 1000): string[] => {
  const words = text.split(' ');
  const chunks = [];
  let currentChunk = '';

  for (const word of words) {
    if (currentChunk.length + word.length > maxChunkSize) {
      chunks.push(currentChunk);
      currentChunk = '';
    }
    currentChunk += `${word} `;
  }
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
};

export const ingestDocumentToVectorDB = async (documentText: string, metadata: any = {}) => {
  try {
    const chunks = splitTextIntoChunks(documentText);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

    // Her bir chunk için Edge Function'a (veya direkt Gemini API'ye) gidip Embedding almalıyız.
    // MVP için güvenlik adına bu işlemi de bir edge function'da (örn: embed-document) yapmak en doğrusudur, 
    // ancak hızlı test için frontend'den Supabase Insert yapılabilir.
    
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/embed-and-save`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ chunks, metadata })
    });

    if (!response.ok) throw new Error("Veri yükleme başarısız");
    
    console.log("Dokümanlar başarıyla vektör DB'ye işlendi.");
  } catch (error) {
    console.error("Ingestion Error:", error);
  }
};
