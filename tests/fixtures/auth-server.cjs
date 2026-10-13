// Isolated fake identity service for offline browser tests, never used in deployment.
const http = require("node:http");
const uuid = "00000000-0000-4000-8000-000000000001";
const user = { id: uuid, aud: "authenticated", role: "authenticated", email: "henrywhy233@gmail.com", email_confirmed_at: "2026-01-01T00:00:00Z", app_metadata: {provider:"email"}, user_metadata: {}, created_at:"2026-01-01T00:00:00Z" };
const jwt = [Buffer.from(JSON.stringify({alg:"HS256",typ:"JWT"})).toString("base64url"),Buffer.from(JSON.stringify({sub:uuid,email:user.email,aud:"authenticated",role:"authenticated",exp:4102444800,iat:1700000000})).toString("base64url"),"test-only-not-a-real-signature"].join(".");
const session = { access_token:jwt,refresh_token:"test-only-refresh",token_type:"bearer",expires_in:3600,expires_at:4102444800,user };
http.createServer((req,res)=>{
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Headers","apikey,authorization,content-type,x-client-info,x-supabase-api-version");
  res.setHeader("Access-Control-Allow-Methods","GET,POST,PUT,OPTIONS");
  res.setHeader("Content-Type","application/json");
  if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
  if(req.url.startsWith("/auth/v1/token")){res.end(JSON.stringify(session));return;}
  if(req.url.startsWith("/auth/v1/user")&&req.headers.authorization===`Bearer ${jwt}`){res.end(JSON.stringify(user));return;}
  if(req.url.startsWith("/auth/v1/logout")){res.writeHead(204);res.end();return;}
  if(req.url==="/"){res.end(JSON.stringify({ok:true}));return;}
  res.writeHead(401);res.end(JSON.stringify({message:"Unauthenticated fixture request"}));
}).listen(3102,"127.0.0.1");
