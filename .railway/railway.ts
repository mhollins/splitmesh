import { defineRailway, preserve, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  const app = service("splitmesh", {
    build: "npm run build",
    start: "npm start",
    healthcheck: "/api/health",
    replicas: 1,
    volumeMounts: {
      "/data": volume("splitmesh-data", { sizeMB: 1024 }),
    },
    env: {
      NODE_ENV: "production",
      DATABASE_PATH: "/data/splitmesh.db",
      SESSION_SECRET: preserve(),
    },
  });

  return project("splitmesh", {
    resources: [app],
  });
});
