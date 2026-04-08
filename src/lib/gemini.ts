import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface DetectionResult {
  class: string;
  severity: "Low" | "Medium" | "High";
  confidence: number;
  description: string;
}

export async function detectRoadDefects(base64Image: string): Promise<DetectionResult> {
  const prompt = `
    Analyze this road image for defects like potholes, cracks, or surface degradation.
    Provide the following in JSON format:
    - class: "pothole", "crack", or "degradation"
    - severity: "Low", "Medium", or "High"
    - confidence: a number between 0 and 1
    - description: a brief description of the defect
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: "image/jpeg", data: base64Image } }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          class: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ["Low", "Medium", "High"] },
          confidence: { type: Type.NUMBER },
          description: { type: Type.STRING }
        },
        required: ["class", "severity", "confidence", "description"]
      }
    }
  });

  return JSON.parse(response.text);
}
