module.exports = {
  "/roku-api": {
    target: "http://localhost:8060",
    secure: false,
    changeOrigin: true,
    pathRewrite: { "^/roku-api": "" },
    router: function (req) {
      // Allow the Roku IP to be passed as a query param during setup
      const rokuIp = req.query?._rokuIp || req.headers["x-roku-ip"];
      if (rokuIp) {
        return `http://${rokuIp}:8060`;
      }
      // Fall back to saved IP from the referer or a default
      return "http://localhost:8060";
    },
    onProxyReq: function (proxyReq) {
      // Remove the custom query param so Roku doesn't see it
      const url = new URL(proxyReq.path, "http://localhost");
      url.searchParams.delete("_rokuIp");
      proxyReq.path = url.pathname + url.search;
    },
  },
};
