/* ==========================================================================
 * Pashu-Mitra — Organisation / owner configuration
 * --------------------------------------------------------------------------
 * GIGW 3.0: Q01 (logo + ownership), Q02 (ownership on every entry page),
 *           Q05 (last updated), Q09 (About us), Q10 (Contact us),
 *           Q12 (National Portal link), Q22 (government integrations),
 *           L01 (WIM), D-section policies.
 *
 * DESIGN RULE — NO INVENTED GOVERNMENT INFORMATION.
 * Every value below that depends on the owning organisation is a clearly
 * marked placeholder of the form  "[OWNER ACTION: ...]"  or has
 * `placeholder: true`. The application renders these visibly marked so that
 * no user can mistake them for approved official content.
 * See docs/compliance/04-needs-owner-input.md for the full list.
 * ========================================================================== */

/* global window */
(function () {
  "use strict";

  // Set to true only once the owning organisation has approved the values.
  const OWNER_DETAILS_APPROVED = false;

  const ORG = {
    approved: OWNER_DETAILS_APPROVED,

    // Application / service identity (safe: it is the product's own name).
    // The user-facing product name is Pashu-Mitra. Internal identifiers that
    // belong to the deployment (Render service names, database paths, env
    // variable names, storage keys) deliberately keep their existing values —
    // renaming those would break the running services, not the branding.
    appName: "Pashu-Mitra",
    appNameLocal: "पशु-मित्र",
    tagline: "Animal Disease Reporting, Veterinary Care & Surveillance Platform",

    // Q01 — Emblem / logo.
    // The State Emblem of India is deliberately NOT used: its use is governed by
    // the State Emblem of India (Prohibition of Improper Use) Act, 2005 and
    // requires authorisation. The product uses its own logo asset instead.
    //
    // assets/pashu-mitra-logo.png is the official Pashu-Mitra logo. Replace the
    // file with a new export to re-brand; no code change is needed. If the file
    // is missing the header falls back to the plain product name (never to a
    // different or redrawn logo).
    logo: {
      src: "assets/pashu-mitra-logo.png",
      mark: "🐄",                     // last-resort text fallback only
      alt: "Pashu-Mitra — Animal Disease Reporting and Veterinary Care Platform",
      aspectRatio: "auto",            // never force a ratio: the asset keeps its own
      href: "#/home",                 // logo links to the home page (GIGW Q01)
    },

    // Q02 — Ownership. Placeholder until the owning body supplies it.
    owner: {
      name: "[OWNER ACTION: official organisation name]",
      shortName: "[OWNER ACTION: short name]",
      parentBody: "[OWNER ACTION: parent department / ministry]",
      address: "[OWNER ACTION: official postal address]",
      email: "[OWNER ACTION: official contact email]",
      phone: "[OWNER ACTION: official contact phone]",
      workingHours: "[OWNER ACTION: office hours, e.g. Mon–Fri 09:30–18:00 IST]",
    },

    // Q05 — Last reviewed date (ISO). SHOULD be maintained by the content owner.
    lastReviewed: "2026-10-05",

    // L01 — Web Information Manager. Must be nominated by the organisation.
    wim: {
      name: "[OWNER ACTION: Web Information Manager name]",
      designation: "[OWNER ACTION: designation]",
      email: "[OWNER ACTION: WIM email]",
      phone: "[OWNER ACTION: WIM phone]",
    },

    // Q10 — Contact page functionary slots (owner-configurable).
    contactPoints: [
      {
        role: "Helpline (animal health)",
        detail: "7382210251",
        kind: "tel",
        note: "Configured via backend /api/ivr/info when available.",
      },
      {
        role: "General enquiries",
        detail: "[OWNER ACTION: email]",
        kind: "email",
      },
      {
        role: "Grievance officer",
        detail: "[OWNER ACTION: name, designation, email, phone]",
        kind: "text",
      },
    ],

    // Q12 — National Portal of India.
    nationalPortal: {
      label: "National Portal of India",
      url: "https://www.india.gov.in",
      opensNewWindow: true,
    },

    // Q22 — Government platform integrations.
    // Status is reported accurately: "configured" | "not configured" | "optional".
    // Nothing here pretends an integration is live when it is not.
    integrations: [
      { id: "india_portal",   label: "India Portal",        status: "not configured", note: "Requires organisation-approved API credentials." },
      { id: "digilocker",     label: "DigiLocker",          status: "not configured", note: "Requires organisation-approved API credentials." },
      { id: "aadhaar",        label: "Aadhaar (identity)",  status: "not configured", note: "Requires UIDAI approval; not required by current workflows." },
      { id: "sso_meripehchaan", label: "Meri Pehchaan / NSSO", status: "optional",    note: "Optional SSO adapter; existing auth preserved either way." },
      { id: "mygov",          label: "MyGov",               status: "not configured", note: "Citizen engagement; optional." },
      { id: "myscheme",       label: "MyScheme",            status: "not configured", note: "Scheme discovery; optional." },
      { id: "data_platform",  label: "Government Data Platform (open formats)", status: "optional", note: "Data export already available at /api/govt/export." },
    ],

    // Policy pages — templates requiring organisational approval.
    // `approved: false` renders a visible "pending approval" notice.
    policies: [
      { id: "privacy",     label: "Privacy Policy",        approved: false },
      { id: "terms",       label: "Terms & Conditions",    approved: false },
      { id: "copyright",   label: "Copyright Policy",      approved: false },
      { id: "hyperlinking", label: "Hyperlinking Policy",  approved: false },
      { id: "accessibility", label: "Accessibility Statement", approved: false },
      { id: "security",    label: "Security Policy",       approved: false },
      { id: "cmap",        label: "Content Contribution, Moderation & Approval Policy", approved: false },
      { id: "archival",    label: "Content Archival Policy", approved: false },
      { id: "review",      label: "Content Review Policy", approved: false },
      { id: "monitoring",  label: "Website Monitoring Plan", approved: false },
      { id: "contingency", label: "Contingency Management Plan", approved: false },
      { id: "grievance",   label: "Grievance Redressal",   approved: false },
    ],

    // Grievance workflow (programme §44).
    // The application can implement the workflow; a real departmental backend
    // is an organisation action. Status is reported honestly.
    grievance: {
      workflowImplemented: "application-side",   // "application-side" | "integrated"
      departmentalBackend: "not configured",
      note: "The app-side workflow (file → reference number → track → respond → resolve) is implemented. Integration with a departmental grievance system requires organisation provision.",
    },
  };

  // Small helper so pages can test "is this value still a placeholder?"
  ORG.isPlaceholder = function (value) {
    return typeof value === "string" && value.indexOf("[OWNER ACTION") === 0;
  };

  window.ORG = ORG;
})();
