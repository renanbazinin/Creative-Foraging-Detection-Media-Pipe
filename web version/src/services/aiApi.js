/**
 * AI API Service
 * Handles AI-powered player identification using Gemini API
 */

import { getApiBaseUrl } from '../config/api.config';

/**
 * Get admin password from localStorage
 */
const getAdminPassword = () => {
  return localStorage.getItem('adminPassword') || '';
};

/**
 * Identify player for a single move using AI
 * @param {string} sessionGameId - Session game ID
 * @param {string} moveId - Move ID
 * @param {string} colorA - Player A bracelet color (hex)
 * @param {string} colorB - Player B bracelet color (hex)
 * @returns {Promise<{moveId: string, suggestion: string, confidence?: string}>}
 */
export const identifyMove = async (sessionGameId, moveId, colorA, colorB) => {
  const baseUrl = getApiBaseUrl();
  const password = getAdminPassword();

  const response = await fetch(`${baseUrl}/ai/identify-move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password
    },
    body: JSON.stringify({
      sessionGameId,
      moveId,
      colorA,
      colorB
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to identify move');
  }

  return response.json();
};

/**
 * Identify players for multiple moves using AI (batch processing)
 * @param {string} sessionGameId - Session game ID
 * @param {Array<string>} moveIds - Array of move IDs (optional, if empty processes all)
 * @param {string} colorA - Player A bracelet color (hex) - optional if saved in session
 * @param {string} colorB - Player B bracelet color (hex) - optional if saved in session
 * @param {boolean} onlyUnknown - Only process moves with Unknown/None player
 * @returns {Promise<{results: Array, processed: number, colorsUsed: Object}>}
 */
export const identifyMovesBatch = async (sessionGameId, moveIds, colorA, colorB, onlyUnknown = false) => {
  const baseUrl = getApiBaseUrl();
  const password = getAdminPassword();

  const body = {
    sessionGameId,
    moveIds,
    onlyUnknown
  };

  // Only include colors if provided (server will use session colors if not)
  if (colorA && colorB) {
    body.colorA = colorA;
    body.colorB = colorB;
  }

  const response = await fetch(`${baseUrl}/ai/identify-moves-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to identify moves');
  }

  return response.json();
};

/**
 * Get count of unidentified moves (Unknown/None player)
 * @param {string} sessionGameId - Session game ID
 * @returns {Promise<{count: number, moveIds: Array<string>}>}
 */
export const getUnidentifiedMoves = async (sessionGameId) => {
  const baseUrl = getApiBaseUrl();
  const password = getAdminPassword();

  const response = await fetch(`${baseUrl}/ai/unidentified-moves/${sessionGameId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password
    }
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to get unidentified moves');
  }

  return response.json();
};

/**
 * Update move player assignment
 * @param {string} sessionGameId - Session game ID
 * @param {string} moveId - Move ID
 * @param {string} player - Player name (A, B, or Unknown)
 * @returns {Promise<Object>}
 */
export const updateMovePlayer = async (sessionGameId, moveId, player) => {
  const baseUrl = getApiBaseUrl();
  const password = getAdminPassword();

  const response = await fetch(`${baseUrl}/sessions/${sessionGameId}/moves/${moveId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password
    },
    body: JSON.stringify({ player })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update move');
  }

  return response.json();
};

export default {
  identifyMove,
  identifyMovesBatch,
  getUnidentifiedMoves,
  updateMovePlayer
};

