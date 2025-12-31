import { screen } from 'electron';
import { isPackaged, isE2E } from "../main";

// Matomo site ID for Electron - must match MATOMO_DOMAINS['electron'] in MatomoConfig.ts
const ELECTRON_SITE_ID = '4';

// Custom dimension ID for click tracking - must match MATOMO_CUSTOM_DIMENSIONS['electron'].clickAction
const CLICK_DIMENSION_ID = 2;

/**
 * Track events to Matomo using HTTP Tracking API
 * @see https://developer.matomo.org/api-reference/tracking-api
 */
export function trackEvent(
  category: string, 
  action: string, 
  name: string, 
  value?: string | number, 
  new_visit: number = 0,
  isClick?: boolean
): void {
  if (!category || !action) return;

  const shouldTrack = (process.env.NODE_ENV === 'production' || isPackaged) && !isE2E;
  if (!shouldTrack) return;

  const chromiumVersion = process.versions.chrome;
  const os = process.platform;
  const osVersion = process.getSystemVersion();
  const ua = `Mozilla/5.0 (${os === 'darwin' ? 'Macintosh' : os === 'win32' ? 'Windows NT' : os === 'linux' ? 'X11; Linux x86_64' : 'Unknown'}; ${osVersion}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromiumVersion} Safari/537.36`;
  const res = `${screen.getPrimaryDisplay().size.width}x${screen.getPrimaryDisplay().size.height}`;

  const params = new URLSearchParams({
    idsite: ELECTRON_SITE_ID,
    rec: '1',
    new_visit: new_visit ? new_visit.toString() : '0',
    e_c: category,
    e_a: action,
    e_n: name || '',
    ua: ua,
    action_name: `${category}:${action}`,
    res: res,
    url: 'https://github.com/remix-project-org/remix-desktop',
    rand: Math.random().toString()
  });

  if (value !== undefined) {
    const eventValue = (typeof value === 'number' && !isNaN(value)) ? value : 1;
    params.set('e_v', eventValue.toString());
  }

  // Add click dimension if provided
  if (isClick !== undefined) {
    params.set(`dimension${CLICK_DIMENSION_ID}`, isClick ? 'true' : 'false');
  }

  fetch(`https://matomo.remix.live/matomo/matomo.php?${params.toString()}`)
    .then(res => {
      if (!res.ok) {
        console.error('[Matomo] Failed to track event:', res.status);
      }
    })
    .catch(err => {
      console.error('[Matomo] Error tracking event:', err);
    });
}
