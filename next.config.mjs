import os from "node:os";

const getAllowedDevOrigins = () => {
  const addresses = new Set();

  Object.values(os.networkInterfaces()).forEach((interfaces) => {
    interfaces?.forEach((detail) => {
      if (detail.family === "IPv4" && !detail.internal) {
        addresses.add(detail.address);
      }
    });
  });

  return [...addresses];
};

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: getAllowedDevOrigins(),
};

export default nextConfig;
