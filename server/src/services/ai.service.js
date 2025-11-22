const { GoogleGenerativeAI } = require('@google/generative-ai');

class AIService {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[AI Service] GEMINI_API_KEY not found in environment variables');
    }
    this.genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;
    this.model = null;

    if (this.genAI) {
      // ============== AVAILABLE FREE TIER GEMINI MODELS (2025) ==============
      //
      // 1. **gemini-2.5-pro** - High reasoning capabilities
      //    - Best for: Complex analytical tasks, detailed code generation, sophisticated reasoning
      //    - Rate Limits: 5 requests/minute, 25 requests/day
      //    - Context Window: 1 million tokens
      //    - Use Case: Testing, prototyping, personal projects
      //
      // 2. **gemini-2.5-flash** - Best price-performance ratio (CURRENTLY USING)
      //    - Best for: General queries, low-latency tasks, large-scale processing
      //    - Rate Limits: 5-15 requests/minute (generous free tier)
      //    - Optimized for: Speed and grounded answers
      //    - Use Case: Production-ready applications with moderate volume
      //
      // 3. **gemini-2.5-flash-lite** - Ultra fast and cost-efficient
      //    - Best for: High throughput, cost-efficiency
      //    - Rate Limits: Higher throughput than standard Flash
      //    - Use Case: Lightweight tasks requiring maximum speed
      //
      // 4. **gemini-2.0-flash** - Second generation workhorse
      //    - Context Window: 1 million tokens
      //    - Use Case: Previous generation stable model
      //
      // 5. **gemini-2.0-flash-lite** - Second generation small model
      //    - Context Window: 1 million tokens
      //    - Use Case: Previous generation lightweight model
      //
      // Additional variants available:
      //    - gemini-2.5-flash-native-audio (audio processing)
      //    - gemini-2.5-flash-image (image-focused tasks)
      //
      // Note: Free tier includes commercial usage rights, but rate limits may not
      // support high-volume production use. Access via Google AI Studio.
      //
      // =======================================================================
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    }
  }

  /**
   * Identify which player is making a move based on the camera frame
   * @param {string} imageBase64 - Base64 encoded image (data:image/jpeg;base64,...)
   * @param {string} colorA - Color of Player A's bracelet (e.g., "#FF0000")
   * @param {string} colorB - Color of Player B's bracelet (e.g., "#0000FF")
   * @param {string} [cameraPosition] - Camera position: 'top' (overhead/top-down) or 'bottom' (from-below/bottom-up)
   * @returns {Promise<{currentPlayer: string, confidence?: string, rawResponse?: string}>}
   */
  async identifyPlayer(imageBase64, colorA, colorB, cameraPosition = null, retryCount = 0) {
    if (!this.model) {
      throw new Error('Gemini API key not configured');
    }

    const maxRetries = 3;

    try {
      // Remove data URL prefix if present
      let base64Data = imageBase64;
      if (imageBase64.includes('base64,')) {
        base64Data = imageBase64.split('base64,')[1];
      }

      // Determine camera description based on position parameter
      let cameraDescription;
      if (cameraPosition === 'top') {
        cameraDescription = 'overhead/top-down';
      } else if (cameraPosition === 'bottom') {
        cameraDescription = 'from-below/bottom-up';
      } else {
        cameraDescription = 'overhead/top-down or from-below/bottom-up';
      }

      // Create the prompt
      const prompt = `Single-frame decision for an interactive SCREEN (camera: ${cameraDescription}).

      Two players each wear a distinct colored sleeve/bracelet:
      - Player A: ${colorA}
      - Player B: ${colorB}
      
      Task: Decide which player is TOUCHING the screen in THIS frame.
      
      Use only visual evidence in this frame and follow these rules:
      1) Focus on the screen region. Identify visible hands near/on the screen.
      2) Define "touching" as clear physical contact cues: fingertip/palm flattening on glass, zero visible gap, contact shadow/reflection, or occlusion at the screen surface. If uncertain, not touching.
      3) If multiple hands appear touching, pick the one with the clearest/largest contact patch. If none clearly touch, return "None".
      4) Attribute the touching hand to a player by the sleeve/bracelet color at the wrist/forearm. Prefer fabric/band color; ignore skin tone. If the color near that wrist isn't visible, return "None".
      5) Tie-breaker (only if no clear contact): choose the hand closest to the screen plane by visual cues (smallest gap, strongest contact shadow/reflection). If still ambiguous, return "None".
      6) Ignore background and glare/reflections that don't belong to a hand. Do not guess.
      
      Respond with JSON only (no extra text):
      {"currentPlayer":"A"} or {"currentPlayer":"B"} or {"currentPlayer":"None"}`;


      // Prepare the image part
      const imagePart = {
        inlineData: {
          data: base64Data,
          mimeType: 'image/jpeg'
        }
      };


      // Generate content
      const result = await this.model.generateContent([prompt, imagePart]);
      const response = await result.response;
      const text = response.text().trim();

      console.log('[AI Service] Raw response:', text);

      // Parse JSON response
      let parsedResponse;
      try {
        // Try to extract JSON from markdown code blocks if present
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
        const jsonText = jsonMatch ? jsonMatch[1] : text;

        parsedResponse = JSON.parse(jsonText);
      } catch (parseError) {
        console.error('[AI Service] Failed to parse JSON:', text);
        // Try to extract player from text
        if (text.includes('"A"') || text.toLowerCase().includes('player a')) {
          parsedResponse = { currentPlayer: 'A' };
        } else if (text.includes('"B"') || text.toLowerCase().includes('player b')) {
          parsedResponse = { currentPlayer: 'B' };
        } else {
          parsedResponse = { currentPlayer: 'None' };
        }
      }

      // Normalize the response
      const currentPlayer = parsedResponse.currentPlayer || 'None';

      return {
        currentPlayer,
        confidence: parsedResponse.confidence,
        rawResponse: text
      };
    } catch (error) {
      console.error('[AI Service] Error identifying player:', error);

      // Check if it's a retryable error (503 or rate limit)
      const is503 = error.message?.includes('503') || error.message?.includes('overloaded');
      const isRateLimit = error.message?.includes('429') || error.message?.includes('rate limit');

      if ((is503 || isRateLimit) && retryCount < maxRetries) {
        // Exponential backoff: 2s, 4s, 8s
        const waitTime = Math.pow(2, retryCount + 1) * 1000;
        console.log(`[AI Service] API overloaded, retrying in ${waitTime / 1000}s... (attempt ${retryCount + 1}/${maxRetries})`);

        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.identifyPlayer(imageBase64, colorA, colorB, cameraPosition, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Batch identify players for multiple moves
   * @param {Array<{moveId: string, imageBase64: string}>} moves - Array of moves with images
   * @param {string} colorA - Color of Player A's bracelet
   * @param {string} colorB - Color of Player B's bracelet
   * @param {string} [cameraPosition] - Camera position: 'top' or 'bottom'
   * @returns {Promise<Array<{moveId: string, currentPlayer: string, error?: string}>>}
   */
  async identifyPlayersBatch(moves, colorA, colorB, cameraPosition = null) {
    if (!this.model) {
      throw new Error('Gemini API key not configured');
    }

    const results = [];

    // Process moves sequentially to avoid rate limiting
    for (const move of moves) {
      try {
        console.log(`[AI Service] Processing move ${move.moveId}...`);
        const result = await this.identifyPlayer(move.imageBase64, colorA, colorB, cameraPosition);
        results.push({
          moveId: move.moveId,
          currentPlayer: result.currentPlayer,
          confidence: result.confidence,
          rawResponse: result.rawResponse
        });

        // Small delay to avoid rate limiting (1.5s between requests)
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (error) {
        console.error(`[AI Service] Error processing move ${move.moveId}:`, error);
        results.push({
          moveId: move.moveId,
          currentPlayer: 'None',
          error: error.message
        });
      }
    }

    return results;
  }
}

// Singleton instance
module.exports = new AIService();

