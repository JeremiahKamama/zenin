# Deployment Guide: Subdomain Setup for Zenin

To route `admin.zenin.capital` to your new Admin Dashboard, follow the instructions for your specific hosting environment.

## 1. DNS Configuration
Add a **CNAME** or **A record** for the `admin` subdomain:
- **Type**: CNAME
- **Host**: `admin`
- **Value**: Your frontend hosting provider's address (e.g., `cname.vercel-dns.com` or your server's IP).

---

## 2. Nginx Configuration (VPS / Self-Hosted)
If you are using Nginx to serve your application, add a new `server` block for the admin subdomain:

```nginx
server {
    listen 80;
    server_name admin.zenin.capital;

    root /path/to/zenin/admin/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to the backend
    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## 3. Render / Vercel Configuration
If you are using a platform like Render or Vercel:
1. Create a **New Static Site** service.
2. Connect it to the Zenin repository.
3. Set the **Root Directory** to `admin`.
4. Set the **Build Command** to `npm install && npm run build`.
5. Set the **Publish Directory** to `dist`.
6. In the **Domains** settings of this new service, add `admin.zenin.capital`.

---

## 4. Backend CORS (Already Configured)
The Zenin backend is already configured to allow requests from any `.zenin.capital` subdomain:

```javascript
if (normalizedOrigin.endsWith(".zenin.capital")) {
  return true;
}
```

---

## 5. Local Testing
To test the subdomain locally, add the following line to your `/etc/hosts` file:
```text
127.0.0.1 admin.localhost
```
Then run the admin app with `npm run dev` and access it via `http://admin.localhost:4001`.

---

## 4. Vercel Monorepo / Services Config
If you are deploying the entire repository to Vercel and encountering "Multiple frameworks detected" errors (due to JS and Python files co-existing in the `backend` folder), ensure you have a `vercel.json` in the root with explicit framework settings:

```json
{
  "experimentalServices": {
    "backend": { "framework": "express", "routePrefix": "/api" },
    "frontend": { "framework": "vite", "mount": "/" },
    "admin": { "framework": "vite", "subdomain": "admin" }
  }
}
```

This tells Vercel to treat the `backend` folder as an Express application regardless of the Python scripts inside.
