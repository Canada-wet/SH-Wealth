// Isolated fake identity service for offline browser tests, never used in deployment.
const http = require("node:http");
const uuid = "00000000-0000-4000-8000-000000000001";
const user = {
  id: uuid,
  aud: "authenticated",
  role: "authenticated",
  email: "henrywhy233@gmail.com",
  email_confirmed_at: "2026-01-01T00:00:00Z",
  app_metadata: { provider: "email" },
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const jwt = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  ),
  Buffer.from(
    JSON.stringify({
      sub: uuid,
      email: user.email,
      aud: "authenticated",
      role: "authenticated",
      exp: 4102444800,
      iat: 1700000000,
    }),
  ).toString("base64url"),
  "test-only-not-a-real-signature",
].join(".");
const session = {
  access_token: jwt,
  refresh_token: "test-only-refresh",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800,
  user,
};
const documents = new Map();
const invites = new Map();
http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.headers["access-control-request-headers"] ||
        "apikey,authorization,content-type,x-client-info,x-supabase-api-version",
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,OPTIONS",
    );
    res.setHeader("Content-Type", "application/json");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url.startsWith("/auth/v1/token")) {
      res.end(JSON.stringify(session));
      return;
    }
    if (
      req.url.startsWith("/auth/v1/user") &&
      req.headers.authorization === `Bearer ${jwt}`
    ) {
      res.end(JSON.stringify(user));
      return;
    }
    if (req.url.startsWith("/auth/v1/logout")) {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url === "/") {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    const address = new URL(req.url, "http://127.0.0.1:3102");
    if (address.pathname.startsWith("/rest/v1/rpc/")) {
      let payload = "";
      req.on("data", (chunk) => (payload += chunk));
      req.on("end", () => {
        const args = JSON.parse(payload || "{}");
        const name = address.pathname.split("/").at(-1);
        let result;
        if (
          name === "create_wealth_household" ||
          name === "ensure_shared_wealth_household"
        ) {
          result = crypto.randomUUID();
          documents.set(result, {
            household_id: result,
            revision: 0,
            document: null,
          });
          invites.set(result, result);
        } else if (name === "is_wealth_member")
          result = documents.has(args.target_household);
        else if (name === "household_invite_token")
          result = invites.get(args.target_household);
        else if (name === "join_wealth_household") result = args.invite_token;
        else if (name === "save_household_document") {
          const row = documents.get(args.target_household);
          if (!row || row.revision !== args.expected_revision) {
            res.writeHead(409);
            res.end(JSON.stringify({ message: "revision conflict" }));
            return;
          }
          row.revision++;
          row.document = args.next_document;
          result = row.revision;
        } else {
          res.writeHead(404);
          res.end("{}");
          return;
        }
        res.end(JSON.stringify(result));
      });
      return;
    }
    if (address.pathname === "/rest/v1/household_documents") {
      const id = address.searchParams.get("household_id")?.replace(/^eq\./, "");
      const row = documents.get(id);
      if (!row) {
        res.writeHead(404);
        res.end(JSON.stringify({ message: "not found" }));
        return;
      }
      res.end(
        JSON.stringify(req.headers.accept?.includes("object") ? row : [row]),
      );
      return;
    }
    if (address.pathname === "/rest/v1/households" && req.method === "DELETE") {
      documents.delete(address.searchParams.get("id")?.replace(/^eq\./, ""));
      res.writeHead(204);
      res.end();
      return;
    }
    if (address.pathname === "/rest/v1/advisor_alerts") {
      res.end("[]");
      return;
    }
    if (address.pathname === "/rest/v1/wealth_notification_channels") {
      res.end("[]");
      return;
    }
    res.writeHead(401);
    res.end(JSON.stringify({ message: "Unauthenticated fixture request" }));
  })
  .listen(3102, "127.0.0.1");
