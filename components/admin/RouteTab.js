import { useState, useEffect, useCallback } from 'react';
import ClayIcon from '../ui/ClayIcon';
import { apiFetch } from '@/lib/api-client';
import { STORE_MAP_ORIGIN } from '@/lib/products';

function stopAddress(o) {
  return [o.address, o.barangay, 'Cagayan de Oro'].filter(Boolean).join(', ');
}

// Single-stop directions link (origin = driver's current location on the phone).
function navUrl(o) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stopAddress(o))}&travelmode=driving`;
}

// Full-route link: store origin then every stop in list order.
// ponytail: stops stay in barangay-then-time order; free Google Maps URLs don't
// optimize stop order (that's the paid Directions API). Driver can drag to reorder in-app.
// Ceiling: a very large day (~25+ stops) can exceed URL length limits; fine for a small shop.
function fullRouteUrl(barangays) {
  const stops = barangays.flatMap((g) => g.orders.map(stopAddress));
  const segments = [STORE_MAP_ORIGIN, ...stops].map((s) => encodeURIComponent(s));
  return `https://www.google.com/maps/dir/${segments.join('/')}`;
}

export default function RouteTab({ savedPassword, onError }) {
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);

  const fetchRoute = useCallback(async () => {
    setLoading(true);
    try {
      setRoute(await apiFetch('/api/orders/delivery-route', { password: savedPassword }));
    } catch (e) {
      console.error('Failed to fetch route:', e);
      onError?.('Failed to load route: ' + (e.message || 'server error'));
    }
    setLoading(false);
  }, [savedPassword]);

  useEffect(() => { queueMicrotask(() => fetchRoute()); }, [fetchRoute]);

  async function updateStatus(id, status) {
    try {
      await apiFetch('/api/orders/' + id, { method: 'PATCH', password: savedPassword, body: { status } });
      await fetchRoute();
    } catch (e) {
      onError?.(e.message);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-clay-ink">Today&apos;s Deliveries</h2>
        <button onClick={fetchRoute} className="text-xs clay-raised-sm rounded-full px-3 py-1.5 font-semibold hover:bg-sky-50">
          <ClayIcon name="refresh" className="w-3.5 h-3.5 inline" /> Refresh
        </button>
      </div>
      {route && route.total > 0 && (
        <a
          href={fullRouteUrl(route.barangays)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 clay-btn-primary rounded-full px-4 py-3 text-sm font-semibold"
        >
          <ClayIcon name="truck" className="w-4 h-4" /> Open route in Google Maps ({route.total} stop{route.total === 1 ? '' : 's'})
        </a>
      )}
      {loading ? (
        <p className="text-center py-12 text-clay-muted">Loading route...</p>
      ) : !route || route.total === 0 ? (
        <p className="text-center py-12 text-clay-muted">No deliveries scheduled for today.</p>
      ) : (
        route.barangays.map((grp) => (
          <div key={grp.barangay}>
            <h3 className="font-display font-bold text-clay-ink2 mb-2">{grp.barangay} ({grp.count})</h3>
            <div className="space-y-2">
              {grp.orders.map((o) => (
                <div key={o.id} className="clay-raised-sm rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="font-semibold text-clay-ink flex items-center gap-2">
                        {o.customer_name}
                        {o.delivery_time && <span className="text-[10px] font-semibold text-sky-600">{o.delivery_date} {o.delivery_time}</span>}
                      </div>
                      <div className="text-sm text-clay-muted">{o.address}</div>
                      <div className="text-xs text-clay-muted">{o.product_type} x{o.quantity}</div>
                      <div className="flex items-center gap-3 mt-1">
                        <a href={`tel:${o.phone}`} className="text-xs text-clay-skydeep font-semibold inline-flex items-center gap-1">
                          <ClayIcon name="phone" className="w-3.5 h-3.5" /> {o.phone}
                        </a>
                        <a href={navUrl(o)} target="_blank" rel="noopener noreferrer" className="text-xs text-clay-skydeep font-semibold inline-flex items-center gap-1">
                          <ClayIcon name="send" className="w-3.5 h-3.5" /> Navigate
                        </a>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      {o.status === 'confirmed' && (
                        <button onClick={() => updateStatus(o.id, 'out_for_delivery')} className="text-xs bg-orange-100 text-orange-700 font-semibold px-3 min-h-11 rounded-full">Out</button>
                      )}
                      {o.status === 'out_for_delivery' && (
                        <button onClick={() => updateStatus(o.id, 'delivered')} className="text-xs bg-clay-success-bg text-clay-success font-semibold px-3 min-h-11 rounded-full">Delivered</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
