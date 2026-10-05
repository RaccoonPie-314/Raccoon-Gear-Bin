/**
 * The checkout's "use my location" capability: one geolocation read, formatted as a Google Maps
 * pin URL for the address field. A browser capability, so it lives here as a plain function
 * (the `clipboard.ts` precedent) — `useCheckout` owns the reactive state around it.
 *
 * The permission prompt is the browser's own, and it fires on this call — which is why the call
 * happens inside a click handler and nowhere else. There is deliberately no reverse-geocoding
 * service: the free ones answer at city level, which still cannot route a courier, while the pin
 * is exact — and Telegram auto-links bare URLs, so the shop taps it straight from the order push.
 *
 * Rejects with `Error('denied' | 'unavailable' | 'timeout')`; the caller maps the code to a
 * translated sentence. Five decimal places is ~1 m — more than delivery needs, and it keeps the
 * URL short enough for the 300-char address validation.
 */
export function locateDeliveryAddress(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(5)
        const lng = position.coords.longitude.toFixed(5)
        resolve(`https://maps.google.com/?q=${lat},${lng}`)
      },
      (error) => {
        // 1 = PERMISSION_DENIED, 3 = TIMEOUT; everything else is the device failing to answer.
        reject(new Error(error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable'))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    )
  })
}
