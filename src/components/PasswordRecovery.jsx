import { useState } from 'react'
import './AdminPortal.css'

const getSupabaseUrl = () => {
  const directUrl = import.meta.env.VITE_SUPABASE_URL
  if (directUrl) return directUrl.replace(/\/+$/, '')
  const fnUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
  if (fnUrl) {
    try {
      const url = new URL(fnUrl)
      return `${url.protocol}//${url.host}`
    } catch {
      return null
    }
  }
  return null
}

export default function PasswordRecovery() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState(null)
  const params = new URLSearchParams(window.location.hash.slice(1))
  const accessToken = params.get('access_token')
  const linkError = params.get('error_description') || params.get('error')
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

  const handleSubmit = async (event) => {
    event.preventDefault()
    setMessage(null)
    if (!accessToken) {
      setMessage({ type: 'error', text: 'This reset link is invalid or expired. Request a fresh link from the admin sign-in page.' })
      return
    }
    if (password.length < 8) {
      setMessage({ type: 'error', text: 'Choose a password with at least 8 characters.' })
      return
    }
    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'The passwords do not match.' })
      return
    }
    const sbUrl = getSupabaseUrl()
    if (!sbUrl || !anonKey.trim()) {
      setMessage({ type: 'error', text: 'Password reset is not configured correctly. Please contact the site administrator.' })
      return
    }

    setLoading(true)
    try {
      const response = await fetch(`${sbUrl}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ password }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage({
          type: 'error',
          text: data?.msg || data?.message || data?.error_description || 'Could not update the password. The reset link may have expired; request a new one.',
        })
        return
      }
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      setMessage({ type: 'success', text: 'Password updated successfully. You can now sign in to the admin portal with your new password.' })
      setPassword('')
      setConfirmPassword('')
    } catch {
      setMessage({ type: 'error', text: 'Could not connect to the authentication service. Please try again.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-viewport">
      <header className="admin-header">
        <div className="admin-brand">
          <span className="admin-badge">Secure Account Recovery</span>
          <span className="admin-title">Orynex Studio</span>
        </div>
        <a href="/#/admin" className="admin-btn admin-btn--secondary">Admin Sign In</a>
      </header>
      <main className="admin-auth-card" style={{ maxWidth: 520, margin: '48px auto' }}>
        <h2>Set a New Password</h2>
        <p>Choose a new password for your administrator account.</p>
        {linkError && !accessToken && (
          <div className="admin-error-banner" role="alert">
            This recovery link is invalid or expired. Request a fresh link from the admin sign-in page.
          </div>
        )}
        {message && (
          <div
            className={message.type === 'error' ? 'admin-error-banner' : 'admin-status-badge admin-status--approved'}
            role="status"
            style={{ padding: 12, marginBottom: 14, whiteSpace: 'normal' }}
          >
            {message.text}
          </div>
        )}
        {accessToken && (
          <form onSubmit={handleSubmit}>
            <div className="admin-field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
            <div className="admin-field">
              <label htmlFor="confirm-new-password">Confirm new password</label>
              <input
                id="confirm-new-password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            <button type="submit" className="admin-btn" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Updating Password...' : 'Update Password'}
            </button>
          </form>
        )}
        <p style={{ marginTop: 18 }}>
          <a href="/#/admin">Return to Admin Sign In</a>
        </p>
      </main>
    </div>
  )
}
