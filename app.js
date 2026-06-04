(function () {
  "use strict";

  const ANALYTICS_KEY = "jsrenderqa_analytics_events";
  const INTENT_KEY = "jsrenderqa_purchase_intents";
  const GITHUB_ISSUE_URL = "https://github.com/ert93333-ops/javascript-rendering-qa-briefs/issues/new";

  const SAMPLE_INITIAL_HTML = [
    "<html>",
    "  <head>",
    "    <title></title>",
    "    <meta name=\"description\" content=\"\">",
    "  </head>",
    "  <body>",
    "    <div id=\"app\"></div>",
    "    <script src=\"/static/chunks/app.js\"></script>",
    "    <a onclick=\"go('/products')\">Products</a>",
    "    <a href=\"#features\">Features</a>",
    "  </body>",
    "</html>",
  ].join("\n");

  const SAMPLE_RENDERED_HTML = [
    "<html>",
    "  <head>",
    "    <title>Acme Store</title>",
    "    <meta name=\"description\" content=\"Shop Acme products and replacement parts.\">",
    "  </head>",
    "  <body>",
    "    <main>",
    "      <h1>Acme Store</h1>",
    "      <p>Buy durable widgets and replacement parts before the migration launch.</p>",
    "      <a href=\"/products\">Products</a>",
    "      <button onclick=\"loadReviews()\">Load reviews</button>",
    "      <img data-src=\"/hero.jpg\" alt=\"Acme widget hero\">",
    "    </main>",
    "  </body>",
    "</html>",
  ].join("\n");

  const SAMPLE_CRITICAL_NOTES = [
    "Critical product copy and H1 only appear after hydration.",
    "Reviews load after button click.",
    "Hero image uses data-src until IntersectionObserver fires.",
    "No team has written the launch plan yet.",
  ].join("\n");

  const SAMPLE_LINK_SNIPPETS = [
    "<a onclick=\"go('/products')\">Products</a>",
    "<a href=\"#features\">Features</a>",
    "<button onclick=\"loadMore()\">Load more products</button>",
    "<a href=\"/docs\">Docs</a>",
  ].join("\n");

  const SAMPLE_ROUTE_NOTES = [
    "Routes use #/products on staging.",
    "Category pages are generated client-side after hydration.",
    "Some product tabs use fragments instead of crawlable URLs.",
  ].join("\n");

  const SAMPLE_RESOURCE_NOTES = [
    "robots.txt blocks /assets/app.js and /static/chunks/.",
    "CSS and JS are behind an auth-like CDN rule for unknown user agents.",
    "Reviews and recommendations load after click/scroll.",
  ].join("\n");

  const FALLBACK_PATTERN = /ssr|server[- ]render|pre[- ]render|static html|fallback|noscript|crawlable href|plain href|unblock|allow js|allow css|owner|fix|remediation|decision/i;
  const LAZY_PATTERN = /lazy|data-src|intersectionobserver|scroll|click|button|accordion|tab|load more|user action|after interaction|on demand|defer/i;
  const BLOCKED_PATTERN = /blocked|disallow|robots\.txt|cdn|waf|403|401|auth|unknown user[- ]agent|static\/chunks|assets\/|app\.js|style\.css|css|javascript|js/i;
  const HASH_ROUTE_PATTERN = /#\/|hash route|hash-route|fragment route|fragment|href=["']#|route.*#/i;

  const state = {
    latestBrief: null,
    latestBriefText: "",
    lastRemoteBody: "",
    signupStarted: false,
    pricingTracked: false,
  };

  function qs(selector, root) {
    return (root || document).querySelector(selector);
  }

  function qsa(selector, root) {
    return Array.from((root || document).querySelectorAll(selector));
  }

  function setText(selector, value) {
    const element = qs(selector);
    if (element) element.textContent = value;
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function readArray(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      return [];
    }
  }

  function writeArray(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      // Local storage can be unavailable in privacy modes. The workflow still works.
    }
  }

  function getUtm() {
    const params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get("utm_source") || "",
      utm_medium: params.get("utm_medium") || "",
      utm_campaign: params.get("utm_campaign") || "",
      utm_content: params.get("utm_content") || "",
    };
  }

  function track(eventName, detail) {
    const events = readArray(ANALYTICS_KEY);
    events.push({
      event: eventName,
      detail: detail || {},
      utm: getUtm(),
      path: window.location.pathname,
      createdAt: new Date().toISOString(),
    });
    writeArray(ANALYTICS_KEY, events.slice(-200));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function listHtml(items, emptyText) {
    if (!items.length) return "<p>" + escapeHtml(emptyText) + "</p>";
    return "<ul>" + items.map(function (item) {
      return "<li>" + escapeHtml(item) + "</li>";
    }).join("") + "</ul>";
  }

  function unique(items) {
    return Array.from(new Set(items.map(clean).filter(Boolean)));
  }

  function parseHtml(raw) {
    try {
      return new DOMParser().parseFromString(String(raw || ""), "text/html");
    } catch (error) {
      return document.implementation.createHTMLDocument("parse-error");
    }
  }

  function readableBodyText(doc) {
    const clone = doc.body ? doc.body.cloneNode(true) : null;
    if (!clone) return "";
    Array.from(clone.querySelectorAll("script, style, noscript, template")).forEach(function (node) {
      node.remove();
    });
    return clean(clone.textContent || "");
  }

  function titleText(doc) {
    return clean((doc.querySelector("title") || {}).textContent || "");
  }

  function metaDescription(doc) {
    const meta = doc.querySelector('meta[name="description" i]');
    return clean(meta ? meta.getAttribute("content") : "");
  }

  function anchorFindings(rawSnippets, initialDoc, renderedDoc) {
    const doc = parseHtml("<body>" + rawSnippets + "</body>");
    const anchors = qsa("a", doc).concat(qsa("a", initialDoc), qsa("a", renderedDoc));
    const buttons = qsa("button", doc).concat(qsa("button", initialDoc), qsa("button", renderedDoc));
    const linkWarnings = [];
    const routeWarnings = [];

    anchors.forEach(function (anchor) {
      const label = clean(anchor.textContent || anchor.getAttribute("aria-label") || "anchor");
      const href = clean(anchor.getAttribute("href") || "");
      const onclick = clean(anchor.getAttribute("onclick") || "");
      if (!href || onclick || /^javascript:/i.test(href)) {
        linkWarnings.push("JS-only or missing crawlable link: " + label + " needs a real href for crawler-visible navigation.");
      }
      if (href === "#" || href.charAt(0) === "#" || href.indexOf("#/") !== -1) {
        routeWarnings.push("hash-route or fragment route risk: " + label + " uses " + (href || "a fragment-only link") + " instead of a crawlable route.");
      }
    });

    buttons.forEach(function (button) {
      const label = clean(button.textContent || button.getAttribute("aria-label") || "button");
      if (/product|docs|route|more|load|next|category|review/i.test(label + " " + (button.getAttribute("onclick") || ""))) {
        linkWarnings.push("JS-only or missing crawlable link: " + label + " is exposed as a button/user action instead of a crawlable href.");
      }
    });

    return {
      linkWarnings: unique(linkWarnings),
      routeWarnings: unique(routeWarnings),
    };
  }

  function analyzeRendering(input) {
    const initialDoc = parseHtml(input.initialHtml);
    const renderedDoc = parseHtml(input.renderedHtml);
    const initialText = readableBodyText(initialDoc);
    const renderedText = readableBodyText(renderedDoc);
    const initialTitle = titleText(initialDoc);
    const initialDescription = metaDescription(initialDoc);
    const renderedTitle = titleText(renderedDoc);
    const renderedDescription = metaDescription(renderedDoc);
    const combinedNotes = [
      input.criticalNotes,
      input.linkSnippets,
      input.routeNotes,
      input.resourceNotes,
      input.initialHtml,
      input.renderedHtml,
    ].join("\n");

    const parseSummary = [
      "Template type: " + clean(input.templateType),
      "Initial body text length: " + initialText.length + " characters.",
      "Rendered body text length: " + renderedText.length + " characters.",
      "Initial title: " + (initialTitle || "missing"),
      "Rendered title: " + (renderedTitle || "missing"),
      "Initial meta description: " + (initialDescription || "missing"),
      "Rendered meta description: " + (renderedDescription || "missing"),
    ];
    const initialWarnings = [];
    const renderedOnlyWarnings = [];
    const crawlableLinkWarnings = [];
    const routeWarnings = [];
    const lazyWarnings = [];
    const blockedWarnings = [];
    const fallbackWarnings = [];
    const handoffReminders = [
      "Retest after SSR, pre-rendering, routing, link markup, lazy-loading, CDN, robots, or fallback changes ship.",
      "Treat this as JavaScript rendering SEO launch QA guidance; it does not fetch pages, crawl a site, emulate Googlebot, replace Search Console, or guarantee crawling, indexing, rankings, rendering, or Search Console outcomes.",
    ];

    const rootShells = qsa("#app, #root, #__next, [data-reactroot]", initialDoc).filter(function (node) {
      return clean(node.textContent).length < 12;
    });
    if ((initialText.length < 100 && renderedText.length > initialText.length + 50) || (rootShells.length && renderedText.length > initialText.length + 50)) {
      initialWarnings.push("empty app shell: initial HTML has little crawlable body text while rendered HTML contains meaningful page content.");
    }
    if (!initialTitle) {
      initialWarnings.push("missing initial title: source HTML title is empty or absent before JavaScript runs.");
    }
    if (!initialDescription) {
      initialWarnings.push("missing initial meta description: source HTML meta description is empty or absent before JavaScript runs.");
    }

    const renderedH1 = clean((renderedDoc.querySelector("h1") || {}).textContent || "");
    const initialH1 = clean((initialDoc.querySelector("h1") || {}).textContent || "");
    if ((renderedH1 && renderedH1 !== initialH1) || renderedText.length > Math.max(180, initialText.length * 2) || /only appear after hydration|rendered only|after javascript|client-side/i.test(input.criticalNotes)) {
      renderedOnlyWarnings.push("critical content only present in rendered HTML: important headings, copy, or links appear after JavaScript/hydration instead of in initial HTML.");
    }
    if (renderedTitle && renderedTitle !== initialTitle) {
      renderedOnlyWarnings.push("critical content only present in rendered HTML: page title is corrected only after rendering.");
    }
    if (renderedDescription && renderedDescription !== initialDescription) {
      renderedOnlyWarnings.push("critical content only present in rendered HTML: meta description is corrected only after rendering.");
    }

    const linkResult = anchorFindings(input.linkSnippets, initialDoc, renderedDoc);
    crawlableLinkWarnings.push.apply(crawlableLinkWarnings, linkResult.linkWarnings);
    routeWarnings.push.apply(routeWarnings, linkResult.routeWarnings);
    if (HASH_ROUTE_PATTERN.test(input.routeNotes + "\n" + input.linkSnippets)) {
      routeWarnings.push("hash-route or fragment route risk: route notes or snippets mention hash routes/fragments that may not create distinct crawlable URLs.");
    }

    if (LAZY_PATTERN.test(combinedNotes)) {
      lazyWarnings.push("lazy/user-action content risk: critical content, reviews, links, or media depend on click, scroll, IntersectionObserver, data-src, load more, or another user action.");
    }
    if (BLOCKED_PATTERN.test(input.resourceNotes)) {
      blockedWarnings.push("blocked JS/CSS/resource: notes mention robots.txt, CDN, auth, 403/401, WAF, chunks, assets, app.js, CSS, or JS resources that may prevent rendering.");
    }

    if (!FALLBACK_PATTERN.test(input.criticalNotes + "\n" + input.routeNotes + "\n" + input.resourceNotes)) {
      fallbackWarnings.push("missing fallback or owner remediation decision: notes do not name SSR, pre-render, static fallback, crawlable href, unblock, or an owner decision.");
    }
    if (initialWarnings.length + renderedOnlyWarnings.length + crawlableLinkWarnings.length + routeWarnings.length + lazyWarnings.length + blockedWarnings.length > 0 && !/owner|remediation|decision|fix|ticket|assigned/i.test(input.criticalNotes + "\n" + input.routeNotes + "\n" + input.resourceNotes)) {
      fallbackWarnings.push("missing fallback or owner remediation decision: assign a frontend, SEO, platform, or content owner before launch signoff.");
    }

    const issueCount =
      initialWarnings.length +
      renderedOnlyWarnings.length +
      crawlableLinkWarnings.length +
      routeWarnings.length +
      lazyWarnings.length +
      blockedWarnings.length +
      fallbackWarnings.length;
    const status = initialWarnings.length || renderedOnlyWarnings.length || crawlableLinkWarnings.length || blockedWarnings.length
      ? "Fix before launch"
      : routeWarnings.length || lazyWarnings.length || fallbackWarnings.length
        ? "Manual review"
        : "Ready for final JavaScript SEO QA";

    return {
      status: status,
      issueCount: issueCount,
      templateType: clean(input.templateType),
      parseSummary: unique(parseSummary),
      initialWarnings: unique(initialWarnings),
      renderedOnlyWarnings: unique(renderedOnlyWarnings),
      crawlableLinkWarnings: unique(crawlableLinkWarnings),
      routeWarnings: unique(routeWarnings),
      lazyWarnings: unique(lazyWarnings),
      blockedWarnings: unique(blockedWarnings),
      fallbackWarnings: unique(fallbackWarnings),
      handoffReminders: unique(handoffReminders),
    };
  }

  function briefToText(brief) {
    return [
      "JavaScript Rendering QA Briefs",
      "Status: " + brief.status,
      "Issue count: " + brief.issueCount,
      "Template type: " + brief.templateType,
      "",
      "Parse summary:",
      brief.parseSummary.length ? brief.parseSummary.join("\n") : "None found.",
      "",
      "Initial HTML warnings:",
      brief.initialWarnings.length ? brief.initialWarnings.join("\n") : "None found.",
      "",
      "Rendered-only content warnings:",
      brief.renderedOnlyWarnings.length ? brief.renderedOnlyWarnings.join("\n") : "None found.",
      "",
      "Crawlable link warnings:",
      brief.crawlableLinkWarnings.length ? brief.crawlableLinkWarnings.join("\n") : "None found.",
      "",
      "Route and fragment warnings:",
      brief.routeWarnings.length ? brief.routeWarnings.join("\n") : "None found.",
      "",
      "Lazy/user-action content warnings:",
      brief.lazyWarnings.length ? brief.lazyWarnings.join("\n") : "None found.",
      "",
      "Blocked resource warnings:",
      brief.blockedWarnings.length ? brief.blockedWarnings.join("\n") : "None found.",
      "",
      "Fallback and owner decision reminders:",
      brief.fallbackWarnings.length ? brief.fallbackWarnings.join("\n") : "None found.",
      "",
      "Handoff reminders:",
      brief.handoffReminders.join("\n"),
      "",
      "Note: This is JavaScript rendering SEO launch QA guidance, not a crawler, Search Console replacement, Googlebot emulator, or guarantee of crawling, rendering, indexing, rankings, or Search Console outcomes.",
    ].join("\n");
  }

  function renderBrief(brief) {
    const output = qs("#brief-output");
    const copyButton = qs("#copy-brief");
    const outputPanel = qs(".output-panel");
    const statusPill = qs("#status-pill");
    if (!output) return;

    output.classList.remove("empty");
    output.classList.add("is-updated");
    window.setTimeout(function () { output.classList.remove("is-updated"); }, 480);
    output.innerHTML = [
      '<div class="brief-summary">',
      '<strong>' + escapeHtml(brief.status) + '</strong>',
      '<span>' + brief.issueCount + ' checks need attention</span>',
      "</div>",
      '<section class="brief-section"><h4>Parse summary</h4>' + listHtml(brief.parseSummary, "No parse notes found.") + "</section>",
      '<section class="brief-section"><h4>Initial HTML warnings</h4>' + listHtml(brief.initialWarnings, "No initial HTML warnings found.") + "</section>",
      '<section class="brief-section"><h4>Rendered-only content warnings</h4>' + listHtml(brief.renderedOnlyWarnings, "No rendered-only content warnings found.") + "</section>",
      '<section class="brief-section"><h4>Crawlable link warnings</h4>' + listHtml(brief.crawlableLinkWarnings, "No crawlable link warnings found.") + "</section>",
      '<section class="brief-section"><h4>Route and fragment warnings</h4>' + listHtml(brief.routeWarnings, "No route or fragment warnings found.") + "</section>",
      '<section class="brief-section"><h4>Lazy/user-action content warnings</h4>' + listHtml(brief.lazyWarnings, "No lazy or user-action warnings found.") + "</section>",
      '<section class="brief-section"><h4>Blocked resource warnings</h4>' + listHtml(brief.blockedWarnings, "No blocked resource warnings found.") + "</section>",
      '<section class="brief-section"><h4>Fallback and owner decision reminders</h4>' + listHtml(brief.fallbackWarnings, "No fallback or owner decision reminders found.") + "</section>",
      '<section class="brief-section"><h4>Handoff reminders</h4>' + listHtml(brief.handoffReminders, "No handoff reminders found.") + "</section>",
    ].join("");
    setText("#output-title", "JavaScript rendering QA brief ready");
    setText("#status-pill", brief.status);
    if (copyButton) copyButton.disabled = false;
    if (outputPanel) {
      outputPanel.classList.add("has-brief");
      outputPanel.classList.toggle("status-good", brief.status === "Ready for final JavaScript SEO QA");
      outputPanel.classList.toggle("status-warning", brief.status === "Manual review");
      outputPanel.classList.toggle("status-danger", brief.status === "Fix before launch");
    }
    if (statusPill) {
      statusPill.classList.toggle("status-good", brief.status === "Ready for final JavaScript SEO QA");
      statusPill.classList.toggle("status-warning", brief.status === "Manual review");
      statusPill.classList.toggle("status-danger", brief.status === "Fix before launch");
    }
    state.latestBrief = brief;
    state.latestBriefText = briefToText(brief);
  }

  function pulseClass(element, className, duration) {
    if (!element) return;
    element.classList.add(className);
    window.setTimeout(function () { element.classList.remove(className); }, duration || 600);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Fall through to textarea fallback for headless browser clipboard blocks.
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function setupAuditor() {
    const form = qs("#auditor-form");
    const initialHtml = qs("#initial-html");
    const renderedHtml = qs("#rendered-html");
    const criticalNotes = qs("#critical-notes");
    const linkSnippets = qs("#link-snippets");
    const routeNotes = qs("#route-notes");
    const resourceNotes = qs("#resource-notes");
    const loadSample = qs("#load-sample");
    const error = qs("#workflow-error");
    const copyButton = qs("#copy-brief");
    if (!form || !initialHtml || !renderedHtml) return;

    if (loadSample) {
      loadSample.addEventListener("click", function () {
        initialHtml.value = SAMPLE_INITIAL_HTML;
        renderedHtml.value = SAMPLE_RENDERED_HTML;
        if (criticalNotes) criticalNotes.value = SAMPLE_CRITICAL_NOTES;
        if (linkSnippets) linkSnippets.value = SAMPLE_LINK_SNIPPETS;
        if (routeNotes) routeNotes.value = SAMPLE_ROUTE_NOTES;
        if (resourceNotes) resourceNotes.value = SAMPLE_RESOURCE_NOTES;
        if (qs("#template-type")) qs("#template-type").value = "SPA product page";
        initialHtml.focus();
        pulseClass(loadSample, "is-confirmed", 520);
        track("sample_js_render_rows_loaded");
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      track("core_action_started", { triggerSource: "auditor_form" });
      if (error) error.textContent = "";

      const input = {
        initialHtml: initialHtml.value.trim(),
        renderedHtml: renderedHtml.value.trim(),
        criticalNotes: criticalNotes ? criticalNotes.value.trim() : "",
        linkSnippets: linkSnippets ? linkSnippets.value.trim() : "",
        routeNotes: routeNotes ? routeNotes.value.trim() : "",
        resourceNotes: resourceNotes ? resourceNotes.value.trim() : "",
        templateType: qs("#template-type") ? qs("#template-type").value : "",
      };
      const inputLength = Object.keys(input).reduce(function (total, key) { return total + String(input[key]).length; }, 0);
      if (!input.initialHtml || !input.renderedHtml) {
        if (error) error.textContent = "Paste initial HTML and rendered HTML samples or load the sample before generating a JavaScript rendering QA brief.";
        track("core_action_failed", { reason: "empty_input" });
        return;
      }

      const brief = analyzeRendering(input);
      renderBrief(brief);
      track("core_action_completed", {
        issueCount: brief.issueCount,
        status: brief.status,
        templateType: brief.templateType,
        inputLength: inputLength,
      });
    });

    if (copyButton) {
      copyButton.addEventListener("click", function () {
        if (!state.latestBriefText) return;
        copyText(state.latestBriefText).then(function () {
          copyButton.textContent = "Copied brief";
          pulseClass(copyButton, "is-confirmed", 700);
          track("brief_copied", { issueCount: state.latestBrief ? state.latestBrief.issueCount : 0 });
          window.setTimeout(function () { copyButton.textContent = "Copy brief"; }, 1400);
        });
      });
    }
  }

  function buildRemoteIssue(intent) {
    const body = [
      "JavaScript Rendering QA Briefs early-access request",
      "",
      "Role: " + intent.role,
      "Site type: " + intent.siteType,
      "JS templates: " + intent.templateCount,
      "Plan interest: " + intent.plan,
      "Willingness to pay: " + intent.budget,
      "Purchase intent: " + (intent.purchaseIntent ? "yes" : "no"),
      "",
      "Biggest JavaScript SEO QA pain:",
      intent.pain,
      "",
      "Note: Email is intentionally omitted from this public issue body.",
    ].join("\n");
    state.lastRemoteBody = body;
    const params = new URLSearchParams({
      title: "JavaScript Rendering QA Briefs early-access request",
      body: body,
      labels: "early-access,purchase-intent,demo-request",
      template: "demo_request.md",
    });
    return GITHUB_ISSUE_URL + "?" + params.toString();
  }

  function setupWaitlist() {
    const form = qs("#waitlist-form");
    const status = qs("#waitlist-status");
    const handoff = qs("#handoff-panel");
    const remoteLink = qs("#remote-intent-link");
    const copyRequest = qs("#copy-request");
    const planSelect = qs("#plan");
    if (!form) return;

    form.addEventListener("focusin", function () {
      if (!state.signupStarted) {
        state.signupStarted = true;
        track("signup_started", { triggerSource: "waitlist_form" });
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (!state.signupStarted) {
        state.signupStarted = true;
        track("signup_started", { triggerSource: "waitlist_submit" });
      }
      const intent = {
        email: qs("#email") ? qs("#email").value.trim() : "",
        role: qs("#role") ? qs("#role").value : "",
        siteType: qs("#site-type-intent") ? qs("#site-type-intent").value : "",
        templateCount: qs("#template-count") ? qs("#template-count").value : "",
        plan: planSelect ? planSelect.value : "",
        budget: qs("#budget") ? qs("#budget").value : "",
        pain: qs("#pain") ? qs("#pain").value.trim() : "",
        purchaseIntent: qs("#purchase-intent") ? qs("#purchase-intent").checked : false,
        createdAt: new Date().toISOString(),
        utm: getUtm(),
      };
      const intents = readArray(INTENT_KEY);
      intents.push(intent);
      writeArray(INTENT_KEY, intents.slice(-100));

      const remoteHref = buildRemoteIssue(intent);
      if (remoteLink) remoteLink.href = remoteHref;
      if (handoff) {
        handoff.hidden = false;
        pulseClass(handoff, "is-confirmed", 700);
      }
      if (status) status.textContent = "You are on the early access list. Public-safe request details are ready.";

      track("waitlist_submitted", { role: intent.role, plan: intent.plan, templateCount: intent.templateCount });
      track("feedback_submitted", { triggerSource: "waitlist_form", painLength: intent.pain.length });
      track("remote_intent_ready", { hasRemoteLink: Boolean(remoteHref) });
      if (intent.purchaseIntent) track("checkout_intent", { plan: intent.plan, budget: intent.budget });
    });

    if (copyRequest) {
      copyRequest.addEventListener("click", function () {
        if (!state.lastRemoteBody) return;
        copyText(state.lastRemoteBody).then(function () {
          copyRequest.textContent = "Copied request details";
          pulseClass(copyRequest, "is-confirmed", 700);
          track("remote_intent_copied", { bodyLength: state.lastRemoteBody.length });
          window.setTimeout(function () { copyRequest.textContent = "Copy request details"; }, 1500);
        });
      });
    }
  }

  function setupPlanButtons() {
    const waitlist = qs("#waitlist");
    const planSelect = qs("#plan");
    qsa(".plan-button").forEach(function (button) {
      button.addEventListener("click", function () {
        const plan = button.getAttribute("data-plan") || "";
        if (planSelect && plan) planSelect.value = plan;
        track("pricing_viewed", { triggerSource: "plan_button" });
        state.pricingTracked = true;
        track("checkout_started", { plan: plan, triggerSource: "pricing_button" });
        pulseClass(button, "is-confirmed", 500);
        if (waitlist) waitlist.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function setupTracking() {
    track("landing_viewed", { product: "JavaScript Rendering QA Briefs" });
    qsa("[data-track-cta]").forEach(function (element) {
      element.addEventListener("click", function () {
        track("cta_clicked", { cta: element.getAttribute("data-track-cta") || element.textContent.trim() });
      });
    });
    const pricing = qs("#pricing");
    if (pricing && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !state.pricingTracked) {
            state.pricingTracked = true;
            track("pricing_viewed", { triggerSource: "scroll" });
            observer.disconnect();
          }
        });
      }, { threshold: 0.35 });
      observer.observe(pricing);
    }
  }

  function setupChrome() {
    const header = qs("[data-header]");
    if (!header) return;
    function updateHeader() {
      header.classList.toggle("is-scrolled", window.scrollY > 8);
    }
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  function setupReveal() {
    const elements = qsa(".reveal");
    if (!("IntersectionObserver" in window)) {
      elements.forEach(function (element) { element.classList.add("is-visible"); });
      return;
    }
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    elements.forEach(function (element) { observer.observe(element); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    setupTracking();
    setupChrome();
    setupReveal();
    setupAuditor();
    setupWaitlist();
    setupPlanButtons();
  });
}());
