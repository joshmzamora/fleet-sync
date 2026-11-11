import React from 'react'
import ReactDOM from 'react-dom/client'
// Keep the complete campus map as its own route. Its stylesheet loads only
// when that page is visited, so it cannot override the fleet dashboard theme.
const CampusMap = React.lazy(() => import('./CampusPage'))
const FleetOperations = React.lazy(() => import('./fleet/App'))
const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
const Page = pathname === '/campus-map' ? CampusMap : FleetOperations
document.title = pathname === '/campus-map' ? 'Campus Map | UT Dallas · Student Project' : 'FleetSync | University Fleet Operations'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', color: '#174d3e' }}>Loading FleetSync…</div>}>
      <Page />
    </React.Suspense>
  </React.StrictMode>,
)
