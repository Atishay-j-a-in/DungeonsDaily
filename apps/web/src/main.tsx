import React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import * as Sentry from "@sentry/react";
import "./theme/tokens.css";
import "./adventure/adventure.css";
import { AdventureRoot } from "./adventure/AdventureApp.js";
import { initWebSentry } from "./observability/sentry.js";

initWebSentry();

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

function MissingKey() {
  return (
    <div className="adv">
      <div className="adv-start">
        <h1 className="adv-display">DungeonsDaily</h1>
        <p className="adv-lede">
          Sign-in is not configured yet. Run{" "}
          <code>clerk env pull --file apps/web/.env.local</code> from the
          project root, then restart the web server.
        </p>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {publishableKey ? (
      <ClerkProvider
        publishableKey={publishableKey}
        appearance={{
          variables: {
            colorPrimary: "#d4af5a",
            colorBackground: "#101a14",
            colorForeground: "#eceee6",
            colorMutedForeground: "#a8b3a4",
            colorInput: "#0a0f0c",
            colorInputForeground: "#eceee6",
            colorPrimaryForeground: "#101a14",
            colorBorder: "#3a4a3e",
            colorRing: "#d4af5a",
            colorModalBackdrop: "rgba(5, 8, 6, 0.7)",
            borderRadius: "0.875rem",
          },
        }}
      >
        <Sentry.ErrorBoundary
          fallback={
            <div className="adv">
              <div className="adv-start">
                <h1 className="adv-display">The dungeon trembles</h1>
                <p className="adv-lede">
                  Something broke on this device. Reload to try again; your
                  chronicle is safe in the vault.
                </p>
                <button
                  className="adv-btn adv-btn-speak"
                  type="button"
                  onClick={() => window.location.reload()}
                >
                  Reload the adventure
                </button>
              </div>
            </div>
          }
        >
          <AdventureRoot />
        </Sentry.ErrorBoundary>
      </ClerkProvider>
    ) : (
      <MissingKey />
    )}
  </React.StrictMode>,
);
