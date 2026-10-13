// Served under app.darwin.market/stellar (rewritten from the main Darwin app), so every page,
// asset and API route lives below the base path. Empty for a standalone deploy.
const basePath = process.env.DARWIN_BASE_PATH ?? "/stellar";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
