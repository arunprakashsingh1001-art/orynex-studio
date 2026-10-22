import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Globe, partners } from './icons.jsx'
import './Hero.css'

const stats = [
  { value: '150+', label: 'Projects delivered' },
  { value: '98%', label: 'Client satisfaction' },
]

const bars = [34, 52, 44, 70, 88]

export default function Hero({ onOpenContact }) {
  const videoRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Some browsers block autoplay until the element is explicitly nudged.
    const play = video.play()
    if (play?.catch) play.catch(() => {})

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.pause()
      setReady(true)
    }
  }, [])

  return (
    <section className="hero" id="hero">
      <div className="hero__media">
        <video
          ref={videoRef}
          className={`hero__video ${ready ? 'is-ready' : ''}`}
          src="/hero-loop.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          onCanPlay={() => setReady(true)}
        />
        <div className="hero__scrim" aria-hidden="true" />
        <div className="hero__rules" aria-hidden="true">
          <span /><span /><span />
        </div>
      </div>

      <div className="hero__inner">
        <div className="hero__lead" id="features">
          <p className="hero__note" id="support">
            <Globe className="hero__note-icon" />
            <span>Hub support peoples from<br />all over the world</span>
          </p>

          <h1 className="hero__title">
            Technology<br />
            Crafted for All<br />
            Not <em>Machines</em>
          </h1>

          <p className="hero__sub">
            We create clear, intuitive, and accessible digital
            experiences shaped by real human behavior.
          </p>

          <div className="hero__cta">
            <button
              type="button"
              className="btn btn--flame hero__go"
              onClick={onOpenContact}
              aria-haspopup="dialog"
            >
              Get started
              <span className="hero__go-dot" aria-hidden="true"><ArrowRight /></span>
            </button>

            <div className="hero__proof">
              <div className="hero__faces" aria-hidden="true">
                <i style={{ '--a': '#ff7a3d', '--b': '#ffb27a' }} />
                <i style={{ '--a': '#6f4bd8', '--b': '#a98cff' }} />
                <i style={{ '--a': '#1f9ea8', '--b': '#63d6df' }} />
                <i style={{ '--a': '#d8434b', '--b': '#ff8a8f' }} />
              </div>
              <span className="hero__proof-text">
                <strong>650+ Happy Clients</strong>
                Live Support
              </span>
            </div>
          </div>

          <ul className="hero__stats" id="stats">
            {stats.map((stat) => (
              <li key={stat.label} className="stat">
                <span className="stat__mark" aria-hidden="true">*</span>
                <span className="stat__value">{stat.value}</span>
                <span className="stat__label">{stat.label}</span>
                <span className="stat__rule" aria-hidden="true" />
              </li>
            ))}
          </ul>
        </div>

        <aside className="hero__ghost" id="how-it-works" aria-hidden="true">
          <div className="ghost__row">
            <div className="ghost__bars">
              {bars.map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
            <p className="ghost__kpi"><strong>+42%</strong>Experience<br />Performance</p>
          </div>
          <h2 className="ghost__title">Measure Real Impact</h2>
          <p className="ghost__copy">
            We track user response through meaningful metrics and
            refine every detail until the experience feels effortless.
          </p>
        </aside>
      </div>

      <div className="hero__foot" id="about">
        <span className="hero__watermark" aria-hidden="true">AIM</span>
        <div className="hero__partners">
          <span className="hero__partners-label">Our Partners</span>
          <ul>
            {partners.map((partner) => (
              <li key={partner.name}>
                {partner.mark}
                <span>{partner.name}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
