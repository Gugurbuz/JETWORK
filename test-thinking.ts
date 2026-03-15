import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const responseStream = await ai.models.generateContentStream({
    model: "gemini-3-flash-preview",
    contents: "How many Rs in strawberry? Think step by step.",
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true }
    }
  });

  for await (const chunk of responseStream) {
    console.log(JSON.stringify(chunk.candidates?.[0]?.content?.parts));
  }
}

test().catch(console.error);
