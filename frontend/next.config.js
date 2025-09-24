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

  // Remove standalone output for now to fix build issues
  // output: 'standalone',
};

module.exports = nextConfig;
