export const BUILD_TARGET = process.env.BUILD_TARGET === 'win' ? 'win' : 'mac';

export const CHROME_USER_AGENT = BUILD_TARGET === 'win'
  ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Populated from electron-builder.yml by the production build.
export const UPDATE_REPOSITORY = "";
