/// <reference types="vite/client" />

// sql.js ships no bundled types; the dev-server persistence middleware only
// touches it through a small, dynamically-imported surface.
declare module 'sql.js'
