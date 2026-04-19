/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['10.0.0.80'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
