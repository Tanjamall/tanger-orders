import { useEffect, useRef, useState } from 'react'
import { NavigationArrow } from '@phosphor-icons/react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { distanceKm, mapCoordinates, resolveLocation, type Coordinates } from '../../domain/locations'
import { navigationUrl } from '../../domain/orders'
import { getCurrentDevicePosition, isLocationPermissionDenied, type DevicePosition } from '../../nativePlatform'
import type { Order } from '../../types'

type CurrentLocation = Coordinates & { accuracy: number }

export default function DeliveryMap({ orders }: { orders: Order[] }) {
  const element = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const fallbackLocation: Coordinates = { latitude: 35.7410429, longitude: -5.803754 }
  const [currentLocation, setCurrentLocation] = useState<CurrentLocation | null>(null)
  const [locationStatus, setLocationStatus] = useState<'locating' | 'available' | 'denied' | 'unavailable'>('locating')
  const [resolvedOrders, setResolvedOrders] = useState<{ order: Order; coordinates: Coordinates }[]>([])

  const acceptLocation = ({ coords }: DevicePosition) => {
    const location = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }
    setCurrentLocation(location)
    setLocationStatus('available')
  }
  const rejectLocation = (error: unknown) => setLocationStatus(isLocationPermissionDenied(error) ? 'denied' : 'unavailable')
  const requestCurrentLocation = () => {
    setLocationStatus('locating')
    void getCurrentDevicePosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }).then(acceptLocation).catch(rejectLocation)
  }

  useEffect(() => {
    void getCurrentDevicePosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 }).then(acceptLocation).catch(rejectLocation)
  }, [])

  useEffect(() => {
    void Promise.all(orders.map(async (order): Promise<{ order: Order; coordinates: Coordinates } | null> => {
      const location = await resolveLocation(order.locationUrl)
      const coordinates = location.coordinates || mapCoordinates(location.locationUrl)
      return coordinates ? { order, coordinates } : null
    })).then((locations) => setResolvedOrders(locations.filter((location): location is { order: Order; coordinates: Coordinates } => location !== null)))
  }, [orders])

  useEffect(() => {
    if (!element.current) return
    const locationAnchor = currentLocation ?? fallbackLocation
    const points = [...resolvedOrders].sort((a, b) => distanceKm(locationAnchor, a.coordinates) - distanceKm(locationAnchor, b.coordinates))

    map.current?.remove()
    map.current = L.map(element.current, { zoomControl: false }).setView([locationAnchor.latitude, locationAnchor.longitude], 12)
    L.control.zoom({ position: 'bottomright' }).addTo(map.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map.current)
    const layer = L.layerGroup().addTo(map.current)
    const markerIcon = new L.Icon({ iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png', iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png', shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41] })
    if (currentLocation) {
      const currentIcon = L.divIcon({ className: 'current-location-marker', html: '<span><i></i></span>', iconSize: [30, 30], iconAnchor: [15, 15] })
      L.circle([currentLocation.latitude, currentLocation.longitude], { radius: Math.min(Math.max(currentLocation.accuracy, 20), 500), color: '#1679e8', weight: 1, fillColor: '#56a7ff', fillOpacity: .12, interactive: false }).addTo(layer)
      L.marker([currentLocation.latitude, currentLocation.longitude], { icon: currentIcon, zIndexOffset: 2000 }).bindPopup('<strong>Your current location</strong>').addTo(layer)
    }

    points.forEach(({ order, coordinates }, index) => {
      L.marker([coordinates.latitude, coordinates.longitude], { icon: markerIcon, zIndexOffset: 1000 })
        .bindPopup(`<strong>${index + 1}. ${order.client}</strong><br>${order.address}<br><a href="${navigationUrl(order)}" target="_blank">Open in Google Maps</a>`)
        .addTo(layer)
    })

    const bounds: [number, number][] = [...(currentLocation ? [[currentLocation.latitude, currentLocation.longitude] as [number, number]] : []), ...points.map(({ coordinates }): [number, number] => [coordinates.latitude, coordinates.longitude])]
    if (bounds.length > 1) map.current.fitBounds(L.latLngBounds(bounds), { padding: [34, 34], maxZoom: 14, animate: false })
    else if (bounds.length === 1) map.current.setView(bounds[0], 15, { animate: false })
    const invalidateTimer = window.setTimeout(() => map.current?.invalidateSize({ animate: false }), 100)
    return () => {
      window.clearTimeout(invalidateTimer)
      const currentMap = map.current
      map.current = null
      currentMap?.stop()
      currentMap?.remove()
    }
  }, [resolvedOrders, currentLocation])

  const locationLabel = locationStatus === 'available' ? 'My location' : locationStatus === 'locating' ? 'Locating…' : locationStatus === 'denied' ? 'Allow location' : 'Locate me'
  return <><div ref={element} className="map-canvas" /><button type="button" className={`map-location ${locationStatus === 'locating' ? 'is-locating' : ''}`} aria-label={currentLocation ? 'Center map on my location' : 'Show my current location'} onClick={() => currentLocation ? map.current?.flyTo([currentLocation.latitude, currentLocation.longitude], 15, { animate: true, duration: .7 }) : requestCurrentLocation()}><NavigationArrow weight={currentLocation ? 'fill' : 'regular'} /><span>{locationLabel}</span></button>{!resolvedOrders.length && <p className="map-empty">Add Google Maps location links to orders to see them here.</p>}</>
}
