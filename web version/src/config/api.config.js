/**
 * API Configuration
 * Centralized configuration for API endpoints
 */

// Environment flag - set to 'production' or 'development'
const ENVIRONMENT = 'production'; // Change this to switch between environments
//const ENVIRONMENT = 'development'; // Change this to switch between environments

const API_CONFIGS = {
  development: {
    baseUrl: 'http://localhost:4000/api',
    healthUrl: 'http://localhost:4000/health'
  },
  production: {
    //baseUrl: 'https://cfg-server.onrender.com/api',
    //healthUrl: 'https://cfg-server.onrender.com/health'
    baseUrl: 'https://cfg-279108523744.europe-west1.run.app/api',
    healthUrl: 'https://cfg-279108523744.europe-west1.run.app/health'

  }
};

// Get current config based on environment
const currentConfig = API_CONFIGS[ENVIRONMENT] || API_CONFIGS.development;

/**
 * Get the API base URL based on current environment
 * @returns {string} API base URL
 */
export const getApiBaseUrl = () => {
  // Allow override via environment variable (Vite)
  if (import.meta?.env?.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  return currentConfig.baseUrl;
};

/**
 * Get the health check URL
 * @returns {string} Health check URL
 */
export const getHealthUrl = () => {
  if (import.meta?.env?.VITE_HEALTH_URL) {
    return import.meta.env.VITE_HEALTH_URL;
  }
  return currentConfig.healthUrl;
};

/**
 * Check server health
 * @returns {Promise<{status: string, version: string, commit: string}>}
 */
export const checkServerHealth = async () => {
  try {
    const response = await fetch(getHealthUrl(), {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      status: data.status || 'unknown',
      version: data.version || 'unknown',
      commit: data.commit || 'unknown',
      healthy: data.status === 'ok'
    };
  } catch (error) {
    console.error('[API Config] Health check error:', error);
    return {
      status: 'error',
      version: 'unknown',
      commit: 'unknown',
      healthy: false,
      error: error.message
    };
  }
};

/**
 * Get current environment
 * @returns {string} Current environment (development/production)
 */
export const getEnvironment = () => ENVIRONMENT;

/**
 * Check if in development mode
 * @returns {boolean}
 */
export const isDevelopment = () => ENVIRONMENT === 'development';

/**
 * Check if in production mode
 * @returns {boolean}
 */
export const isProduction = () => ENVIRONMENT === 'production';

export default {
  getApiBaseUrl,
  getHealthUrl,
  checkServerHealth,
  getEnvironment,
  isDevelopment,
  isProduction
};

