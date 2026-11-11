import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  Building2,
  CarFront,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  Construction,
  DoorOpen,
  Dumbbell,
  ExternalLink,
  Footprints,
  GraduationCap,
  House,
  Info,
  Landmark,
  Layers3,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  MapPinned,
  Menu,
  Minus,
  Navigation2,
  ParkingCircle,
  Plus,
  RotateCcw,
  Route,
  Search,
  Share2,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import L from 'leaflet'
import type { LatLngTuple, Map as LeafletMap } from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, ScaleControl, TileLayer, Tooltip, useMap } from 'react-leaflet'
import { locations } from './data/campus'
import type { CampusLocation } from './data/campus'

type Category = CampusLocation['category']
type SidebarTab = 'locations' | 'tours'
type BaseLayer = 'street' | 'satellite'
type TravelMode = 'walking' | 'driving'
type RouteData = { points: LatLngTuple[]; distance: number; duration: number }
type RouteState = { status: 'idle' | 'loading' | 'ready' | 'error'; data?: RouteData; message?: string }

const CAMPUS_CENTER: LatLngTuple = [32.9878, -96.7504]
const CAMPUS_ZOOM = 16
const DEFAULT_CATEGORY: Category = 'Academic & Administrative'
const CATEGORIES: Category[] = [
  'Academic & Administrative',
  'Construction',
  'Dining',
  'Housing',
  'Landmarks',
  'Parking & Transportation',
  'Services',
  'Skybridge',
  'Sports Facilities',
]

const CATEGORY_META: Record<Category, { icon: LucideIcon; symbol: string; className: string }> = {
  'Academic & Administrative': { icon: GraduationCap, symbol: 'A', className: 'academic' },
  Construction: { icon: Construction, symbol: 'C', className: 'construction' },
  Dining: { icon: UtensilsCrossed, symbol: 'D', className: 'dining' },
  Housing: { icon: House, symbol: 'H', className: 'housing' },
  Landmarks: { icon: Landmark, symbol: 'L', className: 'landmarks' },
  'Parking & Transportation': { icon: ParkingCircle, symbol: 'P', className: 'parking' },
  Services: { icon: Building2, symbol: 'S', className: 'services' },
  Skybridge: { icon: Route, symbol: 'B', className: 'skybridge' },
  'Sports Facilities': { icon: Dumbbell, symbol: 'R', className: 'sports' },
}

const TOURS = [
  {
    id: 'campus-highlights',
    title: 'Campus Highlights',
    eyebrow: 'Discover UT Dallas',
    description: 'A tour of central campus favorites, from the Student Union to the library and arts spaces.',
    stops: ['su', 'mc', 'fo', 'atc', 'jsom', 'dga'],
    className: 'highlights',
  },
  {
    id: 'academic-discovery',
    title: 'Academic Discovery',
    eyebrow: 'Explore the classrooms',
    description: 'Find key engineering, science, and business buildings across campus.',
    stops: ['ecss', 'ecsn', 'sci', 'bsb', 'jsom'],
    className: 'academics',
  },
  {
    id: 'student-life',
    title: 'Student Life',
    eyebrow: 'Life as a Comet',
    description: 'Take a look at residence halls, dining, recreation, and student gathering spaces.',
    stops: ['rhs', 'rhc', 'market-dhw', 'rcw', 'su'],
    className: 'student-life',
  },
] as const

type TourId = (typeof TOURS)[number]['id']

const LOCATION_BY_ID = new Map(locations.map((location) => [location.id, location]))

function formatDistance(meters: number) {
  if (meters < 1000) return Math.round(meters) + ' m'
  return (meters / 1000).toFixed(1) + ' km'
}

function formatDuration(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60))
  return minutes < 60 ? minutes + ' min' : Math.floor(minutes / 60) + ' hr ' + (minutes % 60) + ' min'
}

function readableCategory(category: Category) {
  return CATEGORY_META[category].className
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return escaped[character]
  })
}

function markerIcon(location: CampusLocation, selected: boolean) {
  const meta = CATEGORY_META[location.category]
  const label = escapeHtml(location.name)
  return L.divIcon({
    className: 'campus-marker-host',
    html:
      '<div class="map-marker campus-marker map-marker--' +
      meta.className +
      (selected ? ' is-selected' : '') +
      '" title="' +
      label +
      '"><span class="map-marker__glyph campus-marker__glyph" aria-hidden="true">' +
      meta.symbol +
      '</span></div>',
    iconSize: [38, 46],
    iconAnchor: [19, 44],
    tooltipAnchor: [0, -33],
  })
}

function buildingCodeIcon(location: CampusLocation, selected: boolean) {
  const code = escapeHtml(location.code ?? '')
  const width = Math.max(32, code.length * 8 + 14)
  return L.divIcon({
    className: 'campus-code-marker-host',
    html:
      '<span class="building-code-marker' +
      (selected ? ' is-selected' : '') +
      '" style="display:inline-flex;align-items:center;justify-content:center;min-width:' +
      width +
      'px;height:21px;padding:2px 5px;border:1px solid #d4dfd7;border-radius:4px;background:rgba(255,255,255,.93);color:#27543c;font:700 10px/1 Arial,sans-serif;letter-spacing:.02em;box-shadow:0 1px 3px rgba(20,45,30,.12);white-space:nowrap;">' +
      code +
      '</span>',
    iconSize: [width, 21],
    iconAnchor: [width / 2, 10],
  })
}

function MapEffects({
  selected,
  route,
  onMapReady,
}: {
  selected: CampusLocation | null
  route: RouteData | undefined
  onMapReady: (map: LeafletMap | null) => void
}) {
  const map = useMap()
  useEffect(() => {
    onMapReady(map)
    return () => onMapReady(null)
  }, [map, onMapReady])
  useEffect(() => {
    if (selected) {
      map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 17), { duration: 0.65 })
    }
  }, [map, selected?.id])
  useEffect(() => {
    if (route && route.points.length > 1) {
      map.fitBounds(L.latLngBounds(route.points), {
        paddingTopLeft: [70, 80],
        paddingBottomRight: [90, 100],
        maxZoom: 17,
      })
    }
  }, [map, route])
  return null
}

function IconButton({
  label,
  onClick,
  children,
  active,
  disabled,
  className = '',
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
  active?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      className={'map-control map-control-button ' + (active ? 'is-active ' : '') + className}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function getInitialLocationId(): string | null {
  const id = new URLSearchParams(window.location.search).get('location')
  return id && LOCATION_BY_ID.has(id) ? id : null
}

function getInitialCenter(): LatLngTuple {
  const params = new URLSearchParams(window.location.search)
  const lat = Number(params.get('lat'))
  const lng = Number(params.get('lng'))
  if (params.has('lat') && params.has('lng') && Number.isFinite(lat) && Number.isFinite(lng) && lat > 32.97 && lat < 33.01 && lng > -96.78 && lng < -96.73) {
    return [lat, lng]
  }
  return CAMPUS_CENTER
}

function getInitialZoom() {
  const value = Number(new URLSearchParams(window.location.search).get('zoom'))
  return Number.isInteger(value) && value >= 13 && value <= 19 ? value : CAMPUS_ZOOM
}

function getInitialRouteId(key: 'from' | 'to') {
  const id = new URLSearchParams(window.location.search).get(key)
  return id && LOCATION_BY_ID.has(id) ? id : ''
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 700)
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('locations')
  const [searchQuery, setSearchQuery] = useState('')
  const [enabledCategories, setEnabledCategories] = useState<Set<Category>>(() => new Set())
  const [expandedCategories, setExpandedCategories] = useState<Set<Category>>(() => new Set([DEFAULT_CATEGORY]))
  const [buildingLabels, setBuildingLabels] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(getInitialLocationId)
  const [mapLayer, setMapLayer] = useState<BaseLayer>('street')
  const [leafletMap, setLeafletMap] = useState<LeafletMap | null>(null)
  const [userPosition, setUserPosition] = useState<LatLngTuple | null>(null)
  const [locating, setLocating] = useState(false)
  const [toast, setToast] = useState('')
  const [roomOpen, setRoomOpen] = useState(false)
  const [roomQuery, setRoomQuery] = useState('')
  const [roomSearched, setRoomSearched] = useState(false)
  const [directionsOpen, setDirectionsOpen] = useState(() => Boolean(getInitialRouteId('to')))
  const [routeStart, setRouteStart] = useState(() => getInitialRouteId('from'))
  const [routeEnd, setRouteEnd] = useState(() => getInitialRouteId('to'))
  const [travelMode, setTravelMode] = useState<TravelMode>('walking')
  const [routeState, setRouteState] = useState<RouteState>({ status: 'idle' })
  const [activeTourId, setActiveTourId] = useState<TourId | null>(null)
  const [activeTourStop, setActiveTourStop] = useState(0)
  const roomInputRef = useRef<HTMLInputElement | null>(null)
  const roomTriggerRef = useRef<HTMLButtonElement | null>(null)
  const roomOpenedRef = useRef(false)
  const dialogRef = useRef<HTMLElement | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const selectedLocation = selectedId ? LOCATION_BY_ID.get(selectedId) ?? null : null
  const activeTour = TOURS.find((tour) => tour.id === activeTourId)
  const tourStops = useMemo(
    () => activeTour?.stops.map((id) => LOCATION_BY_ID.get(id)).filter((location): location is CampusLocation => Boolean(location)) ?? [],
    [activeTourId],
  )

  const notify = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 4200)
  }, [])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  useEffect(() => {
    if (roomOpen) {
      roomOpenedRef.current = true
      roomInputRef.current?.focus()
    } else if (roomOpenedRef.current) {
      roomTriggerRef.current?.focus()
    }
  }, [roomOpen])

  useEffect(() => {
    if (!roomOpen && !directionsOpen && sidebarOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (roomOpen) setRoomOpen(false)
      else if (directionsOpen) setDirectionsOpen(false)
      else if (window.innerWidth < 800) setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [roomOpen, directionsOpen, sidebarOpen])

  useEffect(() => {
    if (!roomOpen) return
    const keepFocusInDialog = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]'),
      )
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', keepFocusInDialog)
    return () => document.removeEventListener('keydown', keepFocusInDialog)
  }, [roomOpen])

  const matchingLocations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return locations
    return locations.filter((location) =>
      [location.name, location.code ?? '', location.category, location.description ?? ''].some((field) =>
        field.toLowerCase().includes(query),
      ),
    )
  }, [searchQuery])

  const visibleLocations = useMemo(
    () => matchingLocations.filter((location) => enabledCategories.has(location.category)),
    [matchingLocations, enabledCategories],
  )

  const visibleIds = useMemo(() => new Set(visibleLocations.map((location) => location.id)), [visibleLocations])

  const toggleCategory = (category: Category) => {
    setEnabledCategories((previous) => {
      const next = new Set(previous)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const toggleExpanded = (category: Category) => {
    setExpandedCategories((previous) => {
      const next = new Set(previous)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const selectLocation = useCallback((id: string) => {
    const location = LOCATION_BY_ID.get(id)
    if (!location) return
    setSelectedId(id)
    setEnabledCategories((previous) => new Set(previous).add(location.category))
    if (window.innerWidth <= 700) setSidebarOpen(false)
  }, [])

  const requestLocation = useCallback(
    (forRoute = false) => {
      if (!('geolocation' in navigator)) {
        notify('Location services are unavailable in this browser.')
        return
      }
      setLocating(true)
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const point: LatLngTuple = [position.coords.latitude, position.coords.longitude]
          setUserPosition(point)
          setLocating(false)
          if (forRoute) {
            setRouteStart('current')
            setDirectionsOpen(true)
          } else {
            leafletMap?.flyTo(point, 17, { duration: 0.7 })
          }
          notify('Your location was found.')
        },
        () => {
          setLocating(false)
          notify('Location unavailable. Allow browser location access, or select a campus building.')
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
      )
    },
    [leafletMap, notify],
  )

  const resolveRoutePoint = useCallback(
    (id: string): { lat: number; lng: number } | null => {
      if (id === 'current') return userPosition ? { lat: userPosition[0], lng: userPosition[1] } : null
      return LOCATION_BY_ID.get(id) ?? null
    },
    [userPosition],
  )

  const origin = resolveRoutePoint(routeStart)
  const destination = resolveRoutePoint(routeEnd)

  useEffect(() => {
    if (!directionsOpen || !origin || !destination || routeStart === routeEnd) {
      setRouteState({ status: 'idle' })
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setRouteState({ status: 'loading' })
      // FOSSGIS hosts separate OSRM data profiles for pedestrians and cars.
      // The public demo is suitable for small class-project previews only.
      const base =
        travelMode === 'walking'
          ? 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/'
          : 'https://routing.openstreetmap.de/routed-car/route/v1/driving/'
      const coordinates =
        origin.lng +
        ',' +
        origin.lat +
        ';' +
        destination.lng +
        ',' +
        destination.lat
      try {
        const response = await fetch(base + coordinates + '?overview=full&geometries=geojson&steps=false', {
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        })
        if (!response.ok) throw new Error('Routing service unavailable')
        const json: unknown = await response.json()
        if (!json || typeof json !== 'object' || !('routes' in json)) throw new Error('Invalid route response')
        const routes = (json as { routes?: Array<{ distance?: number; duration?: number; geometry?: { coordinates?: number[][] } }> }).routes
        const first = routes?.[0]
        const points = first?.geometry?.coordinates
        if (
          !first ||
          typeof first.distance !== 'number' ||
          typeof first.duration !== 'number' ||
          !Array.isArray(points) ||
          points.length < 2
        ) {
          throw new Error('No route available between these points')
        }
        const path = points
          .filter((coordinate) => Array.isArray(coordinate) && coordinate.length >= 2 && coordinate.every(Number.isFinite))
          .map(([lng, lat]) => [lat, lng] as LatLngTuple)
        if (path.length < 2) throw new Error('The returned route is incomplete')
        setRouteState({ status: 'ready', data: { points: path, distance: first.distance, duration: first.duration } })
      } catch (error) {
        if (!controller.signal.aborted) {
          setRouteState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Could not load the route.',
          })
        }
      }
    }, 850)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [directionsOpen, origin?.lat, origin?.lng, destination?.lat, destination?.lng, routeStart, routeEnd, travelMode])

  const externalDirectionsUrl = useMemo(() => {
    if (!destination) return ''
    const params = new URLSearchParams({
      api: '1',
      destination: destination.lat + ',' + destination.lng,
      travelmode: travelMode,
    })
    if (origin) params.set('origin', origin.lat + ',' + origin.lng)
    return 'https://www.google.com/maps/dir/?' + params.toString()
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, travelMode])

  const openDirectionsTo = (id: string) => {
    setRouteEnd(id)
    setDirectionsOpen(true)
    if (window.innerWidth <= 700) setSidebarOpen(false)
  }

  const resetMap = () => {
    setSearchQuery('')
    setEnabledCategories(new Set())
    setExpandedCategories(new Set([DEFAULT_CATEGORY]))
    setSidebarTab('locations')
    setSelectedId(null)
    setDirectionsOpen(false)
    setRouteStart('')
    setRouteEnd('')
    setRouteState({ status: 'idle' })
    setActiveTourId(null)
    setMapLayer('street')
    setBuildingLabels(true)
    leafletMap?.setView(CAMPUS_CENTER, CAMPUS_ZOOM, { animate: true })
    notify('Map view reset.')
  }

  const shareMap = async () => {
    const url = new URL(window.location.href)
    url.search = ''
    if (selectedLocation) url.searchParams.set('location', selectedLocation.id)
    else if (leafletMap) {
      url.searchParams.set('lat', leafletMap.getCenter().lat.toFixed(6))
      url.searchParams.set('lng', leafletMap.getCenter().lng.toFixed(6))
      url.searchParams.set('zoom', String(leafletMap.getZoom()))
    }
    if (directionsOpen && routeEnd) url.searchParams.set('to', routeEnd)
    if (directionsOpen && routeStart && routeStart !== 'current') url.searchParams.set('from', routeStart)
    try {
      if (navigator.share) {
        await navigator.share({ title: 'UT Dallas Campus Map', url: url.toString() })
        return
      }
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unsupported')
      await navigator.clipboard.writeText(url.toString())
      notify('Map link copied to clipboard.')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      window.prompt('Copy this campus map link:', url.toString())
    }
  }

  const roomLookup = useMemo(() => {
    if (!roomSearched) return null
    const text = roomQuery.trim().toUpperCase()
    if (!text) return null
    const firstCode = text.match(/^([A-Z][A-Z0-9]*)(?:[\s-]|$)/)?.[1] ?? ''
    const found = locations.find((location) => location.code?.toUpperCase() === firstCode)
    const exactName = locations.find((location) => location.name.toUpperCase() === text)
    return { location: found ?? exactName ?? null, input: text }
  }, [roomQuery, roomSearched])

  const startTour = (id: TourId) => {
    const tour = TOURS.find((item) => item.id === id)
    if (!tour) return
    setActiveTourId(id)
    setActiveTourStop(0)
    setDirectionsOpen(false)
    setSearchQuery('')
    selectLocation(tour.stops[0])
    if (window.innerWidth <= 700) setSidebarOpen(false)
  }

  const setTourStop = (index: number) => {
    if (!activeTour || index < 0 || index >= tourStops.length) return
    setActiveTourStop(index)
    selectLocation(tourStops[index].id)
  }

  const activeRoute = directionsOpen && routeState.status === 'ready' ? routeState.data : undefined
  const tourPath: LatLngTuple[] = tourStops.map((location) => [location.lat, location.lng])

  return (
    <div className={'app-shell campus-app ' + (sidebarOpen ? 'sidebar-open' : 'sidebar-closed')}>
      <header className="site-header campus-topbar">
        <div className="site-header__left campus-topbar__brand">
          <button
            className="mobile-menu-button"
            type="button"
            onClick={() => setSidebarOpen((previous) => !previous)}
            aria-label={sidebarOpen ? 'Close locations menu' : 'Open locations menu'}
            aria-expanded={sidebarOpen}
            aria-controls="campus-sidebar"
          >
            <Menu size={22} />
          </button>
          <a className="brand campus-brand" href="https://www.utdallas.edu/" target="_blank" rel="noopener noreferrer" aria-label="UT Dallas homepage">
            <span className="brand-mark campus-brand__mark">UTD</span>
            <span className="brand-name campus-brand__name">
              <span className="brand-caption campus-brand__caption">THE UNIVERSITY OF TEXAS</span>
              <strong>AT DALLAS</strong>
            </span>
          </a>
        </div>
        <div className="header-nav campus-topbar__center">
          <MapPinned size={18} />
          <span>Interactive Campus Map</span>
        </div>
        <div className="header-actions campus-topbar__actions">
          <button ref={roomTriggerRef} className="header-action" type="button" aria-label="Open room locator" onClick={() => setRoomOpen(true)}>
            <DoorOpen size={18} />
            <span className="button-label">Room Locator</span>
          </button>
          <button className="header-action header-share" type="button" aria-label="Share campus map" onClick={shareMap}>
            <Share2 size={18} />
            <span className="button-label">Share</span>
          </button>
          <a className="header-action header-action--visit" href="https://www.utdallas.edu/visit/" target="_blank" rel="noopener noreferrer" aria-label="Visit UT Dallas website">
            <span className="button-label">Visit UT Dallas</span>
            <ExternalLink size={15} />
          </a>
        </div>
      </header>

      <main className="app-main map-layout">
        {sidebarOpen && (
          <button
            className="sidebar-scrim"
            type="button"
            aria-label="Close campus locations menu"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside id="campus-sidebar" className={'sidebar locations-sidebar ' + (sidebarOpen ? 'is-open' : 'is-collapsed')} aria-label="Campus locations and tours">
          <div className="sidebar-hero">
            <div className="sidebar-hero__image" aria-hidden="true" />
            <div className="sidebar-intro sidebar-hero__content">
              <span className="sidebar-hero__eyebrow">WELCOME TO UT DALLAS</span>
              <h1>Explore our campus</h1>
              <p>Find the places, people, and paths that make us Comets.</p>
            </div>
          </div>
          <div className="sidebar-tabs" role="tablist" aria-label="Campus browsing">
              <button
                id="locations-tab"
                type="button"
                role="tab"
                className={sidebarTab === 'locations' ? 'is-active' : ''}
                aria-selected={sidebarTab === 'locations'}
                aria-controls="locations-panel"
                onClick={() => setSidebarTab('locations')}
              >
                <MapPin size={17} />
                Locations
              </button>
              <button
                id="tours-tab"
                type="button"
                role="tab"
                className={sidebarTab === 'tours' ? 'is-active' : ''}
                aria-selected={sidebarTab === 'tours'}
                aria-controls="tours-panel"
                onClick={() => setSidebarTab('tours')}
              >
                <Compass size={17} />
                Tours
              </button>
          </div>
          <div className="sidebar-content">
            {sidebarTab === 'locations' ? (
              <div id="locations-panel" role="tabpanel" aria-labelledby="locations-tab" className="categories-panel">
                <div className="sidebar-search search-field">
                  <Search size={18} aria-hidden="true" />
                  <label htmlFor="campus-search" className="sr-only">Search campus locations and building codes</label>
                  <input
                    id="campus-search"
                    type="search"
                    value={searchQuery}
                    placeholder="Search buildings, places..."
                    onChange={(event) => {
                      setSearchQuery(event.target.value)
                      if (event.target.value.trim()) setExpandedCategories(new Set(CATEGORIES))
                    }}
                  />
                  {searchQuery && (
                    <button type="button" title="Clear search" aria-label="Clear search" onClick={() => setSearchQuery('')}>
                      <X size={17} />
                    </button>
                  )}
                </div>
                <div className="categories-header sidebar-section-header">
                  <div>
                    <h2>Locations</h2>
                    <span>{visibleLocations.length} places shown</span>
                  </div>
                  <div className="filter-actions">
                    <button type="button" onClick={() => setEnabledCategories(new Set(CATEGORIES))}>All</button>
                    <span aria-hidden="true">·</span>
                    <button type="button" onClick={() => setEnabledCategories(new Set())}>None</button>
                  </div>
                </div>
                {matchingLocations.length === 0 && (
                  <div className="empty-state" role="status">
                    <Search size={22} />
                    <p>No locations match “{searchQuery}”.</p>
                    <button type="button" onClick={() => setSearchQuery('')}>Clear search</button>
                  </div>
                )}
                <div className="category-list category-accordion">
                  {CATEGORIES.filter((category) => !searchQuery.trim() || matchingLocations.some((location) => location.category === category)).map((category) => {
                    const categoryLocations = matchingLocations.filter((location) => location.category === category)
                    const meta = CATEGORY_META[category]
                    const CategoryIcon = meta.icon
                    const checked = enabledCategories.has(category)
                    const expanded = expandedCategories.has(category)
                    const panelId = 'category-' + meta.className
                    return (
                      <section className={'category-section category-group ' + (checked ? 'is-enabled ' : 'is-disabled ') + (expanded ? 'is-expanded' : '')} key={category}>
                        <div className="category-trigger category-group__header">
                          <label className="category-group__checkbox-wrap">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCategory(category)}
                              aria-label={'Show ' + category + ' on map'}
                            />
                            <span className={'category-icon category-icon--' + meta.className}>
                              <CategoryIcon size={17} />
                            </span>
                            <span className="category-name">{category}</span>
                            <span className="category-count">{categoryLocations.length}</span>
                          </label>
                          <button
                            className="category-expand"
                            type="button"
                            aria-label={(expanded ? 'Collapse ' : 'Expand ') + category}
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            onClick={() => toggleExpanded(category)}
                          >
                            <ChevronDown size={18} />
                          </button>
                        </div>
                        {expanded && (
                          <div id={panelId} className="category-items category-group__list">
                            {categoryLocations.length ? (
                              categoryLocations.map((location) => (
                                <button
                                  type="button"
                                  className={'location-row ' + (selectedId === location.id ? 'is-active' : '')}
                                  key={location.id}
                                  onClick={() => selectLocation(location.id)}
                                  aria-current={selectedId === location.id ? 'location' : undefined}
                                >
                                  <span className="location-row__pin"><MapPin size={15} /></span>
                                  <span className="location-row__name">{location.name}</span>
                                  {location.code && <span className="location-row__code">{location.code}</span>}
                                  <ChevronRight className="location-row__chevron" size={15} />
                                </button>
                              ))
                            ) : (
                              <p className="category-empty">No mapped locations in this category yet.</p>
                            )}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div id="tours-panel" role="tabpanel" aria-labelledby="tours-tab" className="tour-panel sidebar-tours">
                <div className="sidebar-section-header">
                  <h2>Explore with a tour</h2>
                  <p>Follow a curated set of campus stops.</p>
                </div>
                <div className="tour-list">
                  {TOURS.map((tour, index) => (
                    <article className={'tour-card tour-card--' + tour.className} key={tour.id}>
                      <div className="tour-card__visual" aria-hidden="true">
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <Compass size={31} strokeWidth={1.4} />
                      </div>
                      <div className="tour-card__body">
                        <span className="tour-card__eyebrow">{tour.eyebrow}</span>
                        <h3>{tour.title}</h3>
                        <p>{tour.description}</p>
                        <div className="tour-card__footer">
                          <span><MapPin size={14} /> {tour.stops.length} stops</span>
                          <button type="button" onClick={() => startTour(tour.id)}>
                            Start tour <ArrowRight size={15} />
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="sidebar-footer">
            <label className="building-label-toggle">
              <input type="checkbox" checked={buildingLabels} onChange={(event) => setBuildingLabels(event.target.checked)} />
              <Layers3 size={17} />
              <span>Building Labels</span>
              <span className={'switch-track ' + (buildingLabels ? 'is-on' : '')} aria-hidden="true" />
            </label>
            <p>Independent class project · Location coordinates are approximate.</p>
          </div>
        </aside>

        <section className="map-area map-stage" aria-label="Interactive UT Dallas campus map">
          <MapContainer
            className="campus-map campus-map-canvas"
            center={getInitialCenter()}
            zoom={getInitialZoom()}
            minZoom={13}
            maxZoom={19}
            scrollWheelZoom={true}
            zoomControl={false}
            attributionControl={true}
            preferCanvas={true}
          >
            {mapLayer === 'street' ? (
              <TileLayer
                key="street"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
                maxZoom={19}
              />
            ) : (
              <TileLayer
                key="satellite"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                attribution='Tiles &copy; Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community'
                maxZoom={19}
              />
            )}
            <MapEffects selected={selectedLocation} route={activeRoute} onMapReady={setLeafletMap} />
            {visibleLocations.map((location) => (
              <Marker
                key={location.id}
                position={[location.lat, location.lng]}
                icon={markerIcon(location, selectedId === location.id)}
                keyboard={true}
                title={location.name}
                alt={location.name}
                zIndexOffset={selectedId === location.id ? 1000 : 0}
                eventHandlers={{ click: () => selectLocation(location.id) }}
              >
                <Tooltip
                  key={buildingLabels ? 'labels' : 'hover'}
                  direction="top"
                  permanent={buildingLabels && Boolean(location.code)}
                  className={'map-label ' + (selectedId === location.id ? 'map-label--selected' : '')}
                  opacity={1}
                >
                  {location.code || location.name}
                </Tooltip>
              </Marker>
            ))}
            {buildingLabels && locations.filter((location) => location.code && !visibleIds.has(location.id)).map((location) => (
              <Marker
                key={'building-label-' + location.id}
                position={[location.lat, location.lng]}
                icon={buildingCodeIcon(location, selectedId === location.id)}
                keyboard={true}
                title={location.name + ' (' + location.code + ')'}
                alt={location.name}
                zIndexOffset={selectedId === location.id ? 990 : 0}
                eventHandlers={{ click: () => selectLocation(location.id) }}
              >
                <Tooltip direction="top">{location.name}</Tooltip>
              </Marker>
            ))}
            {userPosition && (
              <CircleMarker
                center={userPosition}
                radius={9}
                pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#1976d2', fillOpacity: 1 }}
              >
                <Tooltip direction="top">Your approximate location</Tooltip>
              </CircleMarker>
            )}
            {activeRoute && (
              <Polyline
                positions={activeRoute.points}
                pathOptions={{ color: '#ec641b', weight: 6, opacity: 0.92, lineCap: 'round', lineJoin: 'round' }}
              />
            )}
            {activeTour && tourPath.length > 1 && !activeRoute && (
              <Polyline positions={tourPath} pathOptions={{ color: '#e97928', weight: 4, opacity: 0.75, dashArray: '7 9' }} />
            )}
            <ScaleControl position="bottomleft" imperial={false} />
          </MapContainer>

          <div className="map-topbar map-top-actions" aria-label="Map location">
            <span className="map-topbar__title"><MapPinned size={17} /> UT Dallas · Richardson, TX</span>
          </div>
          <div className="map-layer-switch" role="group" aria-label="Map layer">
            <button type="button" className={mapLayer === 'street' ? 'is-active' : ''} aria-pressed={mapLayer === 'street'} onClick={() => setMapLayer('street')}>
              <MapIcon size={16} /> Street
            </button>
            <button type="button" className={mapLayer === 'satellite' ? 'is-active' : ''} aria-pressed={mapLayer === 'satellite'} onClick={() => setMapLayer('satellite')}>
              <Layers3 size={16} /> Satellite
            </button>
          </div>

          <div className="map-toolbar map-utility-controls" role="toolbar" aria-label="Map controls">
            <div className="map-toolbar__group">
              <IconButton label="Zoom in" onClick={() => leafletMap?.zoomIn()}><Plus size={21} /></IconButton>
              <IconButton label="Zoom out" onClick={() => leafletMap?.zoomOut()}><Minus size={21} /></IconButton>
            </div>
            <div className="map-toolbar__group">
              <IconButton label={locating ? 'Finding your location' : 'Find my location'} onClick={() => requestLocation()} disabled={locating}>
                <LocateFixed size={20} />
              </IconButton>
              <IconButton
                label="Get directions"
                onClick={() => {
                  if (selectedId) setRouteEnd(selectedId)
                  setDirectionsOpen(true)
                }}
                active={directionsOpen}
              >
                <Route size={20} />
              </IconButton>
              <IconButton label="Share this map" onClick={shareMap}><Share2 size={19} /></IconButton>
              <IconButton label="Reset map" onClick={resetMap}><RotateCcw size={19} /></IconButton>
            </div>
          </div>

          {!selectedLocation && !directionsOpen && !activeTour && (
            <div className="map-welcome-card">
              <span className="map-welcome-card__icon"><Navigation2 size={21} /></span>
              <div>
                <strong>Find your way around campus</strong>
                <span>Select a marker or search for a destination.</span>
              </div>
              <button type="button" onClick={() => setSidebarOpen(true)} aria-label="Browse locations"><ChevronRight size={19} /></button>
            </div>
          )}

          {selectedLocation && !directionsOpen && (
            <article className="detail-panel location-detail-panel" aria-label={selectedLocation.name + ' details'}>
              <div className={'detail-hero detail-hero--' + readableCategory(selectedLocation.category)}>
                <div className="detail-hero__badge"><MapPin size={15} /> CAMPUS LOCATION</div>
                <button type="button" className="detail-close" aria-label="Close location details" onClick={() => setSelectedId(null)}><X size={20} /></button>
                <div className="detail-hero__icon"><Building2 size={30} strokeWidth={1.6} /></div>
              </div>
              <div className="detail-content">
                <div className="detail-content__eyebrow">{selectedLocation.category}</div>
                <h2>{selectedLocation.name}</h2>
                {selectedLocation.code && <span className="detail-code">Building code · {selectedLocation.code}</span>}
                <p>{selectedLocation.description || 'Explore this location on the UT Dallas campus.'}</p>
                {selectedLocation.address && <p className="detail-address"><MapPin size={15} /> {selectedLocation.address}</p>}
                <div className="detail-coordinates">
                  <span>MAP COORDINATES</span>
                  <code>{selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}</code>
                  <small>Approximate feature location, not an entrance.</small>
                </div>
                <div className="detail-actions">
                  <button className="primary-action" type="button" onClick={() => openDirectionsTo(selectedLocation.id)}>
                    <Navigation2 size={17} /> Directions
                  </button>
                  <button type="button" className="secondary-action" onClick={shareMap}>
                    <Share2 size={16} /> Share
                  </button>
                </div>
              </div>
            </article>
          )}

          {directionsOpen && (
            <section className="wayfinding-panel directions-panel" aria-labelledby="wayfinding-title">
              <div className="panel-heading">
                <div>
                  <span className="panel-eyebrow">PLAN YOUR ROUTE</span>
                  <h2 id="wayfinding-title"><Route size={21} /> Wayfinding</h2>
                </div>
                <button type="button" aria-label="Close directions" onClick={() => setDirectionsOpen(false)}><X size={21} /></button>
              </div>
              <div className="travel-modes" role="group" aria-label="Travel mode">
                <button type="button" className={travelMode === 'walking' ? 'is-active' : ''} aria-pressed={travelMode === 'walking'} onClick={() => setTravelMode('walking')}>
                  <Footprints size={17} /> Walking
                </button>
                <button type="button" className={travelMode === 'driving' ? 'is-active' : ''} aria-pressed={travelMode === 'driving'} onClick={() => setTravelMode('driving')}>
                  <CarFront size={17} /> Driving
                </button>
              </div>
              <div className="route-fields">
                <div className="route-field">
                  <span className="route-field__dot route-field__dot--start" aria-hidden="true" />
                  <label htmlFor="route-from">Starting point</label>
                  <select id="route-from" value={routeStart} onChange={(event) => setRouteStart(event.target.value)}>
                    <option value="">Choose a starting point</option>
                    {userPosition && <option value="current">My location</option>}
                    {locations.map((location) => <option key={location.id} value={location.id}>{location.code ? location.code + ' · ' : ''}{location.name}</option>)}
                  </select>
                </div>
                <button
                  type="button"
                  className="route-swap"
                  title="Swap starting point and destination"
                  aria-label="Swap route endpoints"
                  onClick={() => {
                    setRouteStart(routeEnd)
                    setRouteEnd(routeStart)
                  }}
                  disabled={!routeStart || !routeEnd || routeStart === 'current'}
                >
                  <ArrowLeftRight size={17} />
                </button>
                <div className="route-field">
                  <span className="route-field__dot route-field__dot--end" aria-hidden="true" />
                  <label htmlFor="route-to">Destination</label>
                  <select id="route-to" value={routeEnd} onChange={(event) => setRouteEnd(event.target.value)}>
                    <option value="">Choose your destination</option>
                    {locations.map((location) => <option key={location.id} value={location.id}>{location.code ? location.code + ' · ' : ''}{location.name}</option>)}
                  </select>
                </div>
                <button className="route-my-location" type="button" onClick={() => requestLocation(true)} disabled={locating}>
                  <LocateFixed size={15} /> {locating ? 'Finding location…' : 'Use my current location as start'}
                </button>
              </div>
              <div className="route-result" role="status" aria-live="polite">
                {!origin || !destination ? (
                  <div className="route-prompt"><Info size={19} /> Select a start and destination to preview a route.</div>
                ) : routeStart === routeEnd ? (
                  <div className="route-prompt"><Check size={19} /> Your starting point and destination are the same.</div>
                ) : routeState.status === 'loading' ? (
                  <div className="route-prompt"><span className="loading-spinner" /> Finding the best available route…</div>
                ) : routeState.status === 'ready' && routeState.data ? (
                  <div className="route-summary">
                    <div><Clock3 size={19} /><strong>{formatDuration(routeState.data.duration)}</strong><span>Estimated travel time</span></div>
                    <div><Navigation2 size={19} /><strong>{formatDistance(routeState.data.distance)}</strong><span>Route distance</span></div>
                  </div>
                ) : routeState.status === 'error' ? (
                  <div className="route-error"><Info size={18} /><span>Route preview unavailable. Try the external directions link below.</span></div>
                ) : (
                  <div className="route-prompt"><Route size={19} /> Preparing route preview…</div>
                )}
              </div>
              <p className="route-disclaimer">Route previews use OpenStreetMap routing and may omit construction closures or accessible paths. Verify conditions on campus.</p>
              {externalDirectionsUrl && (
                <a className="directions-external primary-action" href={externalDirectionsUrl} target="_blank" rel="noopener noreferrer">
                  Open in Google Maps <ExternalLink size={16} />
                </a>
              )}
            </section>
          )}

          {activeTour && tourStops[activeTourStop] && (
            <div className="tour-floating-card tour-progress-card" aria-label="Current campus tour stop">
              <div className="tour-progress-card__heading">
                <span><Compass size={16} /> {activeTour.title}</span>
                <button type="button" onClick={() => setActiveTourId(null)} aria-label="End tour"><X size={18} /></button>
              </div>
              <div className="tour-progress-card__progress" role="progressbar" aria-label="Tour progress" aria-valuemin={1} aria-valuemax={tourStops.length} aria-valuenow={activeTourStop + 1}>
                <span style={{ width: ((activeTourStop + 1) / tourStops.length) * 100 + '%' }} />
              </div>
              <span className="tour-progress-card__count">STOP {activeTourStop + 1} OF {tourStops.length}</span>
              <h3>{tourStops[activeTourStop].name}</h3>
              <p>{tourStops[activeTourStop].code ? 'Building ' + tourStops[activeTourStop].code + ' · ' : ''}{tourStops[activeTourStop].category}</p>
              <div className="tour-progress-card__actions">
                <button type="button" onClick={() => setTourStop(activeTourStop - 1)} disabled={activeTourStop === 0}><ChevronLeft size={17} /> Previous</button>
                {activeTourStop < tourStops.length - 1 ? (
                  <button type="button" className="primary-action" onClick={() => setTourStop(activeTourStop + 1)}>Next stop <ArrowRight size={17} /></button>
                ) : (
                  <button type="button" className="primary-action" onClick={() => setActiveTourId(null)}><Check size={17} /> Finish</button>
                )}
              </div>
            </div>
          )}

          <div className="map-data-notice"><Info size={13} /> Mapped positions are approximate</div>
          {toast && <div className="map-toast" role="status" aria-live="polite"><Check size={16} /> {toast}</div>}
        </section>
      </main>

      {roomOpen && (
        <div
          className="room-dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRoomOpen(false)
          }}
        >
          <section ref={dialogRef} className="room-dialog" role="dialog" aria-modal="true" aria-labelledby="room-dialog-title" aria-describedby="room-dialog-description">
            <div className="room-dialog__header">
              <span className="room-dialog__icon"><DoorOpen size={24} /></span>
              <button type="button" aria-label="Close room locator" onClick={() => setRoomOpen(false)}><X size={22} /></button>
            </div>
            <span className="panel-eyebrow">BUILDING CODE LOOKUP</span>
            <h2 id="room-dialog-title">Find your building</h2>
            <p id="room-dialog-description">Enter a campus building code and optional room number to find the building on the map.</p>
            <form
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                setRoomSearched(true)
              }}
            >
              <label htmlFor="room-lookup">Building code / room number</label>
              <div className="room-input-row">
                <input
                  ref={roomInputRef}
                  id="room-lookup"
                  value={roomQuery}
                  placeholder="e.g. ECSS 2.312"
                  onChange={(event) => {
                    setRoomQuery(event.target.value)
                    setRoomSearched(false)
                  }}
                  autoComplete="off"
                />
                <button className="primary-action" type="submit"><Search size={17} /> Find</button>
              </div>
            </form>
            {roomLookup && (
              <div className={'room-result ' + (roomLookup.location ? 'room-result--found' : 'room-result--missing')} role="status">
                {roomLookup.location ? (
                  <>
                    <div className="room-result__heading"><Check size={19} /><strong>{roomLookup.location.name}</strong></div>
                    <span>{roomLookup.location.code ? 'Building ' + roomLookup.location.code : roomLookup.location.category}</span>
                    <p>Building matched. The specific room number and indoor route cannot be verified with this map.</p>
                    <button className="secondary-action" type="button" onClick={() => {
                      selectLocation(roomLookup.location!.id)
                      setRoomOpen(false)
                    }}>
                      <MapPin size={16} /> Show building on map <ArrowRight size={15} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="room-result__heading"><Info size={19} /><strong>Building code not found</strong></div>
                    <p>Try a code from the campus map, such as ECSS, SCI, JSOM, SU, or RHS.</p>
                  </>
                )}
              </div>
            )}
            <p className="room-dialog__disclaimer"><Info size={15} /> Interior room maps are not part of this independent class-project dataset.</p>
          </section>
        </div>
      )}
    </div>
  )
}
