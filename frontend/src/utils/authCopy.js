const authCopy = {
  signin: {
    title: "Sign in",
    description:
      "Continue to your Zenin workspace with secure authentication.",
    badgedTitle: "Need an account?",
    badgedLinkLabel: "Create one",
    badgedAction: "signup"
  },
  signup: {
    title: "Create your workspace",
    description:
      "Sign up, confirm your email, and recover access.",
    badgedTitle: "Already have an account?",
    badgedLinkLabel: "Sign in",
    badgedAction: "signin"
  },
  forgot: {
    title: "Reset password",
    description:
      "Send a recovery link to your email, then return here to complete the reset.",
    setTitle: "Set a new password",
    setDescription: "Choose a new password for your Zenin account.",
    badgedTitle: "Back to",
    badgedLinkLabel: "sign in",
    badgedAction: "signin"
  },
  verify: {
    title: "Verify your email",
    description: (email) =>
      `Enter the 6-digit code Zenin sent to ${
        email ? `your inbox` : "your inbox"
      }.`,
    badgedTitle: "Need another account?",
    badgedLinkLabel: "Back to sign in",
    badgedAction: "signin"
  },
  mfa: {
    title: "Verify it is you",
    description: "This account has authenticator app MFA enabled.",
    badgedTitle: "Need to use another account?",
    badgedLinkLabel: "Back to sign in",
    badgedAction: "signin"
  }
};

export function getAuthCopy(mode, state = {}) {
  const entry = authCopy[mode] || authCopy.signin;

  if (mode === "verify" && typeof entry.description === "function") {
    return {
      ...entry,
      description: entry.description(state.email)
    };
  }

  if (mode === "forgot") {
    return {
      ...entry,
      title: state.recoveryReady ? entry.setTitle : entry.title,
      description: state.recoveryReady ? entry.setDescription : entry.description
    };
  }

  return entry;
}
