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
      // Using gemini-2.0-flash - latest fast model with vision support
      // Available in free tier: gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-2.0-flash
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    }
  }

  /**
   * Identify which player is making a move based on the camera frame
   * @param {string} imageBase64 - Base64 encoded image (data:image/jpeg;base64,...)
   * @param {string} colorA - Color of Player A's bracelet (e.g., "#FF0000")
   * @param {string} colorB - Color of Player B's bracelet (e.g., "#0000FF")
   * @returns {Promise<{currentPlayer: string, confidence?: string, rawResponse?: string}>}
   */
  async identifyPlayer(imageBase64, colorA, colorB) {
    if (!this.model) {
      throw new Error('Gemini API key not configured');
    }

    try {
      // Remove data URL prefix if present
      let base64Data = imageBase64;
      if (imageBase64.includes('base64,')) {
        base64Data = imageBase64.split('base64,')[1];
      }

      // Create the prompt
      const prompt = `Single-frame decision for an interactive SCREEN (camera: overhead/top-down or from-below/bottom-up).

      Two players each wear a distinct colored sleeve/bracelet:
      - Player A: ${colorA}
      - Player B: ${colorB}
      
      Task: Decide which player is TOUCHING the screen in THIS frame.
      
      Use only visual evidence in this frame and follow these rules:
      1) Focus on the screen region. Identify visible hands near/on the screen.
      2) Define “touching” as clear physical contact cues: fingertip/palm flattening on glass, zero visible gap, contact shadow/reflection, or occlusion at the screen surface. If uncertain, not touching.
      3) If multiple hands appear touching, pick the one with the clearest/largest contact patch. If none clearly touch, return "None".
      4) Attribute the touching hand to a player by the sleeve/bracelet color at the wrist/forearm. Prefer fabric/band color; ignore skin tone. If the color near that wrist isn’t visible, return "None".
      5) Tie-breaker (only if no clear contact): choose the hand closest to the screen plane by visual cues (smallest gap, strongest contact shadow/reflection). If still ambiguous, return "None".
      6) Ignore background and glare/reflections that don’t belong to a hand. Do not guess.
      
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
      throw error;
    }
  }

  /**
   * Batch identify players for multiple moves
   * @param {Array<{moveId: string, imageBase64: string}>} moves - Array of moves with images
   * @param {string} colorA - Color of Player A's bracelet
   * @param {string} colorB - Color of Player B's bracelet
   * @returns {Promise<Array<{moveId: string, currentPlayer: string, error?: string}>>}
   */
  async identifyPlayersBatch(moves, colorA, colorB) {
    if (!this.model) {
      throw new Error('Gemini API key not configured');
    }

    const results = [];
    
    // Process moves sequentially to avoid rate limiting
    for (const move of moves) {
      try {
        console.log(`[AI Service] Processing move ${move.moveId}...`);
        const result = await this.identifyPlayer(move.imageBase64, colorA, colorB);
        results.push({
          moveId: move.moveId,
          currentPlayer: result.currentPlayer,
          confidence: result.confidence,
          rawResponse: result.rawResponse
        });
        
        // Small delay to avoid rate limiting (adjust as needed)
        await new Promise(resolve => setTimeout(resolve, 500));
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

