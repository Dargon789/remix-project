import React, { useState, useEffect } from 'react'
import { AuthUser, AuthProvider, LinkedAccount, AccountsResponse } from '@remix-api'
import type { Credits } from '../../../app/src/lib/remix-app/context/auth-context'

interface UserMenuCompactProps {
  user: AuthUser
  credits: Credits | null
  showCredits: boolean
  className?: string
  onLogout: () => void
  onLinkProvider?: (provider: AuthProvider) => void
  onManageAccounts?: () => void
  getProviderDisplayName: (provider: string) => string
  getUserDisplayName: () => string
  getLinkedAccounts?: () => Promise<AccountsResponse | null>
}

const getProviderIcon = (provider: AuthProvider | string) => {
  console.log('getProviderIcon', provider)
  switch (provider) {
  case 'google': return 'fab fa-google'
  case 'github': return 'fab fa-github'
  case 'discord': return 'fab fa-discord'
  case 'siwe': return 'fab fa-ethereum'
  default: return 'fas fa-sign-in-alt'
  }
}

export const UserMenuCompact: React.FC<UserMenuCompactProps> = ({
  user,
  credits,
  showCredits,
  className,
  onLogout,
  onLinkProvider,
  onManageAccounts,
  getProviderDisplayName,
  getUserDisplayName,
  getLinkedAccounts
}) => {
  const [showDropdown, setShowDropdown] = useState(false)

  // All available providers including GitHub
  const allProviders: AuthProvider[] = ['google', 'github', 'discord', 'siwe']

  return (
    <div className={`position-relative ${className}`}>
      <button
        className="btn btn-sm btn-success d-flex flex-nowrap align-items-center"
        onClick={() => setShowDropdown(!showDropdown)}
        data-id="user-menu-compact"
        title={getUserDisplayName()}
      >
        <span>{getUserDisplayName()}</span>
        {user.picture && (
          <img
            src={user.picture}
            alt="Avatar"
            className="ms-1"
            style={{
              width: '25px',
              height: '25px',
              borderRadius: '50%',
              objectFit: 'cover',
            }}
          />
        )}
      </button>
      {showDropdown && (
        <>
          <div
            className="dropdown-menu dropdown-menu-end show"
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              minWidth: '200px',
              zIndex: 2000
            }}
          >
            <div className="dropdown-header">
              {user.picture && (
                <div className="d-flex justify-content-center mb-2">
                  <img
                    src={user.picture}
                    alt="Avatar"
                    style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                    }}
                  />
                </div>
              )}
              <div><strong>{getUserDisplayName()}</strong></div>
            </div>

            {/* Connected Account */}
            {user.provider && (
              <div className="dropdown-item-text small text-muted">
                <i className={`${getProviderIcon(user.provider)} me-2`}></i>
                {getProviderDisplayName(user.provider)}
              </div>
            )}

            {credits && showCredits && (
              <>
                <div className="dropdown-divider"></div>
                <div className="dropdown-item-text small">
                  <div className="d-flex justify-content-between mb-1">
                    <span><i className="fas fa-coins mr-1"></i>Credits:</span>
                    <strong>{credits.balance.toLocaleString()}</strong>
                  </div>
                </div>
              </>
            )}
            <div className="dropdown-divider"></div>

            {/* Manage Accounts */}
            {onManageAccounts && (
              <button
                className="dropdown-item"
                onClick={() => {
                  onManageAccounts()
                  setShowDropdown(false)
                }}
              >
                <i className="fas fa-link mr-2"></i>
                Manage Accounts
              </button>
            )}

            <div className="dropdown-divider"></div>
            <button
              className="dropdown-item text-danger"
              onClick={onLogout}
            >
              <i className="fas fa-sign-out-alt mr-2"></i>
              Sign Out
            </button>
          </div>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 1999
            }}
            onClick={() => setShowDropdown(false)}
          />
        </>
      )}
    </div>
  )
}
