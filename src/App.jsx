import { useState, useEffect } from 'react'
import Navbar from './components/Navbar.jsx'
import Hero from './components/Hero.jsx'
import ContactModal from './components/ContactModal.jsx'
import AdminPortal from './components/AdminPortal.jsx'

export default function App() {
  const [isContactOpen, setIsContactOpen] = useState(false)
  const [selectedService, setSelectedService] = useState('Digital Product Design')
  const [isAdminRoute, setIsAdminRoute] = useState(() => {
    return window.location.pathname === '/admin' || window.location.hash.startsWith('#/admin')
  })

  useEffect(() => {
    const handleLocationChange = () => {
      setIsAdminRoute(
        window.location.pathname === '/admin' || window.location.hash.startsWith('#/admin')
      )
    }

    window.addEventListener('popstate', handleLocationChange)
    window.addEventListener('hashchange', handleLocationChange)
    return () => {
      window.removeEventListener('popstate', handleLocationChange)
      window.removeEventListener('hashchange', handleLocationChange)
    }
  }, [])

  if (isAdminRoute) {
    return <AdminPortal />
  }

  const handleOpenContact = (service = 'Digital Product Design') => {
    setSelectedService(service)
    setIsContactOpen(true)
  }

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Navbar onOpenContact={() => handleOpenContact()} />
      <main id="main">
        <Hero onOpenContact={handleOpenContact} />
      </main>
      <ContactModal
        isOpen={isContactOpen}
        initialService={selectedService}
        onClose={() => setIsContactOpen(false)}
      />
    </>
  )
}

