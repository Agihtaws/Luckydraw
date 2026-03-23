// src/App.jsx
import React, { useState, useEffect } from "react";
import Navbar              from "./components/Navbar.jsx";
import HomePage            from "./pages/HomePage.jsx";
import CampaignPage        from "./pages/CampaignPage.jsx";
import AdminPage           from "./pages/AdminPage.jsx";
import HistoryPage         from "./pages/HistoryPage.jsx";

// ─────────────────────────────────────────────────────────────
// History API router — clean URLs, no #
// ─────────────────────────────────────────────────────────────

function getRoute() {
  const path = window.location.pathname;
  if (path.startsWith("/campaign/")) return { page: "campaign", id: path.split("/")[2] };
  if (path === "/admin")             return { page: "admin" };
  if (path === "/history")           return { page: "history" };
  return { page: "home" };
}

export function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new Event("popstate"));
}

// ─────────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────────

export default function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const handler = () => {
      setRoute(getRoute());
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  // Support ?campaign=1 from Discord link
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cid = params.get("campaign");
    if (cid) navigate(`/campaign/${cid}`);
  }, []);

  const goTo = (path) => {
    // Accept both named shortcuts ("home") and full paths ("/campaign/1")
    if (path === "home")         navigate("/");
    else if (path === "admin")   navigate("/admin");
    else if (path === "history") navigate("/history");
    else                         navigate(path);  // full path like /campaign/1
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <Navbar page={route.page} navigate={goTo} />

      <main style={{ flex: 1 }}>
        {route.page === "home"     && <HomePage onSelect={(id) => navigate(`/campaign/${id}`)} />}
        {route.page === "campaign" && <CampaignPage campaignId={route.id} navigate={goTo} />}
        {route.page === "admin"    && <AdminPage navigate={goTo} />}
        {route.page === "history"  && <HistoryPage />}
      </main>

      <footer className="text-center py-6 text-xs"
        style={{ color: "var(--muted)", borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
        Powered by{" "}
        <a href="https://somnia.network" target="_blank" rel="noreferrer"
          className="underline" style={{ color: "var(--purple)" }}>
          Somnia Reactivity
        </a>
        {" "}— prizes sent in the same block as the draw.
      </footer>
    </div>
  );
}