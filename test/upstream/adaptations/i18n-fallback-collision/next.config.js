// CommonJS translation of the fixture's next.config.ts so Nextane's build-time
// config loader (which cannot require TypeScript) reads the same values.
module.exports = {
  reactStrictMode: true,
  i18n: {
    defaultLocale: "en",
    locales: ["en", "es"],
  },
};
