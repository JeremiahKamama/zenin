# DEPRECATED: Supabase Auth notes

This document described the hosted Supabase Auth flow. Zenin no longer routes OAuth or runtime
authentication through Supabase. The app now uses backend-managed auth endpoints under
`/api/auth/*`. If you still need the historical Supabase notes for migration, keep a copy
outside this repo.

Steps to make Google sign-in redirect to your site

1. Supabase Dashboard — Auth Settings
   - Open your Supabase project → Authentication → Settings.
   - Set `Site URL` to `https://www.zenin.capital`.
   - Under `Redirect URLs`, add (at minimum):
     - `https://www.zenin.capital/auth?mode=signin`
     - `https://www.zenin.capital/auth?mode=signup`
     - `https://www.zenin.capital/auth?mode=forgot&reset=1` (if you use password recovery)
   - Save changes.

2. Google Cloud Console (OAuth client)
   - If you created the Google OAuth client yourself, ensure its Authorized redirect URIs include the Supabase callback:
     - `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - Supabase will handle exchanging the provider token and redirecting the browser back to the `redirect_to` you passed (e.g. `https://www.zenin.capital/auth?mode=signin`).

3. Confirm frontend redirect parameter
   - The frontend uses `redirectTo: window.location.origin + '/auth?mode=signin'` when calling `client.auth.signInWithOAuth(...)`. That is correct — it tells Supabase where to return the user after successful provider auth.

How to avoid showing `supabase.co` in the browser address bar (optional)

- Custom auth domain (preferred): Supabase supports mapping a custom domain to the Auth UI so the authorize/callback endpoints are under your domain. This requires configuring a custom domain in Supabase and DNS records — see the Supabase docs for "Custom domains for Auth". This may require a paid plan.
- Proxying OAuth through your own backend: implement an OAuth flow on your backend and use Google directly (more work and responsibility for token handling).

If you want, I can:

- Add a small README snippet or update `.env.example` with reminders about `VITE_SUPABASE_URL` and redirect URLs.
- Create a step-by-step checklist for adding the Google client redirect and Supabase settings with screenshots (if you provide the project ref).

References:

- Supabase Auth docs: https://supabase.com/docs/guides/auth
- Social provider setup: https://supabase.com/docs/guides/auth/social-login
