/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Optimize for production builds
  swcMinify: true,

  // Configure webpack for better chunk handling and error recovery
  webpack: (config, { dev, isServer }) => {
    // Improve chunk splitting for better loading
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          default: {
            minChunks: 2,
            priority: -20,
            reuseExistingChunk: true
          },
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name: 'vendors',
            priority: -10,
            chunks: 'all'
          }
        }
      };
    }

    // Add better error handling for chunk loading
    config.optimization.moduleIds = 'deterministic';
    config.optimization.chunkIds = 'deterministic';

    return config;
  },

  // Configure headers for better caching
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  // Enable source maps in development only
  productionBrowserSourceMaps: false,

  // API rewrites for development - proxy certain routes to Express backend
  async rewrites() {
    return [
      // Proxy API routes that don't exist in Next.js to Express backend
      {
        source: '/api/memory/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3003'}/api/memory/:path*`,
      },
      {
        source: '/api/projects/:path*',
        destination: `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3003'}/api/projects/:path*`,
      },
      {
        source: '/health',
        destination: `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3003'}/api/health`,
      },
    ];
  },

  // Remove standalone output for now to fix build issues
  // output: 'standalone',
};

module.exports = nextConfig;
