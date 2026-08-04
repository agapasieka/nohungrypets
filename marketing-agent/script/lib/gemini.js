'use strict';

/**
 * Thin wrapper around the Google Gemini API (@google/genai) for the two calls
 * this agent makes: text post copy, and the occasional illustration.
 * Both use the same free-tier AI Studio API key.
 */

const { GoogleGenAI } = require('@google/genai');

function createClient(apiKey) {
  return new GoogleGenAI({ apiKey });
}

/**
 * Generate post copy text.
 * @returns {Promise<string>} trimmed post copy
 */
async function generateText(client, model, prompt) {
  const response = await client.models.generateContent({
    model,
    contents: prompt,
  });
  const text = (response && response.text ? response.text : '').trim();
  if (!text) throw new Error('Gemini returned empty text');
  return text;
}

/**
 * Generate an illustration.
 * @returns {Promise<{ data: Buffer, mimeType: string }|null>}
 *          null if the model returned no image part.
 */
async function generateImage(client, model, prompt) {
  const response = await client.models.generateContent({
    model,
    contents: prompt,
  });

  const parts =
    response &&
    response.candidates &&
    response.candidates[0] &&
    response.candidates[0].content &&
    response.candidates[0].content.parts
      ? response.candidates[0].content.parts
      : [];

  for (const part of parts) {
    if (part.inlineData && part.inlineData.data) {
      return {
        data: Buffer.from(part.inlineData.data, 'base64'),
        mimeType: part.inlineData.mimeType || 'image/png',
      };
    }
  }
  return null;
}

module.exports = { createClient, generateText, generateImage };
