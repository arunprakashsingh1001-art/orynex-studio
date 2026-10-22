// ==============================================================================
// Orynex Studio — Admin Review & Approval Portal
// Security: Authenticates via Supabase Auth & verifies role via admin-workflow
// Authorized Administrator: arunprakashsingh1001@gmail.com
// ==============================================================================

import { useState, useEffect, useCallback } from 'react'
import './AdminPortal.css'

const AUTHORIZED_ADMIN_EMAIL = 'arunprakashsingh1001@gmail.com'

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
  const [credentials, setCredentials] = useState({ email: AUTHORIZED_ADMIN_EMAIL, password: '' })

  const [jobs, setJobs] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [filterStatus, setFilterStatus] = useState('all')
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState(null)

  // Active view tab in detail panel: 'proposal' | 'revisions' | 'decisions' | 'delivery'
  const [activeTab, setActiveTab] = useState('proposal')

  // Draft editor state
  const [draftJsonText, setDraftJsonText] = useState('')
  const [reviewNotes, setReviewNotes] = useState('')

  // Revision feedback state
  const [showRevisionModal, setShowRevisionModal] = useState(false)
  const [revisionFeedback, setRevisionFeedback] = useState('')

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
        setCredentials({ email: AUTHORIZED_ADMIN_EMAIL, password: '' })
      } else {
        setAuthError(data?.error_description || data?.msg || data?.message || 'Authentication failed. Please verify credentials.')
      }
    } catch (err) {
      setAuthError(`Connection error: ${err.message}`)
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

  const selectJob = useCallback(async (job) => {
    setSelectedJob(job)
    const activeDraft = job.edited_draft || job.generated_draft || {}
    setDraftJsonText(JSON.stringify(activeDraft, null, 2))
    setReviewNotes(job.review_notes || '')
    setActionMessage(null)
    setShowRevisionModal(false)
    setRevisionFeedback('')

    // Fetch full job with history and decisions
    const endpoint = getAdminEndpoint()
    if (endpoint && token) {
      try {
        const res = await fetch(`${endpoint}?action=get_job&job_id=${job.id}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(import.meta.env.VITE_SUPABASE_ANON_KEY ? { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY } : {}),
          },
        })
        const data = await res.json()
        if (res.ok && data?.job) {
          setSelectedJob(data.job)
          const draft = data.job.edited_draft || data.job.generated_draft || {}
          setDraftJsonText(JSON.stringify(draft, null, 2))
        }
      } catch (err) {
        console.warn('Failed to fetch detailed job history:', err)
      }
    }
  }, [token])

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
        setAuthError(data?.message || 'Forbidden: Your account is not authorized as an Orynex Studio administrator.')
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
      setActionMessage({ type: 'error', text: `Fetch error: ${err.message}` })
    } finally {
      setLoadingJobs(false)
    }
  }, [token, filterStatus, selectedJob, selectJob])

  useEffect(() => {
    if (token) {
      fetchJobs()
    }
  }, [token, filterStatus, fetchJobs])

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

    if (actionType === 'request_revision') {
      if (!revisionFeedback || revisionFeedback.trim().length < 5) {
        setActionMessage({ type: 'error', text: 'Mandatory revision feedback is required (minimum 5 characters).' })
        setActionLoading(false)
        return
      }
      payload.feedback = revisionFeedback.trim()
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
        setShowRevisionModal(false)
        setRevisionFeedback('')
        // Refresh job list and active selection
        await fetchJobs()
        selectJob({ ...selectedJob, id: selectedJob.id })
      } else {
        setActionMessage({ type: 'error', text: data?.message || data?.error || 'Action failed' })
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: `Action error: ${err.message}` })
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
          <p>
            Restricted to verified administrator: <strong>{AUTHORIZED_ADMIN_EMAIL}</strong>.
            Sign in with your verified Supabase Admin credentials to review, revise, and approve client deliverables.
          </p>

          {authError && (
            <div className="admin-error-banner" role="alert">
              {authError}
            </div>
          )}

          <form onSubmit={handleSignIn}>
            <div className="admin-field">
              <label htmlFor="admin-email">Admin Email (Allowlisted)</label>
              <input
                id="admin-email"
                type="email"
                required
                placeholder={AUTHORIZED_ADMIN_EMAIL}
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
              {authLoading ? 'Verifying Authorization...' : 'Sign In to Admin Portal'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  const activeDraftObj = selectedJob?.edited_draft || selectedJob?.generated_draft || {}
  const revisionsList = selectedJob?.revisions || []
  const decisionsList = selectedJob?.decisions || []
  const deliveryLogsList = selectedJob?.delivery_logs || []

  return (
    <div className="admin-viewport">
      <header className="admin-header">
        <div className="admin-brand">
          <span className="admin-badge">Admin Review Portal</span>
          <span className="admin-title">Service Workflow Pipeline</span>
        </div>

        <div className="admin-auth-info">
          <span>
            Logged in as <strong>{currentUser?.email || AUTHORIZED_ADMIN_EMAIL}</strong>
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
              <div style={{ fontSize: 11, color: 'var(--ink-faint)', display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span>Rev {job.revision_count || 1}</span>
                <span>{new Date(job.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          ))}
        </aside>

        {/* Detail & Review Panel */}
        <main className="admin-detail-panel">
          {selectedJob ? (
            <>
              {/* Client Brief & Metadata Header */}
              <div className="admin-detail-section">
                <h3>Client Brief & Pipeline State</h3>
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
                    <span style={{ color: 'var(--ink-faint)' }}>Revision:</span>{' '}
                    <strong>Revision {selectedJob.revision_count || 1} of {selectedJob.max_revisions || 5}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-faint)' }}>Pipeline Status:</span>{' '}
                    <span className={`admin-status-badge admin-status--${selectedJob.status}`}>
                      {selectedJob.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--ink-faint)' }}>Delivery:</span>{' '}
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

              {/* Navigation Tabs */}
              <div className="admin-tabs">
                <button
                  type="button"
                  className={`admin-tab ${activeTab === 'proposal' ? 'admin-tab--active' : ''}`}
                  onClick={() => setActiveTab('proposal')}
                >
                  Active Proposal (Rev {selectedJob.revision_count || 1})
                </button>
                <button
                  type="button"
                  className={`admin-tab ${activeTab === 'revisions' ? 'admin-tab--active' : ''}`}
                  onClick={() => setActiveTab('revisions')}
                >
                  Revision History ({revisionsList.length})
                </button>
                <button
                  type="button"
                  className={`admin-tab ${activeTab === 'decisions' ? 'admin-tab--active' : ''}`}
                  onClick={() => setActiveTab('decisions')}
                >
                  Review Audit Log ({decisionsList.length})
                </button>
                <button
                  type="button"
                  className={`admin-tab ${activeTab === 'delivery' ? 'admin-tab--active' : ''}`}
                  onClick={() => setActiveTab('delivery')}
                >
                  Delivery Outbox ({deliveryLogsList.length})
                </button>
              </div>

              {/* Tab 1: Active Proposal & Editable JSON */}
              {activeTab === 'proposal' && (
                <div className="admin-detail-section">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>Proposal Deliverable Specification</h3>
                    <span style={{ fontSize: 12, color: 'var(--flame-lit)' }}>
                      Model: {selectedJob.model || 'gemini-3.8-flash'}
                    </span>
                  </div>

                  {activeDraftObj.needs_clarification && (
                    <div style={{ background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', padding: 12, borderRadius: 6, marginBottom: 14 }}>
                      <strong style={{ color: '#fde047' }}>Notice: Requires Client Clarification</strong>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#fef08a' }}>
                        The AI determined that the customer brief is underspecified. Scoping questions have been generated instead of fabricating requirements.
                      </p>
                    </div>
                  )}

                  <div className="admin-field">
                    <label htmlFor="draft-editor">Editable Structured JSON Deliverable:</label>
                    <textarea
                      id="draft-editor"
                      className="admin-json-viewer"
                      rows={14}
                      value={draftJsonText}
                      onChange={(e) => setDraftJsonText(e.target.value)}
                    />
                  </div>

                  <div className="admin-field" style={{ marginTop: 12 }}>
                    <label htmlFor="review-notes">Admin Review Notes / Audit Memo:</label>
                    <input
                      id="review-notes"
                      type="text"
                      placeholder="e.g. Verified architecture plan; refined component specifications."
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Tab 2: Revision History */}
              {activeTab === 'revisions' && (
                <div className="admin-detail-section">
                  <h3>All Proposal Revisions ({revisionsList.length})</h3>
                  {revisionsList.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
                      No archived revisions recorded yet for this job.
                    </p>
                  ) : (
                    revisionsList.map((rev) => (
                      <div key={rev.id || rev.revision_number} className="admin-history-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <strong style={{ color: 'var(--flame-lit)' }}>Revision {rev.revision_number}</strong>
                          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                            {new Date(rev.created_at).toLocaleString()} &bull; {rev.model} ({rev.complexity})
                          </span>
                        </div>
                        {rev.refined_instructions && (
                          <p style={{ fontSize: 12, color: '#93c5fd', margin: '4px 0 8px' }}>
                            <strong>Admin Directives:</strong> {rev.refined_instructions}
                          </p>
                        )}
                        {rev.critique_notes && (
                          <p style={{ fontSize: 12, color: '#86efac', margin: '4px 0 8px' }}>
                            <strong>Critique Notes:</strong> {rev.critique_notes}
                          </p>
                        )}
                        <pre className="admin-json-viewer" style={{ maxHeight: 150, margin: '6px 0 0' }}>
                          <code>{JSON.stringify(rev.draft, null, 2)}</code>
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 3: Review Audit Decisions */}
              {activeTab === 'decisions' && (
                <div className="admin-detail-section">
                  <h3>Administrator Decision History ({decisionsList.length})</h3>
                  {decisionsList.length === 0 ? (
                    <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No review decisions logged yet.</p>
                  ) : (
                    decisionsList.map((dec) => (
                      <div key={dec.id} className="admin-history-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span className={`admin-status-badge admin-status--${dec.action === 'approve' ? 'approved' : 'queued'}`}>
                            {dec.action.toUpperCase()}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                            {new Date(dec.created_at).toLocaleString()} by {dec.reviewed_by_email}
                          </span>
                        </div>
                        <p style={{ fontSize: 13, margin: '6px 0 0', color: 'var(--ink-soft)' }}>
                          <strong>Notes/Feedback:</strong> {dec.feedback || 'No remarks entered'}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 4: Delivery Outbox & Safe Retries */}
              {activeTab === 'delivery' && (
                <div className="admin-detail-section">
                  <h3>Client Delivery Outbox Status</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, fontSize: 13, marginBottom: 16 }}>
                    <div>
                      <span style={{ color: 'var(--ink-faint)' }}>Delivery Status:</span>{' '}
                      <strong>{selectedJob.delivery_status}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink-faint)' }}>Resend ID:</span>{' '}
                      <code>{selectedJob.delivery_resend_id || 'None'}</code>
                    </div>
                    <div>
                      <span style={{ color: 'var(--ink-faint)' }}>Attempts:</span>{' '}
                      <strong>{selectedJob.delivery_attempts || 0}</strong>
                    </div>
                  </div>

                  {selectedJob.delivery_error && (
                    <div className="admin-error-banner" style={{ margin: '0 0 16px' }}>
                      <strong>Delivery Notice:</strong> {selectedJob.delivery_error}
                    </div>
                  )}

                  {selectedJob.delivery_status === 'failed' && (
                    <div style={{ marginBottom: 16 }}>
                      <button
                        type="button"
                        className="admin-btn"
                        onClick={() => handleAdminAction('retry_delivery')}
                        disabled={actionLoading}
                      >
                        {actionLoading ? 'Retrying Dispatch...' : 'Retry Client Email Delivery'}
                      </button>
                    </div>
                  )}

                  <h4 style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ink-faint)', marginTop: 16 }}>
                    Delivery Dispatches Log ({deliveryLogsList.length})
                  </h4>
                  {deliveryLogsList.length === 0 ? (
                    <p style={{ fontSize: 12, color: 'var(--ink-soft)' }}>No dispatches recorded.</p>
                  ) : (
                    deliveryLogsList.map((log) => (
                      <div key={log.id} className="admin-history-item">
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span className={`admin-status-badge admin-status--${log.status === 'success' ? 'approved' : 'failed'}`}>
                            {log.status.toUpperCase()}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          Recipient: <strong>{log.recipient}</strong> {log.resend_id && `(ID: ${log.resend_id})`}
                        </div>
                        {log.error && <p style={{ fontSize: 12, color: '#fca5a5', margin: '4px 0 0' }}>{log.error}</p>}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Revision Feedback Input Section */}
              {showRevisionModal && (
                <div className="admin-feedback-box">
                  <h4 style={{ margin: '0 0 8px', color: 'var(--flame-lit)', fontSize: 13, textTransform: 'uppercase' }}>
                    Request AI Revision (Revision {(selectedJob.revision_count || 1) + 1} of {selectedJob.max_revisions || 5})
                  </h4>
                  <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-soft)' }}>
                    Provide mandatory instructions specifying architectural changes, omissions, or refinements. The AI worker will build a refined prompt incorporating this feedback.
                  </p>
                  <textarea
                    rows={4}
                    className="admin-json-viewer"
                    style={{ width: '100%', marginBottom: 10 }}
                    placeholder="Enter concrete revision directives (minimum 5 characters)..."
                    value={revisionFeedback}
                    onChange={(e) => setRevisionFeedback(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button
                      type="button"
                      className="admin-btn"
                      onClick={() => handleAdminAction('request_revision')}
                      disabled={actionLoading || revisionFeedback.trim().length < 5}
                    >
                      {actionLoading ? 'Enqueuing Revision...' : 'Submit Revision Request'}
                    </button>
                    <button
                      type="button"
                      className="admin-btn admin-btn--secondary"
                      onClick={() => setShowRevisionModal(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Action Controls Bar */}
              <div className="admin-actions-bar">
                <button
                  type="button"
                  className="admin-btn"
                  onClick={() => handleAdminAction('approve_and_deliver')}
                  disabled={actionLoading || selectedJob.status !== 'review_pending' || selectedJob.delivery_status === 'sent'}
                >
                  {selectedJob.delivery_status === 'sent'
                    ? 'Delivered to Client'
                    : selectedJob.status !== 'review_pending'
                    ? `Cannot Approve (${selectedJob.status.replace('_', ' ')})`
                    : `Approve Rev ${selectedJob.revision_count || 1} & Deliver`}
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
                  onClick={() => setShowRevisionModal(!showRevisionModal)}
                  disabled={actionLoading || (selectedJob.revision_count || 1) >= (selectedJob.max_revisions || 5)}
                >
                  {(selectedJob.revision_count || 1) >= (selectedJob.max_revisions || 5)
                    ? 'Max Revisions Reached'
                    : 'Request AI Revision'}
                </button>

                {selectedJob.delivery_status === 'failed' && (
                  <button
                    type="button"
                    className="admin-btn admin-btn--secondary"
                    onClick={() => handleAdminAction('retry_delivery')}
                    disabled={actionLoading}
                  >
                    Retry Delivery
                  </button>
                )}

                <button
                  type="button"
                  className="admin-btn admin-btn--danger"
                  onClick={() => handleAdminAction('reject_job')}
                  disabled={actionLoading || selectedJob.status === 'rejected'}
                >
                  Reject Request Permanently
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
