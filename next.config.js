/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() { return [{ source: '/offline-sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }]; },
}

module.exports = nextConfig
