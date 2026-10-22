import { QueryClientProvider } from "@tanstack/react-query";
import { Component, lazy, Suspense, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createQueryClient } from "./api/queries";
import { subscribeHash } from "./lib/hash";
import { isMobileHash, isNarrow, mobileOptedOut, mobileTarget, shouldRedirect } from "./m/route";
import { isV2Hash, legacyHref, replaceHash } from "./route";

const V2App = lazy(() => import("./V2App"));
const MobileApp = lazy(() => import("./m/MobileApp"));

/**
 * Final review A-C1: a render-time exception ANYWHERE in the page content (the concrete case
 * found: a task 409's `current.deliverables` shaped as a raw string, before the server/client
 * normalization fixes below) had nothing to catch it — React unmounts the whole tree on an
 * uncaught render error, blanking the entire SPA. React error boundaries must be class
 * components (there is no hook equivalent); this is the ONE boundary around the page content,
 * not a fix for the specific bug (that's fixed at its source) but a backstop so a FUTURE
 * unforeseen render error degrades to a message instead of a blank tab.
 */
interface ErrorBoundaryState {
  hasError: boolean;
}
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    console.error("Unhandled render error", error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div role="alert" className="error-boundary">
          <span>页面出错了，请刷新</span>
          <button type="button" onClick={() => window.location.reload()}>
            刷新
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// After a deploy, a tab still running the old bundle asks for a hashed chunk that no longer
// exists; the server answers with the HTML shell (status 200) for any missing static file, so
// Vite's dynamic import fails and fires this window event. Reloading once picks up the new
// bundle; the sessionStorage timestamp stops a reload loop if the new bundle ALSO 404s.
const RELOAD_GUARD_KEY = "worklog:lastPreloadReload";
const RELOAD_GUARD_WINDOW_MS = 60_000;

/** After a deploy, a tab on the old bundle asks for a chunk that no longer exists (see the comment
 *  above RELOAD_GUARD_KEY). Reload once; if that already happened in the last minute, report stale. */
function useStaleBundleReload(): boolean {
  const [staleBundle, setStaleBundle] = useState(false);
  useEffect(() => {
    function onPreloadError() {
      // sessionStorage can throw (private browsing, blocked storage, ...). Without it we can't
      // tell whether we already tried a reload, so reloading again could loop forever — don't;
      // show the persistent banner instead of guessing.
      let last: number;
      try {
        const lastRaw = sessionStorage.getItem(RELOAD_GUARD_KEY);
        last = lastRaw ? Number(lastRaw) : 0;
      } catch {
        setStaleBundle(true);
        return;
      }
      const now = Date.now();
      if (now - last < RELOAD_GUARD_WINDOW_MS) {
        setStaleBundle(true);
        return;
      }
      try {
        sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
      } catch {
        setStaleBundle(true);
        return;
      }
      window.location.reload();
    }
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);
  return staleBundle;
}

export function App() {
  const [unauthorized, setUnauthorized] = useState(false);
  const [queryClient] = useState(() => createQueryClient(() => setUnauthorized(true)));
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  // Narrow screens go to the phone UI unless this device chose the desktop (docs/design/2026-10-13-mobile-design.md §3).
  // Decided during render, so the desktop chunk is never requested for a phone.
  const redirect = shouldRedirect(hash, isNarrow(), mobileOptedOut()) ? mobileTarget(hash) : null;
  useLayoutEffect(() => { if (redirect) replaceHash(redirect); }, [redirect]);
  // v2 is the home: an empty hash (`""`, `#`, `#/`) lands on #/v2/now, an address of the removed old UI on its
  // v2 page (legacyHref). replace, so Back doesn't loop.
  const legacy = !redirect && !isMobileHash(hash) && !isV2Hash(hash) ? legacyHref(hash) : null;
  useLayoutEffect(() => { if (legacy) replaceHash(legacy); }, [legacy]);
  return (
    <QueryClientProvider client={queryClient}>
      {redirect || legacy ? null : isMobileHash(hash) ? <Root key="m" unauthorized={unauthorized}><MobileApp /></Root> : <Root key="v2" unauthorized={unauthorized}><V2App /></Root>}
    </QueryClientProvider>
  );
}

function Root({ unauthorized, children }: { unauthorized: boolean; children: React.ReactNode }) {
  const staleBundle = useStaleBundleReload();
  return (
    <>
      {unauthorized && <div role="alert" className="banner banner--auth">登录已过期，请刷新页面</div>}
      {staleBundle && <div role="alert" className="banner banner--stale">页面已更新，请手动刷新</div>}
      <ErrorBoundary>
        <Suspense fallback={null}>{children}</Suspense>
      </ErrorBoundary>
    </>
  );
}
