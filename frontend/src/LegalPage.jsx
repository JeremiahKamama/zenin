import React from "react";
import "./public.css";
import { ZeninLogo } from "./components/Branding";

export default function LegalPage({ type = "terms" }) {
  const isTerms = type === "terms";
  const title = isTerms ? "Terms of Service" : "Privacy Policy";
  const lastUpdated = "May 12, 2026";

  return (
    <div className="min-h-screen flex flex-col relative bg-[#0A0A0A] font-sans text-[#A3A3A3]">
      <main className="flex-1 flex items-center justify-center relative z-10 p-6">
        <a className="mb-8" href="/" aria-label="Zenin Capital homepage">
          <ZeninLogo size="md" />
        </a>

        <article className="w-full max-w-[800px] bg-[#111111] border border-[#262626] rounded-2xl p-10" style={{ overflowY: "visible" }}>
          <header style={{ marginBottom: 32, borderBottom: "1px solid rgba(255, 255, 255, 0.06)", paddingBottom: 24 }}>
            <h1 style={{ fontSize: "2.5rem", marginBottom: 8, textAlign: "left", color: "white" }}>{title}</h1>
            <p style={{ color: "#737373", fontSize: "0.9rem" }}>Last updated: {lastUpdated}</p>
          </header>

          <div className="legal-content" style={{ color: "#A3A3A3", lineHeight: 1.6 }}>
            {isTerms ? (
              <TermsContent />
            ) : (
              <PrivacyContent />
            )}
          </div>

          <footer style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid rgba(255, 255, 255, 0.06)", textAlign: "center" }}>
            <button className="px-8 py-2 bg-white text-black rounded-md hover:bg-[#E5E5E5] transition-colors" style={{ width: "auto" }} onClick={() => window.history.back()}>
              Go Back
            </button>
          </footer>
        </article>
      </main>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2 style={{ fontSize: "1.25rem", color: "white", marginBottom: 12, fontWeight: 600 }}>{title}</h2>
      <div style={{ color: "#A3A3A3" }}>{children}</div>
    </section>
  );
}

function TermsContent() {
  return (
    <>
      <Section title="1. Agreement to Terms">
        By accessing or using Zenin Capital, you agree to be bound by these Terms of Service. If you do not agree, you may not use our services. We provide a workspace for financial data research, portfolio tracking, and market analytics.
      </Section>

      <Section title="2. Description of Service">
        Zenin Capital provides a software platform to aggregate financial data, track holdings, and generate analytics. We do not provide investment, legal, or tax advice. All data provided is for informational purposes only.
      </Section>

      <Section title="3. User Accounts">
        You are responsible for maintaining the confidentiality of your account credentials. You agree to notify us immediately of any unauthorized use of your account. Zenin Capital is not liable for any loss or damage arising from your failure to comply with this security obligation.
      </Section>

      <Section title="4. Prohibited Uses">
        You may not use the service for any illegal purpose, to infringe on intellectual property rights, or to disrupt the integrity of the platform. Scraping, reverse engineering, or unauthorized access to our infrastructure is strictly prohibited.
      </Section>

      <Section title="5. Disclaimers">
        THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. WE DO NOT GUARANTEE THE ACCURACY, COMPLETENESS, OR TIMELINESS OF MARKET DATA. ZENIN CAPITAL IS NOT A BROKER-DEALER OR REGISTERED INVESTMENT ADVISOR.
      </Section>

      <Section title="6. Limitation of Liability">
        In no event shall Zenin Capital be liable for any indirect, incidental, special, or consequential damages, including loss of profits, data, or use, arising out of your use of the service.
      </Section>
    </>
  );
}

function PrivacyContent() {
  return (
    <>
      <Section title="1. Information We Collect">
        We collect your email address for account authentication and communication. We also store workspace preferences, locally cached portfolio context, and saved calculations to provide a persistent user experience.
      </Section>

      <Section title="2. How We Use Data">
        Your data is used to provide and improve the Zenin Capital services, personalize your workspace, and communicate important updates. We do not sell your personal information to third parties.
      </Section>

      <Section title="3. Connected Sources & APIs">
        When you provide read-only API keys or link external accounts, we use this data solely to display your holdings and generate analytics within your private workspace. We recommend using least-privilege credentials.
      </Section>

      <Section title="4. Data Security">
        We implement industry-standard security measures to protect your information. This includes encryption of sensitive data and secure session management. However, no method of transmission over the Internet is 100% secure.
      </Section>

      <Section title="5. Third-Party Services">
        We may use third-party analytics (like Vercel Analytics) to help us understand how users interact with the platform. These services may collect information sent by your browser as part of a web page request.
      </Section>

      <Section title="6. Data Retention & Deletion">
        You can request to delete your account and associated data at any time. Signing out or clearing your browser storage will remove local session context.
      </Section>
    </>
  );
}
