# Architecture

What runs, how a buyer moves through it, and how a payment is decided. The diagrams are Mermaid, so they stay next to the code they describe.

## Components

The backend is an API and report pages; the website is separate. Everything an investigation needs goes through the engine router, so no AI vendor is preferred by name, and the investigator only keeps claims that cite a page the search really returned.

```mermaid
%% title: System components
%% type: architecture
flowchart TB
  W["Website and report pages<br/>in the buyer's browser"]
  subgraph BE["Backend: Node 22 + Express"]
    direction TB
    API["API: routes, security,<br/>bot guard, spend caps"]
    INV["Investigator<br/>claims must cite a real page"]
    PQ["Pricing, quote,<br/>tax gate"]
    PDF["PDF renderer<br/>Playwright + Chromium"]
    DL["Delivery"]
    RT["AI engine router<br/>cheapest qualified first"]
  end
  subgraph ST["Storage"]
    DB[("PostgreSQL")]
    FS[("Saved jobs on disk<br/>one server only")]
  end
  subgraph EX["External services"]
    AI["Claude, OpenAI, Gemini,<br/>Grok, DeepSeek"]
    RG["Official registers"]
    PAY["Razorpay (India)<br/>Dodo Payments (world)"]
    EM["E-mail and WhatsApp"]
  end
  W --> API
  API --> INV
  API --> PQ
  API --> PDF
  API --> DL
  INV --> RT
  RT --> AI
  INV --> RG
  PQ --> PAY
  DL --> EM
  PAY -. signed webhook .-> API
  API --> DB
  INV --> FS
```

## Buyer journey

A new investigation starts only after a short proof of work in the browser. The price comes from the price book on the server, never from the page, and the quote is signed and valid for 30 minutes.

```mermaid
%% title: Buyer journey from search to delivered report
%% type: sequence
sequenceDiagram
  autonumber
  participant B as Buyer
  participant F as Website
  participant A as Backend API
  participant I as Investigator
  participant E as AI engines and registers
  participant P as Payment provider
  B->>F: Search for a project
  F->>A: Start investigation (anti-bot proof of work)
  A->>I: Run first sweep
  I->>E: Web search, register lookups, page reads
  E-->>I: Sources and pages
  A-->>B: Free preview at /r/ref, filling in live
  B->>A: Ask for a quote
  A-->>B: Signed price, locked for 30 minutes
  B->>P: Pay the quoted total
  P-->>A: Signed webhook
  A->>I: Continue the full investigation
  A-->>B: Full report, PDF, e-mail and WhatsApp delivery
```

## How a payment is decided

India is sold by ShelterKart through Razorpay with GST included. Everywhere else a Merchant of Record (Dodo Payments) is the legal seller and collects the buyer's tax. A market opens only when every piece it needs is configured; a missing piece closes it.

```mermaid
%% title: Payment decision
%% type: flow
flowchart TD
  Q["Signed quote<br/>price from the price book"] --> C{"Billing country"}
  C -->|India| R["Razorpay<br/>ShelterKart sells, GST included"]
  C -->|Other| M["Dodo Payments<br/>merchant sells, collects tax"]
  R --> W["Signed webhook"]
  M --> W
  W --> V{"Amount and currency<br/>match the quote?"}
  V -->|Yes| U["Access token issued<br/>report unlocks"]
  V -->|No| X["Nothing unlocks<br/>mismatch is logged"]
  classDef ok fill:#e3f3e8,stroke:#2f7d4a,color:#14284b;
  classDef bad fill:#fde9e6,stroke:#b33a2e,color:#14284b;
  class U ok
  class X bad
```

## Known limits

Saved investigations are files on one server, so only one instance is safe (tracked on the board as the job-store item). Nothing has run against real payment, AI or delivery credentials yet.
