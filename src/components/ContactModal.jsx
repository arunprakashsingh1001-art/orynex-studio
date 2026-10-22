import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Close } from './icons.jsx'
import './ContactModal.css'

export function validateProjectOverview(text) {
  if (typeof text !== 'string') {
    return { valid: false, error: 'Project overview is required.' }
  }
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return { valid: false, error: 'Project overview is required. Please describe your idea in simple words.' }
  }
  if (trimmed.length < 20) {
    return {
      valid: false,
      error: `Project overview is too short (${trimmed.length}/20 min characters). Describe your idea in simple words.`,
    }
  }
  if (trimmed.length > 2000) {
    return { valid: false, error: 'Project overview must not exceed 2,000 characters.' }
  }

  // Check for repetitive meaningless characters / low entropy
  if (!/[a-zA-Z0-9]/.test(trimmed)) {
    return { valid: false, error: 'Project overview must contain descriptive words.' }
  }

  // Consecutive identical character repetitions (e.g., aaaaaaaaaa)
  if (/(.)\1{7,}/i.test(trimmed)) {
    return { valid: false, error: 'Please provide a meaningful project overview rather than repetitive characters.' }
  }

  // Unique character diversity (ignoring whitespace)
  const cleanChars = trimmed.toLowerCase().replace(/\s+/g, '')
  const uniqueChars = new Set(cleanChars).size
  if (uniqueChars < 4) {
    return { valid: false, error: 'Please provide a meaningful project overview describing your idea.' }
  }

  // Repeated 2-4 character chunk pattern (e.g., "asdasdasdasdasd", "abcabcabcabcabc")
  for (let len = 2; len <= 4; len++) {
    const chunk = cleanChars.slice(0, len)
    const repeats = Math.floor(cleanChars.length / len)
    if (chunk.repeat(repeats) === cleanChars.slice(0, repeats * len) && repeats >= 5) {
      return { valid: false, error: 'Please provide a meaningful project overview describing your idea.' }
    }
  }

  return { valid: true, sanitized: trimmed }
}

const SERVICES = [
  'Digital Product Design',
  'Technology Architecture',
  'Custom Engineering',
  'Performance & Optimization',
]

export default function ContactModal({ isOpen, onClose, initialService }) {
  const [status, setStatus] = useState('idle') // 'idle' | 'loading' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState(null)
  const [overviewError, setOverviewError] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    service: initialService || 'Digital Product Design',
    message: '',
    company_website: '', // Anti-spam honeypot
  })

  const modalRef = useRef(null)
  const previousFocusRef = useRef(null)
  const firstInputRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement
      document.body.style.overflow = 'hidden'
      setStatus('idle')
      setErrorMessage(null)
      setOverviewError(null)

      if (initialService) {
        setFormData((prev) => ({ ...prev, service: initialService }))
      }

      // Focus first input on next tick
      setTimeout(() => {
        firstInputRef.current?.focus()
      }, 50)

      const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          onClose()
          return
        }

        // Accessible Tab Focus Trap inside modal
        if (e.key === 'Tab' && modalRef.current) {
          const focusable = modalRef.current.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first.focus()
          }
        }
      }

      window.addEventListener('keydown', handleKeyDown)
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
        document.body.style.overflow = ''
      }
    } else {
      document.body.style.overflow = ''
      if (previousFocusRef.current?.focus) {
        previousFocusRef.current.focus()
      }
    }
  }, [isOpen, onClose, initialService])

  if (!isOpen) return null

  const getEndpointUrl = () => {
    const directUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL
    if (directUrl) return directUrl

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
    if (supabaseUrl) {
      return `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/submit-lead`
    }

    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (status === 'loading') return

    const trimmedName = formData.name.trim()
    const trimmedEmail = formData.email.trim()

    if (!trimmedName || !trimmedEmail) {
      setErrorMessage('Please fill in both your name and email.')
      return
    }

    // Client-side regex check
    const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9]+([.-][A-Za-z0-9]+)*\.[A-Za-z]{2,}$/
    if (!emailPattern.test(trimmedEmail)) {
      setErrorMessage('Please provide a valid work email address.')
      return
    }

    // Project overview validation
    const overviewValidation = validateProjectOverview(formData.message)
    if (!overviewValidation.valid) {
      setOverviewError(overviewValidation.error)
      setErrorMessage(overviewValidation.error)
      return
    }

    setOverviewError(null)
    setStatus('loading')
    setErrorMessage(null)

    const endpoint = getEndpointUrl()

    // If no backend endpoint is configured in env
    if (!endpoint) {
      console.error(
        '[Orynex Studio] Backend endpoint is unconfigured. Set VITE_SUPABASE_FUNCTIONS_URL or VITE_SUPABASE_URL in your environment.'
      )
      setStatus('error')
      setErrorMessage(
        'Inquiry submission is currently unavailable. Please reach out directly or try again later.'
      )
      return
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(import.meta.env.VITE_SUPABASE_ANON_KEY
            ? { Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` }
            : {}),
        },
        body: JSON.stringify({
          name: trimmedName,
          email: trimmedEmail,
          service: formData.service,
          message: overviewValidation.sanitized,
          company_website: formData.company_website || undefined,
        }),
      })

      let data = null
      try {
        data = await response.json()
      } catch {
        // Non-JSON response
      }

      if (response.ok && data?.success) {
        setStatus('success')
      } else {
        setStatus('error')
        setErrorMessage(
          data?.message || 'Unable to submit your inquiry at this moment. Please try again shortly.'
        )
      }
    } catch (err) {
      console.error('[ContactModal] Submission error:', err)
      setStatus('error')
      setErrorMessage('Network connection error. Please verify your connection and try again.')
    }
  }

  const handleBackdropClick = (e) => {
    if (modalRef.current && !modalRef.current.contains(e.target)) {
      onClose()
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        className="modal-card"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-modal-title"
      >
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close modal"
        >
          <Close />
        </button>

        {status !== 'success' ? (
          <>
            <div className="modal-header">
              <span className="modal-badge">Orynex Studio</span>
              <h2 id="contact-modal-title" className="modal-title">
                Start Your Project
              </h2>
              <p className="modal-subtitle">
                Partner with us to create intuitive, human-centered digital
                experiences.
              </p>
            </div>

            {errorMessage && (
              <div className="modal-error-banner" role="alert">
                <span className="modal-error-dot" aria-hidden="true" />
                <span>{errorMessage}</span>
              </div>
            )}

            <form className="modal-form" onSubmit={handleSubmit} noValidate>
              {/* Anti-spam Honeypot Field (hidden from genuine users) */}
              <div className="modal-honeypot" aria-hidden="true">
                <label htmlFor="contact-company-website">Leave blank</label>
                <input
                  id="contact-company-website"
                  type="text"
                  name="company_website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={formData.company_website}
                  onChange={(e) =>
                    setFormData({ ...formData, company_website: e.target.value })
                  }
                />
              </div>

              <div className="modal-field">
                <label htmlFor="contact-name">Full Name *</label>
                <input
                  id="contact-name"
                  ref={firstInputRef}
                  type="text"
                  required
                  maxLength={100}
                  disabled={status === 'loading'}
                  placeholder="e.g. Alex Morgan"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                />
              </div>

              <div className="modal-field">
                <label htmlFor="contact-email">Work Email *</label>
                <input
                  id="contact-email"
                  type="email"
                  required
                  maxLength={255}
                  disabled={status === 'loading'}
                  placeholder="alex@company.com"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                />
              </div>

              <div className="modal-field">
                <label id="service-focus-label" htmlFor="contact-service">Service Focus</label>
                <div
                  className="modal-service-pills"
                  role="radiogroup"
                  aria-labelledby="service-focus-label"
                >
                  {SERVICES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={formData.service === s}
                      className={`modal-service-pill ${formData.service === s ? 'is-selected' : ''}`}
                      onClick={() => setFormData({ ...formData, service: s })}
                      disabled={status === 'loading'}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <select
                  id="contact-service"
                  disabled={status === 'loading'}
                  value={formData.service}
                  aria-label="Service focus select dropdown"
                  onChange={(e) =>
                    setFormData({ ...formData, service: e.target.value })
                  }
                >
                  {SERVICES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div className="modal-field">
                <div className="modal-field-header">
                  <label htmlFor="contact-message">Project Overview *</label>
                  <span
                    className={`modal-char-counter ${
                      formData.message.length >= 1900
                        ? 'is-warn'
                        : formData.message.length >= 20
                          ? 'is-good'
                          : ''
                    }`}
                    aria-live="polite"
                  >
                    {formData.message.length} / 2000
                  </span>
                </div>
                <div className="modal-char-meter" aria-hidden="true">
                  <div
                    className={`modal-char-fill ${formData.message.length >= 20 ? 'is-good' : 'is-short'}`}
                    style={{ width: `${Math.min(100, (formData.message.length / 20) * 100)}%` }}
                  />
                </div>
                <p id="contact-message-helper" className="modal-helper-text">
                  {formData.message.length === 0
                    ? 'Describe your project idea, goals, or systems to integrate in simple words (minimum 20 characters).'
                    : formData.message.length < 20
                      ? `${20 - formData.message.length} more meaningful character${20 - formData.message.length === 1 ? '' : 's'} needed for proposal generation.`
                      : formData.message.length >= 1900
                        ? `Approaching 2,000 character maximum limit (${2000 - formData.message.length} characters left).`
                        : '✓ Minimum length satisfied. Feel free to add any specific constraints or timelines.'}
                </p>
                <textarea
                  id="contact-message"
                  rows={3}
                  required
                  minLength={20}
                  maxLength={2000}
                  disabled={status === 'loading'}
                  placeholder="Example: I need a modern business website where customers can explore my services and contact me easily."
                  value={formData.message}
                  onChange={(e) => {
                    setFormData({ ...formData, message: e.target.value })
                    if (overviewError) setOverviewError(null)
                  }}
                  aria-describedby={`contact-message-helper${overviewError ? ' contact-message-error' : ''}`}
                  aria-invalid={overviewError ? 'true' : 'false'}
                  className={overviewError ? 'modal-input--error' : ''}
                />
                {overviewError && (
                  <div id="contact-message-error" className="modal-inline-error" role="alert">
                    {overviewError}
                  </div>
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="btn btn--flame modal-submit-btn"
                >
                  <span>{status === 'loading' ? 'Sending Inquiry...' : 'Send Inquiry'}</span>
                  <span className="hero__go-dot" aria-hidden="true">
                    {status === 'loading' ? (
                      <span className="modal-spinner" />
                    ) : (
                      <ArrowRight />
                    )}
                  </span>
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="modal-success">
            <div className="modal-success-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" stroke="var(--flame-lit)" strokeWidth="1.5" />
                <path d="m8 12 3 3 5-6" stroke="#fff" />
              </svg>
            </div>
            <h3 className="modal-success-title">Inquiry Received</h3>
            <p className="modal-success-text">
              Thank you, <strong>{formData.name}</strong>. The Orynex Studio team
              has received your inquiry and will reach out to{' '}
              <strong>{formData.email}</strong> within 24 hours.
            </p>
            <button
              type="button"
              className="btn btn--light modal-success-close"
              onClick={onClose}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
