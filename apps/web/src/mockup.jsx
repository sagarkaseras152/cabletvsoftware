import React from "react";
import {
  adminSections,
  architectureCards,
  topNav,
  workflow,
} from "./appBlueprint.js";

const shellStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, #12304a 0%, #07111b 48%, #03070b 100%)",
  color: "#f3f8fb",
  fontFamily: "Segoe UI, sans-serif",
};

const containerStyle = {
  width: "min(1180px, calc(100% - 32px))",
  margin: "0 auto",
};

const cardStyle = {
  background: "rgba(8, 21, 33, 0.78)",
  border: "1px solid rgba(120, 184, 255, 0.18)",
  borderRadius: 20,
  boxShadow: "0 20px 70px rgba(0, 0, 0, 0.28)",
};

export function CableOpsMockup() {
  return (
    <div style={shellStyle}>
      <div style={{ ...containerStyle, padding: "28px 0 56px" }}>
        <header
          style={{
            ...cardStyle,
            padding: 20,
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ color: "#79d2ff", fontSize: 12, letterSpacing: 2 }}>
              MULTI-TENANT OPERATOR SAAS
            </div>
            <h1 style={{ fontSize: 34, marginTop: 8 }}>CableOps Control Center</h1>
            <p style={{ color: "#b9c7d4", maxWidth: 700, marginTop: 8 }}>
              Easy-to-use modern platform for cable and internet operators with
              customers, collections, recharges, staff, complaints, and SaaS billing.
            </p>
          </div>
          <nav style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {topNav.map((item) => (
              <span
                key={item}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  background: "rgba(121, 210, 255, 0.12)",
                  color: "#dff7ff",
                  fontSize: 14,
                }}
              >
                {item}
              </span>
            ))}
          </nav>
        </header>

        <section
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "1.2fr 0.8fr",
            gap: 20,
          }}
        >
          <div style={{ ...cardStyle, padding: 24 }}>
            <div style={{ color: "#79d2ff", fontSize: 13, letterSpacing: 1.2 }}>
              A TO Z FLOW
            </div>
            <h2 style={{ marginTop: 10, fontSize: 26 }}>From login to logout</h2>
            <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
              {workflow.map((step, index) => (
                <div
                  key={step}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "42px 1fr",
                    gap: 12,
                    alignItems: "start",
                  }}
                >
                  <div
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 14,
                      background: "linear-gradient(135deg, #1bb4ff, #00e2a8)",
                      color: "#03111a",
                      fontWeight: 700,
                      display: "grid",
                      placeItems: "center",
                    }}
                  >
                    {index + 1}
                  </div>
                  <div style={{ paddingTop: 8, color: "#dfe8ef" }}>{step}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...cardStyle, padding: 24 }}>
            <div style={{ color: "#79d2ff", fontSize: 13, letterSpacing: 1.2 }}>
              MONETIZATION
            </div>
            <h2 style={{ marginTop: 10, fontSize: 24 }}>How you earn</h2>
            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              {[
                "Operator monthly/yearly subscription plans",
                "Extra SMS / WhatsApp / storage add-ons",
                "Premium reports and white-label branding",
                "Optional commission on collected payments",
              ].map((point) => (
                <div
                  key={point}
                  style={{
                    padding: 14,
                    borderRadius: 16,
                    background: "rgba(255, 255, 255, 0.04)",
                    color: "#d7eaf0",
                  }}
                >
                  {point}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{ marginTop: 24 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
              gap: 16,
            }}
          >
            {architectureCards.map((card) => (
              <article key={card.title} style={{ ...cardStyle, padding: 20 }}>
                <h3 style={{ fontSize: 18 }}>{card.title}</h3>
                <p style={{ marginTop: 10, color: "#b9c7d4", lineHeight: 1.6 }}>
                  {card.detail}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section
          style={{
            marginTop: 24,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 20,
          }}
        >
          {adminSections.map((section) => (
            <div key={section.title} style={{ ...cardStyle, padding: 24 }}>
              <div style={{ color: "#79d2ff", fontSize: 13 }}>{section.title}</div>
              <ul style={{ marginTop: 16, paddingLeft: 18, color: "#eaf3f8", lineHeight: 1.9 }}>
                {section.pages.map((page) => (
                  <li key={page}>{page}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

export default CableOpsMockup;
