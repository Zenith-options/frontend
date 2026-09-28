const packageJson = require("./package.json");
const { parseEnv } = require("./src/env-schema.cjs");

const parsed = parseEnv(process.env);
const appVersion = parsed.NEXT_PUBLIC_APP_VERSION ?? packageJson.version;

module.exports = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: parsed.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
    NEXT_PUBLIC_STELLAR_NETWORK: parsed.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet",
    NEXT_PUBLIC_STELLAR_TESTNET_CONTRACT_ID: parsed.NEXT_PUBLIC_STELLAR_TESTNET_CONTRACT_ID ?? "",
    NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID: parsed.NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID ?? "",
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_BUILD_SHA: parsed.NEXT_PUBLIC_BUILD_SHA ?? "local",
  },
};