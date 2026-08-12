/**
 * Antigravity OAuth — 基于通用 Google OAuth provider 工厂的配置绑定
 */
import { createGoogleOAuthProvider } from '../google-oauth/provider.js'

export const ANTIGRAVITY_API_BASE = 'https://daily-cloudcode-pa.googleapis.com'
export const ANTIGRAVITY_USER_AGENT = 'antigravity/cli/1.0.1 windows/amd64'
const ANTIGRAVITY_CLIENT_ID = String(process.env.LOLI_ANTIGRAVITY_CLIENT_ID || '').trim()
const ANTIGRAVITY_CLIENT_SECRET = String(process.env.LOLI_ANTIGRAVITY_CLIENT_SECRET || '').trim()

const provider = createGoogleOAuthProvider({
  name: 'antigravity',
  label: 'Antigravity',
  clientId: ANTIGRAVITY_CLIENT_ID,
  clientSecret: ANTIGRAVITY_CLIENT_SECRET,
  scopes: [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
  ],
  defaultApiBase: ANTIGRAVITY_API_BASE,
  userAgent: ANTIGRAVITY_USER_AGENT,
  ideType: 'ANTIGRAVITY',
  clientIdEnv: 'LOLI_ANTIGRAVITY_CLIENT_ID',
  clientSecretEnv: 'LOLI_ANTIGRAVITY_CLIENT_SECRET'
})

export const AntigravityCredentialStore = provider.CredentialStore

export function beginAntigravityOAuth (opts) {
  return provider.beginOAuth(opts)
}

export function completeAntigravityOAuth (callbackUrl, expectedChannelId) {
  return provider.completeOAuth(callbackUrl, expectedChannelId)
}

export function getAntigravityCredential (opts) {
  return provider.getCredential(opts)
}

export function getAntigravityOAuthStatus (opts) {
  return provider.getOAuthStatus(opts)
}

export function removeAntigravityCredential (opts) {
  return provider.removeCredential(opts)
}

export function updateAntigravityAccount (opts) {
  return provider.updateAccount(opts)
}

export function buildAntigravityHeaders (accessToken) {
  return provider.authHeaders(accessToken)
}

export async function fetchAntigravityEntitlements ({ apiBase, accessToken } = {}) {
  return provider.extractProjectAndTier(await provider.loadProject(apiBase, accessToken))
}

export function normalizeAntigravityApiBase (value) {
  return provider.safeApiBase(value)
}
