import { useEffect, useState } from "react";
import { getSession, subscribeToAuthChanges } from "./api.js";
import SecurityPanel from "./SecurityPanel.jsx";

export default function SecurityMount() {
  const [session, setSession] = useState(null);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    let cleanup = () => {};

    getSession().then(setSession).catch(() => setSession(null));
    subscribeToAuthChanges((nextSession) => setSession(nextSession)).then((nextCleanup) => {
      cleanup = nextCleanup;
    });

    return () => cleanup();
  }, []);

  if (!session?.user) return null;

  return (
    <section className="app-shell security-mount-shell">
      {feedback ? (
        <div className={`alert ${feedback.type === "error" ? "error" : "success"}`}>
          {feedback.message}
        </div>
      ) : null}
      <div className="hero-panel security-mount-panel">
        <SecurityPanel setFeedback={setFeedback} />
      </div>
    </section>
  );
}
