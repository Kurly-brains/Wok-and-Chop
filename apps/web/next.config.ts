import type { NextConfig } from 'next';
const config: NextConfig = { trailingSlash: true, images: { unoptimized: true }, transpilePackages: ['@wok/domain','@wok/contracts'], devIndicators: false };
export default config;
