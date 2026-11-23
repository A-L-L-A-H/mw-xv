/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-packages-to-apps",
      comment: "Shared packages must never import from application layers",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: "^apps/" }
    },
    {
      name: "no-circular",
      comment: "Avoid circular dependencies inside packages",
      severity: "warn",
      from: { path: "^packages/[^/]+/src/" },
      to: { circular: true }
    }
  ],
  options: {
    doNotFollow: {
      path: ["node_modules", "\\.next", "dist", "build", "coverage"]
    },
    exclude: {
      path: ["node_modules", "\\.next", "dist", "build", "coverage", "\\.d\\.ts$"]
    }
  }
};