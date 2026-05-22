# Supabase connection details

Copy these connection details and replace `[YOUR-PASSWORD]` with your database password.

Details:

- Shared Pooler
- Only use on an IPv4 network — session pooler connections are IPv4-proxied for free.
- Use Direct Connection if connecting via an IPv6 network.
- host: aws-0-eu-west-1.pooler.supabase.com
- port: 5432
- database: postgres
- user: postgres.gurluyxjwbnvkozcrzgw

Connection string (use with care):

```
postgresql://postgres.gurluyxjwbnvkozcrzgw:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```

Notes:

- Do NOT commit your real password to source control. Store credentials in environment variables or a secrets manager.
- If your environment uses IPv6, use a direct (non-pooler) connection string provided by Supabase.

Optional: Install Agent Skills for Supabase (provides helper scripts and guidance):

```
npx skills add supabase/agent-skills
```

Created by GitHub Copilot assistant.
