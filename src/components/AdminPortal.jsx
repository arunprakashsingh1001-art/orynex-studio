// ==============================================================================
// Orynex Studio — Admin Review & Approval Portal
// Security: Authenticates via Supabase Auth & verifies role via admin-workflow
// ==============================================================================

import { useState, useEffect, useCallback } from 'react'
import './AdminPortal.css'

export default function AdminPortal() {
  const [token, setToken] = useState(() => localStorage.getItem('orynex_admin_token') || '')
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('orynex_admin_user') || 'null')
    } catch {
      return null
    }
  })

  const [authError, setAuthError] = useState(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [credentials, setCredentials] = useState({ email: '', password: '' })

  const [jobs, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState(null)

  // Draft editor state
  const [draftJsonText, setDraftJsonText] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')

  const getAdminEndpoint = () => {
    const fnUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
    if (fnUrl) {
      return fnUrl.replace(/\/submit-lead\/?$/, '/admin-workflow')
    }
    const baseUrl = import.meta.env.VITE_SUPABASE_URL
    if (baseUrl) {
      return `${baseUrl.replace(/\/+$/, '')}/functions/v1/admin-workflow`
    }
    return null
  }

  const getSupabaseUrl = () => {
    const directUrl = import.meta.env.VITE_SUPABASE_URL
    if (directUrl) return directUrl.replace(/\/+$/, '')
    const fnUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
    if (fnUrl) {
      try {
        const u = new URL(fnUrl)
        return `${u.protocol}//${u.host}`
      } catch {
        return null
      }
    }
    return null
  }

  const handleSignIn = async (e) => {
    e.preventDefault()
    setAuthLoading(true)
    setAuthError(null)

    const sbUrl = getSupabaseUrl()
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

    if (!sbUrl) {
      setAuthError('Supabase URL is unconfigured in VITE_SUPABASE_URL or VITE_SUPABASE_FUNCTIONS_URL.')
      setAuthLoading(false)
      return
    }

    try {
      const response = await fetch(`${sbUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(anonKey ? { apikey: anonKey } : {}),
        },
        body: JSON.stringify({
          email: credentials.email.trim(),
          password: credentials.password,
        }),
      })

      const data = await response.json()

      if (response.ok && data?.access_token) {
        setToken(data.access_token)
        setCurrentUser(data.user)
        localStorage.setItem('orynex_admin_token', data.access_token)
        localStorage.setItem('orynex_admin_user', JSON.stringify(data.user))
        setCredentials({ email: '', password: '' })
      } else {
        setAuthError(data?.error_description || data?.msg || data?.message || 'Authentication failed. Please verify credentials.')
      }
    } catch (err) {
      setAuthError(`Connection error: ${(err).message}`)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleSignOut = () => {
    setToken('')
    setCurrentUser(null)
    setJobs([])
    setSelectedJob(null)
    localStorage.removeItem('orynex_admin_token')
    localStorage.removeItem('orynex_admin_user')
  }

  const fetchJobs = useCallback(async () => {
    if (!token) return
    setLoadingJobs(true)
    setActionMessage(null)

    const endpoint = getAdminEndpoint()
    if (!endpoint) {
      setAuthError('admin-workflow endpoint is not configured.')
      setLoadingJobs(false)
      return
    }

    try {
      const url = filterStatus !== 'all' ? `${endpoint}?action=list_jobs&status=${filterStatus}` : `${endpoint}?action=list_jobs`
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(import.meta.env.VITE_SUPABASE_ANON_KEY ? { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } : {}),
        },
      })

      const data = await res.json()

      if (res.status === 401) {
        handleSignOut()
        setAuthError('Session expired. Please sign in again.')
        return
      }

      if (res.status === 403) {
        setAuthError(data?.message || 'Forbidden: User is not authorized in admin_users table.')
        return
      }

      if (res.ok && data?.jobs) {
        setJobs(data.jobs)
        if (data.jobs.length > 0 && !selectedJob) {
          selectJob(data.jobs[0])
        }
      } else {
        setActionMessage({ type: 'error', text: data?.message || 'Failed to fetch jobs' })
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: `Fetch error: ${(err).message}` })
    } finally {
      setLoadingJobs(false)
    }
  }, [token, filterStatus, selectedJob])

  useEffect(() => {
    if (token) {
      fetchJobs()
    }
  }, [token, filterStatus, fetchJobs])

  const selectJob = (job) => {
    setSelectedJob(job)
    const activeDraft = job.edited_draft || job.generated_draft || {}
    setDraftJsonText(JSON.stringify(activeDraft, null, 2))
    setReviewNotes(job.review_notes || '')
    setActionMessage(null)
  }

  const handleAdminAction = async (actionType) => {
    if (!selectedJob || !token) return
    setActionLoading(true)
    setActionMessage(null)

    const endpoint = getAdminEndpoint()
    let payload = {
      action: actionType,
      job_id: selectedJob.id,
      review_notes: reviewNotes,
    }

    if (actionType === 'edit_draft') {
      try {
        const parsedDraft = JSON.parse(draftJsonText)
        payload.edited_draft = parsedDraft
      } catch {
        setActionMessage({ type: 'error', text: 'Invalid JSON format in draft editor' })
        setActionLoading(false)
        return
      }
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(import.meta.env.VITE_SUPABASE_ANON_KEY ? { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } : {}),
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json()

      if (res.ok && data?.success) {
        setActionMessage({ type: 'success', text: data.message })
        // Refresh job list
        fetchJobs()
      } else {
        setActionMessage({ type: 'error', text: data?.message || data?.error || 'Action failed' })
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: `Action error: ${(err).message}` })
    } finally {
      setActionLoading(false)
    }
  }

  // Render Login Card if unauthenticated
  if (!token) {
    return (
      <div className="admin-viewport">
        <header className="admin-header">
          <div className="admin-brand">
            <span className="admin-badge">Admin Review Portal</span>
            <span className="admin-title">Orynex Studio</span>
          </div>
          <a href="/" className="admin-btn admin-btn--secondary">
            &larr; Return to Public Site
          </a>
        </header>

        <div className="admin-auth-card">
          <h2>Administrator Sign In</h2>
          <p>Sign in with your verified Supabase Admin credentials to review and approve client deliverables.</p>

          {authError && (
            <div className="admin-error-banner" role="alert">
              {authError}
            </div>
          )}

          <form onSubmit={handleSignIn}>
            <div className="admin-field">
              <label htmlFor="admin-email">Admin Email</label>
              <input
                id="admin-email"
                type="email"
                required
                placeholder="admin@orynex.studio"
                value={credentials.email}
                onChange={(e) => setCredentials({ ...credentials, email: e.target.value })}
              />
            </div>

            <div className="admin-field">
              <label htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                type="password"
                required
                placeholder="••••••••••••"
                value={credentials.password}
                onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
              />
            </div>

            <button type="submit" className="admin-btn" style={{ width: '100%', marginTop: '8px' }} disabled={authLoading}>
              {authLoading ? 'Verifying...' : 'Sign In to Portal'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-viewport">
      <header className="admin-header">
        <div className="admin-brand">
          <span className="admin-badge">Admin Review Portal</span>
          <span className="admin-title">Service Workflow Pipeline</span>
        </div>

        <div className="admin-auth-info">
          <span>
            Logged in as <strong>{currentUser?.email || 'Administrator'}</strong>
          </span>
          <button type="button" className="admin-btn admin-btn--secondary" onClick={handleSignOut}>
            Sign Out
          </button>
          <a href="/" className="admin-btn admin-btn--secondary">
            Public Site
          </a>
        </div>
      </header>

      {authError && (
        <div className="admin-error-banner" style={{ maxWidth: 1400, margin: '0 auto 16px' }}>
          <strong>Access Notice:</strong> {authError}
        </div>
      )}

      {actionMessage && (
        <div
          className={actionMessage.type === 'error' ? 'admin-error-banner' : 'admin-status-badge admin-status--approved'}
          style={{ maxWidth: 1400, margin: '0 auto 16px', padding: '12px' }}
        >
          {actionMessage.text}
        </div>
      )}

      <div className="admin-layout">
        {/* Sidebar Job List */}
        <aside className="admin-sidebar">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--ink-faint)' }}>
              Inbound Queue ({jobs.length})
            </h3>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              style={{ background: '#000', color: '#fff', border: '1px solid var(--hair)', borderRadius: 4, padding: '2px 6px', fontSize: 11 }}
            >
              <option value="all">All Statuses</option>
              <option value="review_pending">Review Pending</option>
              <option value="queued">Queued</option>
              <option value="processing">Processing</option>
              <option value="approved">Approved</option>
              <option value="delivered">Delivered</option>
              <option value="rejected">Rejected</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          {loadingJobs && <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Loading queue...</p>}

          {jobs.length === 0 && !loadingJobs && (
            <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No jobs found matching filter.</p>
          )}

          {jobs.map((job) => (
            <div
              key={job.id}
              className={`admin-job-item ${selectedJob?.id === job.id ? 'admin-job-item--active' : ''}`}
              onClick={() => selectJob(job)}
              role="button"
              tabIndex={0}
            >
              <div className="admin-job-header">
                <span className="admin-job-service">{job.service}</span>
                <span className={`admin-status-badge admin-status--${job.status}`}>
                  {job.status.replace('_', ' ')}
                </span>
              </div>
              <div className="admin-job-client">
                {job.leads?.name || 'Inquiry'} &bull; {job.leads?.email}
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                {new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &bull; Model: {job.model || 'gemini-3.8-flash'}
              </div>
            </div>
          ))}
        </aside>

        {/* Detail & Review Panel */}
        <main className="admin-detail-panel">
          {selectedJob ? (
            <>
              {/* Section 1: Client Brief */}
              <div className="admin-detail-section">
                <h3>Client Brief & Metadata</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 13 }}>
                  <div>
                    <span style={{ color: 'var(--ink-faint)' }}>Client:</span>{' '}
                    <strong>{selectedJob.leads?.name}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-faint)' }}>Email:</span>{' '}
                    <a href={`mailto:${selectedJob.leads?.email}`} style={{ color: 'var(--flame-lit)' }}>
                      {selectedJob.leads?.email}
                    </a>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-faint)' }}>Service:</span>{' '}
                    <strong>{selectedJob.service}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-faint)' }}>Delivery Status:</span>{' '}
                    <strong>{selectedJob.delivery_status}</strong>
                  </div>
                </div>

                <div style={{ marginTop: 14 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-faint)', textTransform: 'uppercase' }}>
                    Project Overview Submitted:
                  </span>
                  <p style={{ marginTop: 6, fontSize: 14, color: 'var(--ink-soft)', background: 'rgba(0,0,0,0.2)', padding: 10, borderRadius: 6 }}>
                    {selectedJob.leads?.project_overview || 'No additional overview provided by client.'}
                  </p>
                </div>
              </div>

              {/* Section 2: AI Draft Inspection & Edit */}
              <div className="admin-detail-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>Generated Draft Deliverable (JSON)</h3>
                  <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                    {selectedJob.status === 'review_pending' ? 'Ready for Admin Approval' : `Status: ${selectedJob.status}`}
                  </span>
                </div>

                <div className="admin-field">
                  <label htmlFor="draft-editor">Editable Structured Output (Valid JSON Required):</label>
                  <textarea
                    id="draft-editor"
                    className="admin-json-viewer"
                    rows={14}
                    value={draftJsonText}
                    onChange={(e) => setDraftJsonText(e.target.value)}
                  />
                </div>

                <div className="admin-field" style={{ marginTop: 12 }}>
                  <label htmlFor="review-notes">Admin Review Notes / Audit Log:</label>
                  <input
                    id="review-notes"
                    type="text"
                    placeholder="e.g., Reviewed system requirements; refined technology choices."
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* Section 3: Action Controls */}
              <div className="admin-actions-bar">
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => handleAdminAction('approve_and_deliver')}
                  disabled={actionLoading || selectedJob.delivery_status === 'sent'}
                >
                  {selectedJob.delivery_status === 'sent' ? 'Delivered to Client' : 'Approve & Deliver to Client'}
                </button>

                <button
                  type="button"
                  className="admin-btn admin-btn--secondary"
                  onClick={() => handleAdminAction('edit_draft')}
                  disabled={actionLoading}
                >
                  Save Draft Edits
                </button>

                <button
                  type="button"
                  className="admin-btn admin-btn--secondary"
                  onClick={() => handleAdminAction('regenerate_job')}
                  disabled={actionLoading}
                >
                  Regenerate Draft
                </button>

                <button
                  type="button"
                  className="admin-btn admin-btn--danger"
                  onClick={() => handleAdminAction('reject_job')}
                  disabled={actionLoading || selectedJob.status === 'rejected'}
                >
                  Reject Job
                </button>
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--ink-soft)' }}>
              Select a job from the queue to inspect the client brief and review the AI-generated proposal.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
