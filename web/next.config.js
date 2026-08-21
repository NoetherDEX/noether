/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the Azure Container Apps deployment
  // (web/Dockerfile). Vercel builds are unaffected by this setting.
  output: 'standalone',
  images: { formats: ['image/avif', 'image/webp'] },
  // C9: iframe-wrapping is the cheapest phishing attack against a wallet
  // frontend — deny embedding everywhere, plus baseline hardening. Scoped
  // deliberately to frame-ancestors (not a full CSP) so WalletConnect and
  // Next's inline runtime keep working.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // 2y HSTS across *.noether.exchange (all subdomains are HTTPS-only)
          // closes the redirect-only first-visit/downgrade window.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          // The app never uses these sensors; WalletConnect QR flows scan
          // with the phone's camera, not the page's.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
