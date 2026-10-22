import { useEffect, useRef, useState } from 'react'
import { Chevron, Close, Logo, Menu } from './icons.jsx'
import './Navbar.css'

const navLinks = [
  { label: 'Features', href: '#features', hasMenu: true },
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'About', href: '#about' },
]

export default function Navbar({ onOpenContact }) {
  const [open, setOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const dropdownRef = useRef(null)

  // Mobile menu body scroll lock & Escape listener
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (open) setOpen(false)
        if (menuOpen) setMenuOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, menuOpen])

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [menuOpen])

  const scrollToSection = (href) => {
    const el = document.querySelector(href)
    if (el) {
      if (window.getComputedStyle(el).display === 'none' && href === '#how-it-works') {
        document.querySelector('#stats')?.scrollIntoView({ behavior: 'smooth' })
      } else {
        el.scrollIntoView({ behavior: 'smooth' })
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const handleLinkClick = (e, href) => {
    e.preventDefault()
    setOpen(false)
    setMenuOpen(false)
    scrollToSection(href)
  }

  return (
    <header className="nav">
      <a
        className="nav__brand"
        href="#hero"
        onClick={(e) => {
          e.preventDefault()
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      >
        <Logo className="nav__logo" />
        <span>Orynex Studio</span>
      </a>

      <nav className="nav__pill" aria-label="Primary">
        <ul>
          {navLinks.map((link) => (
            <li
              key={link.label}
              className={link.hasMenu ? 'nav__item--menu' : ''}
              ref={link.hasMenu ? dropdownRef : null}
            >
              {link.hasMenu ? (
                <>
                  <button
                    type="button"
                    className="nav__link nav__link--btn"
                    aria-expanded={menuOpen}
                    aria-haspopup="true"
                    onClick={() => setMenuOpen((v) => !v)}
                  >
                    {link.label}
                    <Chevron className={`nav__chev ${menuOpen ? 'is-open' : ''}`} />
                  </button>
                  {menuOpen && (
                    <div className="nav__dropdown" role="menu">
                      <a
                        href="#features"
                        role="menuitem"
                        onClick={(e) => handleLinkClick(e, '#features')}
                      >
                        <strong>Human-Crafted Tech</strong>
                        <span>Intuitive digital experiences</span>
                      </a>
                      <a
                        href="#stats"
                        role="menuitem"
                        onClick={(e) => handleLinkClick(e, '#stats')}
                      >
                        <strong>Performance & Scale</strong>
                        <span>150+ projects & 98% satisfaction</span>
                      </a>
                      <a
                        href="#how-it-works"
                        role="menuitem"
                        onClick={(e) => handleLinkClick(e, '#how-it-works')}
                      >
                        <strong>Impact Measurement</strong>
                        <span>Meaningful metrics & feedback</span>
                      </a>
                    </div>
                  )}
                </>
              ) : (
                <a
                  href={link.href}
                  onClick={(e) => handleLinkClick(e, link.href)}
                >
                  {link.label}
                </a>
              )}
            </li>
          ))}
        </ul>
      </nav>

      <div className="nav__actions">
        <button
          type="button"
          className="btn btn--light nav__cta"
          onClick={onOpenContact}
          aria-haspopup="dialog"
        >
          Get Started
        </button>
        <button
          className="nav__burger"
          type="button"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <Close /> : <Menu />}
        </button>
      </div>

      {open && (
        <>
          <div
            className="nav__backdrop"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="nav__sheet"
            role="dialog"
            aria-label="Mobile Navigation"
          >
            <ul>
              {navLinks.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    onClick={(e) => handleLinkClick(e, link.href)}
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn--flame nav__sheet-cta"
              onClick={() => {
                setOpen(false)
                onOpenContact()
              }}
            >
              Get Started
            </button>
          </div>
        </>
      )}
    </header>
  )
}
