/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production'
const nextConfig = {
  // Keep it simple to avoid hydration issues
  // Disable Strict Mode in development to prevent double-mount of effects (awareness churn)
  reactStrictMode: !isDev,
  
  // Webpack config to prevent Yjs duplicate imports
  webpack: (config, { isServer }) => {
    // Fix for Yjs duplicate import issue
    // This prevents "Yjs was already imported" error
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
      
      // CRITICAL: Treat Yjs and y-websocket as singletons
      // Without this, React hot reload and multiple entrypoints can import duplicates
      config.resolve.alias = {
        ...config.resolve.alias,
        // Ensure all Yjs entrypoints resolve to the same module (use main export)
        'yjs': require.resolve('yjs'),
        // y-websocket singleton
        'y-websocket': require.resolve('y-websocket'),
      };
    }
    return config;
  },
  
  // Experimental features for better WebSocket support
  experimental: {
    // Enable if needed for WebSocket connections
    // serverActions: true,
  },
};

module.exports = nextConfig;
