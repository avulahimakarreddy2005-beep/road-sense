import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

export interface ImageQuality {
  isBlurry: boolean;
  isDark: boolean;
  width: number;
  height: number;
  size: number;
  score: number;
}

export interface AnalysisResult {
  quality: ImageQuality;
  detections: { class: string; score: number }[];
}

let model: cocoSsd.ObjectDetection | null = null;

export async function loadModel() {
  if (!model) {
    await tf.ready();
    model = await cocoSsd.load();
  }
  return model;
}

export async function analyzeImage(file: File): Promise<AnalysisResult> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  
  return new Promise((resolve, reject) => {
    img.onload = async () => {
      URL.revokeObjectURL(url);
      
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject("Could not get canvas context");
      
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      // 1. Darkness Check (Average Brightness)
      let brightness = 0;
      for (let i = 0; i < data.length; i += 4) {
        brightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
      }
      const avgBrightness = brightness / (data.length / 4);
      const isDark = avgBrightness < 40;
      
      // 2. Blur Detection (Simplified Edge Variance)
      // We'll use a simple Laplacian-like check on a smaller sample for speed
      let laplacianVar = 0;
      const sampleSize = 100;
      const step = Math.floor(Math.sqrt((canvas.width * canvas.height) / sampleSize));
      
      let count = 0;
      let sum = 0;
      let sumSq = 0;
      
      for (let y = 1; y < canvas.height - 1; y += step) {
        for (let x = 1; x < canvas.width - 1; x += step) {
          const idx = (y * canvas.width + x) * 4;
          const val = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          
          // Simple 4-neighbor Laplacian
          const left = (data[idx - 4] + data[idx - 3] + data[idx - 2]) / 3;
          const right = (data[idx + 4] + data[idx + 5] + data[idx + 6]) / 3;
          const top = (data[idx - canvas.width * 4] + data[idx - canvas.width * 4 + 1] + data[idx - canvas.width * 4 + 2]) / 3;
          const bottom = (data[idx + canvas.width * 4] + data[idx + canvas.width * 4 + 1] + data[idx + canvas.width * 4 + 2]) / 3;
          
          const lap = Math.abs(4 * val - left - right - top - bottom);
          sum += lap;
          sumSq += lap * lap;
          count++;
        }
      }
      
      const mean = sum / count;
      const variance = (sumSq / count) - (mean * mean);
      const isBlurry = variance < 10; // Threshold for "blurry"

      // 3. Object Detection (TF.js)
      const model = await loadModel();
      const tfDetections = await model.detect(img);
      
      resolve({
        quality: {
          isBlurry,
          isDark,
          width: img.width,
          height: img.height,
          size: file.size,
          score: Math.min(100, Math.max(0, (variance / 50) * 100))
        },
        detections: tfDetections.map(d => ({ class: d.class, score: d.score }))
      });
    };
    img.onerror = reject;
    img.src = url;
  });
}
