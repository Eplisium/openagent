/**
 * 👁️ Vision & Multimodal Support
 * Handles image encoding, MIME type detection, and multimodal message building
 */

import fs from 'fs-extra';
import path from 'path';

/**
 * 📋 Extension to MIME type mapping
 */
const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
};

/**
 * 🧠 Vision-capable model patterns
 */
const VISION_MODEL_PATTERNS = [
  'gpt-4',
  'gpt-5',
  'claude-3',
  'claude-4',
  'gemini',
  'vision',
  'multimodal',
  'llava',
  'qwen-vl',
  'internvl',
];

/**
 * 🔍 Get MIME type from file extension
 * @param {string} filePath - Path to the image file
 * @returns {string} MIME type string
 */
export function getImageMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * 📖 Encode image file to base64 string
 * @param {string} imagePath - Absolute or relative path to the image file
 * @returns {Promise<string>} Base64-encoded image data
 * @throws {Error} If file cannot be read
 */
export async function encodeImageToBase64(imagePath) {
  const resolvedPath = path.resolve(imagePath);
  const exists = await fs.pathExists(resolvedPath);
  if (!exists) {
    throw new Error(`Image file not found: ${resolvedPath}`);
  }
  const buffer = await fs.readFile(resolvedPath);
  return buffer.toString('base64');
}

/**
 * 🧠 Check if a model likely supports vision/multimodal input
 * @param {string} modelId - Model identifier (e.g. 'openai/gpt-4o')
 * @returns {boolean} True if model matches known vision patterns
 */
export function isVisionModel(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  const lower = modelId.toLowerCase();
  return VISION_MODEL_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * 🖼️ Build an OpenAI-compatible multimodal message
 * @param {string} text - Text content for the message
 * @param {Array<{base64: string, mimeType: string}>} images - Array of image objects
 * @returns {{role: string, content: Array}} Multimodal message object
 */
export function buildMultimodalMessage(text, images = []) {
  const content = [];

  if (text) {
    content.push({ type: 'text', text });
  }

  for (const image of images) {
    if (!image.base64 || !image.mimeType) {
      throw new Error('Each image must have base64 and mimeType properties');
    }
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${image.base64}`,
      },
    });
  }

  return { role: 'user', content };
}

export default {
  getImageMimeType,
  encodeImageToBase64,
  isVisionModel,
  buildMultimodalMessage,
};
