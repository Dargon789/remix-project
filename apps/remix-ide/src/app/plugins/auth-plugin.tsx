import { Plugin } from '@remixproject/engine'
import { AuthUser, AuthProvider as AuthProviderType, ApiClient, SSOApiService, CreditsApiService, Credits } from '@remix-api'
import { endpointUrls } from '@remix-endpoints-helper'
import { getAddress } from 'ethers'

const profile = {
  name: 'auth',
  displayName: 'Authentication',
  description: 'Handles SSO authentication and credits',
  methods: ['login', 'logout', 'getUser', 'getCredits', 'refreshCredits', 'linkAccount', 'getLinkedAccounts', 'unlinkAccount', 'getApiClient', 'getSSOApi', 'getCreditsApi'],
  events: ['authStateChanged', 'creditsUpdated', 'accountLinked']
}

export class AuthPlugin extends Plugin {
  private apiClient: ApiClient
  private ssoApi: SSOApiService
  private creditsApi: CreditsApiService
  private refreshTimer: number | null = null

  constructor() {
    super(profile)

    // Initialize API clients
    this.apiClient = new ApiClient(endpointUrls.sso)
    this.ssoApi = new SSOApiService(this.apiClient)

    // Credits API uses different base URL
    const creditsClient = new ApiClient(endpointUrls.credits)
    this.creditsApi = new CreditsApiService(creditsClient)

    // Set up token refresh callback for auto-renewal
    this.apiClient.setTokenRefreshCallback(() => this.refreshAccessToken())
    creditsClient.setTokenRefreshCallback(() => this.refreshAccessToken())
  }

  private clearRefreshTimer() {
    if (this.refreshTimer) {
      window.clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  private getTokenExpiryMs(token: string): number | null {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      const payload = JSON.parse(atob(parts[1]))
      if (!payload.exp) return null
      return payload.exp * 1000
    } catch {
      return null
    }
  }

  private scheduleRefresh(accessToken: string) {
    const expMs = this.getTokenExpiryMs(accessToken)
    if (!expMs) return

    // Don’t schedule if we don’t have a refresh token available
    const hasRefresh = !!localStorage.getItem('remix_refresh_token')
    if (!hasRefresh) return

    const now = Date.now()
    // Refresh 90s before expiry (min 5s)
    const delay = Math.max(expMs - now - 90_000, 5_000)

    this.clearRefreshTimer()
    this.refreshTimer = window.setTimeout(() => {
      this.refreshAccessToken().catch(() => {/* handled in method */})
    }, delay)
  }

  /**
   * Get the generic API client (for SSO endpoints)
   */
  async getApiClient(): Promise<ApiClient> {
    return this.apiClient
  }

  /**
   * Get the typed SSO API service
   */
  async getSSOApi(): Promise<SSOApiService> {
    return this.ssoApi
  }

  /**
   * Get the typed Credits API service
   */
  async getCreditsApi(): Promise<CreditsApiService> {
    return this.creditsApi
  }

  async login(provider: AuthProviderType): Promise<void> {
    try {
      console.log('[AuthPlugin] Starting popup-based login for:', provider)

      // SIWE requires special handling (client-side wallet signature)
      if (provider === 'siwe') {
        await this.loginWithSIWE()
        return
      }

      // Open popup directly (must be in user click event)
      const popup = window.open(
        `${endpointUrls.sso}/login/${provider}?mode=popup&origin=${encodeURIComponent(window.location.origin)}`,
        'RemixLogin',
        'width=500,height=600,menubar=no,toolbar=no,location=no,status=no'
      )

      if (!popup) {
        throw new Error('Popup was blocked. Please allow popups for this site.')
      }

      // Wait for message from popup
      const result = await new Promise<{user: AuthUser; accessToken: string; refreshToken: string}>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup()
          reject(new Error('Login timeout'))
        }, 5 * 60 * 1000) // 5 minute timeout

        // Poll to detect if popup is closed
        const pollInterval = setInterval(() => {
          if (popup && popup.closed) {
            cleanup()
            reject(new Error('Login cancelled - popup was closed'))
          }
        }, 500) // Check every 500ms

        const handleMessage = (event: MessageEvent) => {
          // Verify origin
          if (event.origin !== new URL(endpointUrls.sso).origin) {
            return
          }

          if (event.data.type === 'sso-auth-success') {
            console.log('[AuthPlugin] Received auth success from popup')
            console.log('[AuthPlugin] User data from popup:', event.data.user)
            console.log('[AuthPlugin] User provider field:', event.data.user?.provider)
            cleanup()
            resolve({
              user: event.data.user,
              accessToken: event.data.accessToken,
              refreshToken: event.data.refreshToken
            })
          } else if (event.data.type === 'sso-auth-error') {
            cleanup()
            reject(new Error(event.data.error || 'Login failed'))
          }
        }

        const cleanup = () => {
          clearTimeout(timeout)
          clearInterval(pollInterval)
          window.removeEventListener('message', handleMessage)
          if (popup && !popup.closed) {
            popup.close()
          }
        }

        window.addEventListener('message', handleMessage)
      })

      // Store tokens in localStorage
      console.log('[AuthPlugin] Storing user in localStorage:', result.user)
      console.log('[AuthPlugin] User has provider field:', result.user.provider)
      localStorage.setItem('remix_access_token', result.accessToken)
      localStorage.setItem('remix_refresh_token', result.refreshToken)
      localStorage.setItem('remix_user', JSON.stringify(result.user))
      console.log('[AuthPlugin] Stored user JSON:', localStorage.getItem('remix_user'))

      // Schedule proactive refresh based on access token expiry
      this.scheduleRefresh(result.accessToken)

      // Emit auth state change
      this.emit('authStateChanged', {
        isAuthenticated: true,
        user: result.user,
        token: result.accessToken
      })

      // Fetch credits after successful login
      this.refreshCredits().catch(console.error)

      console.log('[AuthPlugin] Login successful')
    } catch (error) {
      console.error('[AuthPlugin] Login failed:', error)
      throw error
    }
  }

  async logout(): Promise<void> {
    try {
      // Call backend logout endpoint
      await fetch(`${endpointUrls.sso}/logout`, {
        method: 'POST',
        credentials: 'include'
      })

      // Clear localStorage
      this.clearRefreshTimer()
      localStorage.removeItem('remix_access_token')
      localStorage.removeItem('remix_refresh_token')
      localStorage.removeItem('remix_user')

      // Emit auth state change
      this.emit('authStateChanged', {
        isAuthenticated: false,
        user: null,
        token: null
      })

      console.log('[AuthPlugin] Logout successful')
    } catch (error) {
      console.error('[AuthPlugin] Logout failed:', error)
    }
  }

  async linkAccount(provider: AuthProviderType): Promise<void> {
    try {
      console.log('[AuthPlugin] Starting account linking for:', provider)

      // Check if already logged in and save current session
      const currentToken = await this.getToken()
      const currentUserStr = localStorage.getItem('remix_user')
      const currentUser = currentUserStr ? JSON.parse(currentUserStr) : null

      if (!currentToken || !currentUser) {
        throw new Error('You must be logged in to link additional accounts')
      }

      console.log('[AuthPlugin] Current user:', currentUser.sub)

      // SIWE linking
      if (provider === 'siwe') {
        await this.linkSIWEAccount()
        return
      }

      // OAuth providers - open popup for linking
      const popup = window.open(
        `${endpointUrls.sso}/login/${provider}?mode=popup&link=true&origin=${encodeURIComponent(window.location.origin)}`,
        'RemixLinkAccount',
        'width=500,height=600,menubar=no,toolbar=no,location=no,status=no'
      )

      if (!popup) {
        throw new Error('Popup was blocked. Please allow popups for this site.')
      }

      // Wait for message from popup
      const result = await new Promise<{user: AuthUser; accessToken: string}>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup()
          reject(new Error('Account linking timeout'))
        }, 5 * 60 * 1000)

        // Poll to detect if popup is closed
        const pollInterval = setInterval(() => {
          if (popup && popup.closed) {
            cleanup()
            reject(new Error('Account linking cancelled - popup was closed'))
          }
        }, 500) // Check every 500ms

        const handleMessage = (event: MessageEvent) => {
          if (event.origin !== new URL(endpointUrls.sso).origin) {
            return
          }

          const data = event.data
          if (data.type === 'sso-auth-success') {
            cleanup()
            resolve(data)
          } else if (data.type === 'sso-auth-error') {
            cleanup()
            reject(new Error(data.error || 'Account linking failed'))
          }
        }

        const cleanup = () => {
          clearTimeout(timeout)
          clearInterval(pollInterval)
          window.removeEventListener('message', handleMessage)
        }

        window.addEventListener('message', handleMessage)
      })

      console.log('[AuthPlugin] Got new account info:', result.user.sub)

      // DON'T update localStorage - keep the original session!
      // We're linking, not switching accounts

      // Call backend to link the accounts using CURRENT user's token
      const linkResponse = await fetch(`${endpointUrls.sso}/accounts/link/${provider}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentToken}` // Use original token, not new one
        },
        body: JSON.stringify({
          user_id: result.user.sub // This is already a numeric ID from JWT
        })
      })

      if (!linkResponse.ok) {
        const error = await linkResponse.json().catch(() => ({ error: 'Failed to link account' }))
        throw new Error(error.error || 'Account linking failed')
      }

      console.log('[AuthPlugin] Account linked successfully! Keeping original session.')
      this.emit('accountLinked', { provider })

      // Restore original session in case popup response tried to change it
      localStorage.setItem('remix_access_token', currentToken)
      localStorage.setItem('remix_user', JSON.stringify(currentUser))

    } catch (error: any) {
      console.error('[AuthPlugin] Account linking failed:', error)
      throw error
    }
  }

  async getUser(): Promise<AuthUser | null> {
    try {
      const userStr = localStorage.getItem('remix_user')
      return userStr ? JSON.parse(userStr) : null
    } catch (error) {
      console.error('[AuthPlugin] Get user failed:', error)
      return null
    }
  }

  async isAuthenticated(): Promise<boolean> {
    return !!localStorage.getItem('remix_access_token')
  }

  async getToken(): Promise<string | null> {
    const token = localStorage.getItem('remix_access_token')

    // Update API clients with current token
    if (token) {
      this.apiClient.setToken(token)
      // Update credits client too
      const creditsClient = await this.getCreditsApi()
      const creditsApiClient = (creditsClient as any).apiClient as ApiClient
      creditsApiClient.setToken(token)
    }

    return token
  }

  /**
   * Refresh access token using refresh token
   * Called automatically by API client on 401 errors
   */
  private async refreshAccessToken(): Promise<string | null> {
    try {
      const refreshToken = localStorage.getItem('remix_refresh_token')
      if (!refreshToken) {
        console.warn('[AuthPlugin] No refresh token available')
        return null
      }

      console.log('[AuthPlugin] Refreshing access token...')

      const response = await this.ssoApi.refreshToken(refreshToken)

      if (response.ok && response.data) {
        const newAccessToken = response.data.access_token

        // Update localStorage
        localStorage.setItem('remix_access_token', newAccessToken)

        // If new refresh token provided, update it too
        if (response.data.refresh_token) {
          localStorage.setItem('remix_refresh_token', response.data.refresh_token)
        }

        // Update all API clients
        this.apiClient.setToken(newAccessToken)
        const creditsClient = await this.getCreditsApi()
        const creditsApiClient = (creditsClient as any).apiClient as ApiClient
        creditsApiClient.setToken(newAccessToken)

        console.log('[AuthPlugin] Access token refreshed successfully')

        // Reschedule next proactive refresh
        this.scheduleRefresh(newAccessToken)
        return newAccessToken
      }

      console.warn('[AuthPlugin] Token refresh failed:', response.error)

      // If refresh failed, clear tokens and emit logout
      if (response.status === 401) {
        await this.logout()
      }

      return null
    } catch (error) {
      console.error('[AuthPlugin] Token refresh error:', error)
      return null
    }
  }

  async getCredits(): Promise<Credits | null> {
    try {
      // Ensure token is set
      await this.getToken()

      console.log('[AuthPlugin] Fetching credits using typed API')

      const response = await this.creditsApi.getBalance()

      if (response.ok && response.data) {
        return response.data
      }

      if (response.status === 401) {
        console.warn('[AuthPlugin] Not authenticated for credits')
      } else if (response.error) {
        console.error('[AuthPlugin] Credits API error:', response.error)
      }

      return null
    } catch (error) {
      console.error('[AuthPlugin] Failed to fetch credits:', error)
      return null
    }
  }

  async refreshCredits(): Promise<Credits | null> {
    const credits = await this.getCredits()
    if (credits) {
      this.emit('creditsUpdated', credits)
    }
    return credits
  }

  /**
   * Get all linked accounts using typed API
   */
  async getLinkedAccounts() {
    try {
      await this.getToken() // Ensure token is set
      const response = await this.ssoApi.getAccounts()

      if (response.ok && response.data) {
        return response.data
      }

      if (response.error) {
        console.error('[AuthPlugin] Failed to get linked accounts:', response.error)
      }

      return null
    } catch (error) {
      console.error('[AuthPlugin] Failed to get linked accounts:', error)
      return null
    }
  }

  /**
   * Unlink an account using typed API
   */
  async unlinkAccount(userId: number) {
    try {
      await this.getToken() // Ensure token is set
      const response = await this.ssoApi.unlinkAccount(userId)

      if (response.ok) {
        return response.data
      }

      throw new Error(response.error || 'Failed to unlink account')
    } catch (error) {
      console.error('[AuthPlugin] Failed to unlink account:', error)
      throw error
    }
  }

  onActivation(): void {
    console.log('[AuthPlugin] Activated - using popup + localStorage mode')

    // Check if user is already logged in
    const token = localStorage.getItem('remix_access_token')
    if (token) {
      const userStr = localStorage.getItem('remix_user')
      if (userStr) {
        try {
          const user = JSON.parse(userStr)
          this.emit('authStateChanged', {
            isAuthenticated: true,
            user,
            token
          })
          // Auto-refresh credits
          this.refreshCredits().catch(console.error)
          // Schedule proactive refresh if possible
          this.scheduleRefresh(token)
        } catch (e) {
          console.error('[AuthPlugin] Failed to restore user session:', e)
        }
      }
    }
  }

  // Convert address to EIP-55 checksum format using ethers
  private toChecksumAddress(address: string): string {
    try {
      return getAddress(address)
    } catch (error) {
      throw new Error(`Invalid Ethereum address: ${address}`)
    }
  }

  private async linkSIWEAccount(): Promise<void> {
    try {
      // Check if wallet is available
      if (!(window as any).ethereum) {
        throw new Error('No wallet detected. Please install MetaMask or another Web3 wallet.')
      }

      const ethereum = (window as any).ethereum
      const token = await this.getToken()

      // Request account access
      console.log('[SIWE Link] Requesting wallet accounts...')
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
      if (!accounts || accounts.length === 0) {
        throw new Error('No wallet accounts available')
      }

      const rawAddress = accounts[0].toLowerCase()
      const address = this.toChecksumAddress(rawAddress)
      console.log('[SIWE Link] Using checksummed address:', address)

      // Get chain ID
      const chainId = await ethereum.request({ method: 'eth_chainId' })
      const chainIdNumber = parseInt(chainId, 16)

      // Get nonce
      const nonceResponse = await fetch(`${endpointUrls.sso}/siwe/nonce`, {
        credentials: 'include'
      })

      if (!nonceResponse.ok) {
        throw new Error('Failed to fetch nonce from server')
      }

      const nonce = await nonceResponse.text()

      // Create SIWE message
      const domain = window.location.host
      const origin = window.location.origin
      const statement = 'Link this Ethereum account to your Remix account'

      const message = `${domain} wants you to sign in with your Ethereum account:
${address}

${statement}

URI: ${origin}
Version: 1
Chain ID: ${chainIdNumber}
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`

      // Request signature
      console.log('[SIWE Link] Requesting signature...')
      const signature = await ethereum.request({
        method: 'personal_sign',
        params: [message, address]
      })

      // Verify and get user_id
      console.log('[SIWE Link] Verifying signature...')
      const verifyResponse = await fetch(`${endpointUrls.sso}/siwe/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          signature
        })
      })

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json().catch(() => ({ error: 'Verification failed' }))
        throw new Error(error.error || error.message || 'SIWE verification failed')
      }

      const result = await verifyResponse.json()

      // Link the accounts
      const linkResponse = await fetch(`${endpointUrls.sso}/accounts/link/siwe`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          user_id: result.user.sub
        })
      })

      if (!linkResponse.ok) {
        const error = await linkResponse.json().catch(() => ({ error: 'Failed to link account' }))
        throw new Error(error.error || 'Account linking failed')
      }

      console.log('[SIWE Link] Account linked successfully!')
      this.emit('accountLinked', { provider: 'siwe' })

    } catch (error: any) {
      console.error('[SIWE Link] Failed:', error)
      throw error
    }
  }

  private async loginWithSIWE(): Promise<void> {
    try {
      // Check if wallet is available
      if (!(window as any).ethereum) {
        throw new Error('No wallet detected. Please install MetaMask or another Web3 wallet.')
      }

      const ethereum = (window as any).ethereum

      // Request account access
      console.log('[SIWE] Requesting wallet accounts...')
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' })
      if (!accounts || accounts.length === 0) {
        throw new Error('No wallet accounts available')
      }

      // Convert address to EIP-55 checksum format
      const rawAddress = accounts[0].toLowerCase()
      const address = this.toChecksumAddress(rawAddress)
      console.log('[SIWE] Using checksummed address:', address)

      // Get chain ID
      const chainId = await ethereum.request({ method: 'eth_chainId' })
      const chainIdNumber = parseInt(chainId, 16)
      console.log('[SIWE] Chain ID:', chainIdNumber)

      // Get nonce from backend
      console.log('[SIWE] Fetching nonce from backend...')
      const nonceResponse = await fetch(`${endpointUrls.sso}/siwe/nonce`, {
        credentials: 'include'
      })

      if (!nonceResponse.ok) {
        throw new Error('Failed to fetch nonce from server')
      }

      const nonce = await nonceResponse.text()
      console.log('[SIWE] Got nonce:', nonce.substring(0, 10) + '...')

      // Create SIWE message
      const domain = window.location.host
      const origin = window.location.origin
      const statement = 'Sign in to Remix IDE with your Ethereum account'

      const message = `${domain} wants you to sign in with your Ethereum account:
${address}

${statement}

URI: ${origin}
Version: 1
Chain ID: ${chainIdNumber}
Nonce: ${nonce}
Issued At: ${new Date().toISOString()}`

      console.log('[SIWE] Message to sign:', message)

      // Request signature from wallet
      console.log('[SIWE] Requesting signature from wallet...')
      const signature = await ethereum.request({
        method: 'personal_sign',
        params: [message, address]
      })

      console.log('[SIWE] Got signature:', signature.substring(0, 20) + '...')

      // Send to backend for verification
      console.log('[SIWE] Verifying signature with backend...')
      const verifyResponse = await fetch(`${endpointUrls.sso}/siwe/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message,
          signature
        })
      })

      if (!verifyResponse.ok) {
        const error = await verifyResponse.json().catch(() => ({ error: 'Verification failed' }))
        throw new Error(error.error || error.message || 'SIWE verification failed')
      }

      const result = await verifyResponse.json()
      console.log('[SIWE] Verification successful!')

      // Store tokens and user info
      localStorage.setItem('remix_access_token', result.token)
      if (result.user) {
        localStorage.setItem('remix_user', JSON.stringify(result.user))
      }

      console.log('[SIWE] Login successful!')

      // Emit auth state changed
      this.emit('authStateChanged', {
        isAuthenticated: true,
        user: result.user,
        token: result.token
      })

      // Auto-refresh credits
      this.refreshCredits().catch(console.error)

    } catch (error: any) {
      console.error('[SIWE] Login failed:', error)
      throw error
    }
  }
}
