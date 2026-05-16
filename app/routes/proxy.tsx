// Shopify App Proxy forwards {shop}/apps/returns → {app-url}/proxy
// This file re-exports the portal so both /proxy and /portal resolve to the same component.
export { loader, action, default } from "./portal";
