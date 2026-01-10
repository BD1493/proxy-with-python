import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import dotenv from "dotenv";
import session from "express-session";
import bodyParser from "body-parser";
import HttpsProxyAgent from "https-proxy-agent";

dotenv.config();

const app = express();

// Load proxies
let proxies = fs.readFileSync("proxies.txt", "utf-8")
  .split("\n")
  .filter(line => line && !line.startsWith("#"))
  .map(p => ({ url: p, alive: true, lastResponse: 0 }));

let currentProxyIndex = 0;

// Get next alive proxy
function getNextProxy() {
  const aliveProxies = proxies.filter(p => p.alive);
  if (aliveProxies.length === 0) return null;
  const proxy = aliveProxies[currentProxyIndex % aliveProxies.length];
  currentProxyIndex++;
  return proxy;
}

// Test all proxies for liveness and speed
async function testProxies() {
  for (let p of proxies) {
    try {
      const start = Date.now();
      await fetch("https://www.google.com", {
        agent: new HttpsProxyAgent.HttpsProxyAgent(p.url),
        timeout: 5000
      });
      p.alive = true;
      p.lastResponse = Date.now() - start;
    } catch {
      p.alive = false;
      p.lastResponse = 0;
    }
  }
  console.log("Proxy test complete:", proxies);
}

// Initial test & repeat every 5 minutes
testProxies();
setInterval(testProxies, 5 * 60 * 1000);

// Middleware
app.use(express.static("public"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: "search-secret",
  resave: false,
  saveUninitialized: true,
}));

// Admin login page
app.get("/admin", (req, res) => {
  if (req.session.loggedIn) {
    let proxyStatusHtml = proxies.map(p => `
      <li>${p.url} - ${p.alive ? "Alive" : "Dead"} - ${p.lastResponse}ms</li>
    `).join("");
    res.send(`
      <h1>Admin Panel</h1>
      <ul>${proxyStatusHtml}</ul>
      <a href="/admin-logout">Logout</a>
    `);
  } else {
    res.send(`
      <form method="POST" action="/admin-login">
        <input type="password" name="password" placeholder="Admin Password" />
        <button type="submit">Login</button>
      </form>
    `);
  }
});

// Admin login
app.post("/admin-login", (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    res.redirect("/admin");
  } else {
    res.send("Wrong password");
  }
});

// Admin logout
app.get("/admin-logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin"));
});

// Search route
app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).send("Query required");

  const proxyObj = getNextProxy();
  if (!proxyObj) return res.status(500).send("No alive proxies");

  try {
    const response = await fetch(
      `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      {
        agent: new HttpsProxyAgent.HttpsProxyAgent(proxyObj.url),
        timeout: 7000
      }
    );
    const text = await response.text();
    res.send(text);
  } catch (err) {
    console.error("Proxy failed:", proxyObj.url, err.message);
    proxyObj.alive = false;
    res.status(500).send("Proxy request failed, will try next one");
  }
});

// Status route
app.get("/status", (req, res) => res.send("Server running"));

app.listen(process.env.PORT || 3000, () => console.log("Server running"));
