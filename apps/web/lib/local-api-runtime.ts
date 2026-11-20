const loopback = /^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/;

export function localApiForHost(host: string) {
  return !process.env.WOK_API_URL &&
    process.env.NODE_ENV === "development" &&
    loopback.test(host)
    ? "http://127.0.0.1:4000"
    : null;
}

export function isLoopbackHost(host: string) {
  return loopback.test(host);
}
