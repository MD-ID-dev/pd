import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("planner publishing is scoped to approved campuses and units", () => {
  assert.match(source, /unauthorized-campus/);
  assert.match(source, /unauthorized-unit/);
  assert.match(source, /plannerAccount\.campuses\.includes\(draft\.campus\)/);
  assert.match(source, /plannerAccount\.units\.includes\(draft\.department\)/);
});

test("ambiguous multi-day schedules require an explicit interpretation", () => {
  assert.match(source, /scheduleInterpretation === "needs_review"/);
  assert.match(source, /Separate daily sessions/);
  assert.match(source, /One continuous multi-day event/);
  assert.match(source, /schedule-interpretation/);
});

test("capacity and RSVP guardrails prevent impossible inventory", () => {
  assert.match(source, /function nonnegativeCapacity/);
  assert.match(source, /preventNegativeCapacity/);
  assert.match(source, /option is full/);
  assert.match(source, /capacityModel === "Not applicable"/);
  assert.match(source, /event\.mode === "Online async" \|\| event\.capacityModel === "Unlimited" \|\| event\.capacityModel === "Not applicable"/);
  assert.match(source, /Capacity not listed/);
  assert.match(source, /Select campus or UH System/);
  assert.match(source, /campusOptions\.filter\(\(item\) => item !== "All campuses"\)/);
  assert.doesNotMatch(source, /defaultCampus={campus !== "All campuses" \? campus : ""}/);
  assert.match(source, /it does not have to match the event host/);
  assert.match(source, /Choose in-person or virtual attendance/);
  assert.match(source, /inert={showWelcome \|\| Boolean\(selected\)}/);
});

test("calendar exports protect session URLs and escape ICS values", () => {
  assert.match(source, /Secure online access in My RSVPs/);
  assert.match(source, /function downloadCalendar/);
  assert.match(source, /replaceAll\("\\\\", "\\\\\\\\"\)/);
  assert.match(source, /document\.body\.appendChild\(link\)/);
});

test("attendance and analytics use the selected event's draft registrations", () => {
  assert.match(source, /registeredForEvent\.find/);
  assert.match(source, /eventDurationMinutes\(selectedEvent\)/);
  assert.match(source, /eventRegistrations = registrations\.filter/);
  assert.match(source, /Live draft registrations \+ historical samples/);
});

test("faculty discovery retains the requested navigation safeguards", () => {
  assert.match(source, /Recognized as the listed topic/);
  assert.match(source, /Collapse all months/);
  assert.match(source, /2026-12-10/);
  assert.doesNotMatch(source, />Accessibility<\/button>/);
  assert.doesNotMatch(source, /placeholder="[^"]*\bTry\b/);
  assert.doesNotMatch(source, /<datalist id="event-search-suggestions"/);
  assert.doesNotMatch(source, /<input[^>]+list="event-search-suggestions"/);
  assert.match(source, /<details className="search-suggestion-menu">/);
  assert.match(source, /Show keyword suggestions/);
});

test("the public header is concise and support is available throughout the app", () => {
  assert.match(source, />Find events<\/a>/);
  assert.doesNotMatch(source, /<a href="#for-planners">For planners<\/a>/);
  assert.doesNotMatch(source, /<a href="#about">About<\/a>/);
  assert.match(source, />Planner Portal<\/button>/);
  assert.doesNotMatch(source, /Try planner portal/);
  assert.ok((source.match(/mailto:uhoic@hawaii\.edu/g) ?? []).length >= 2);
  assert.match(source, /Questions or technical problems/);
  assert.match(source, /portal-footer/);
  assert.match(styles, /footer-contact/);
  assert.match(styles, /portal-footer/);
});

test("the hero carousel covers every opportunity in the nearest upcoming month", () => {
  assert.match(source, /const featuredMonthKey = upcomingEvents\.some/);
  assert.match(source, /upcomingEvents\.filter\(\(event\) => event\.date\.startsWith\(featuredMonthKey\)\)/);
  assert.match(source, /setInterval\(\(\) => setHeroIndex/);
  assert.match(source, /7000/);
  assert.match(source, /Pause event carousel/);
  assert.match(source, /carousel-side-control previous/);
  assert.match(source, /carousel-side-control next/);
  assert.match(styles, /carousel-side-control \{[^}]*width:52px;[^}]*height:52px;/);
  assert.match(source, /prefers-reduced-motion: reduce/);
});

test("the public and planner headers use the official UH System mark", () => {
  assert.match(source, /function UhSystemMark/);
  assert.match(source, /system-seal\.jpg/);
  assert.match(source, /<strong>Professional Development Hub<\/strong>/);
  assert.match(source, /<div className="portal-brand"><UhSystemMark/);
});

test("public and planner event cards use compact campus identity chips", () => {
  assert.match(source, /function CampusIdentity/);
  assert.match(source, /function CampusSeal/);
  assert.match(source, /event-campus-chip/);
  assert.match(source, /<CampusIdentity campus={event\.campus} \/>/);
  assert.match(source, /event-card \$\{campusBrand\.className\}/);
  assert.match(source, /event-submeta/);
  assert.match(source, /audience-scope-text/);
  assert.doesNotMatch(source, /audience-scope-badge/);
  assert.doesNotMatch(source, /<span className="host-label">Hosted by<\/span>/);
  assert.match(styles, /event-campus-chip \{[^}]*border:0;[^}]*background:transparent;/);
  assert.match(styles, /background:var\(--campus-color,var\(--teal\)\)/);
  assert.match(source, /<CampusSeal campus={heroEvent\.campus} className="campus-seal" \/>/);
  assert.match(styles, /uh-updated-seal\.svg/);
  assert.match(styles, /campus-windward \{ --campus-color:#7ab800; \}/);
});

test("host-campus filtering is strict unless UH System inclusion is explicit", () => {
  assert.match(source, /Hosted by campus/);
  assert.match(source, /Also include UH System opportunities/);
  assert.match(source, /includeSystemEvents && campus !== "UH System" && event\.campus === "UH System" && isEventOpenToCampus/);
  assert.match(source, /UH System opportunities excluded/);
  assert.match(source, /function eventAudienceLabel/);
  assert.match(source, /Open to all UH campuses/);
});

test("UHOIC attribution distinguishes organizer sources from shared listings", () => {
  assert.match(source, /webinars-uhoic-hosted/);
  assert.match(source, /upcoming-events/);
  assert.match(source, /Shared listings page/);
  assert.match(source, /aggregator-host-conflict/);
  assert.match(source, /hostVerification === "Needs confirmation"/);
  assert.match(source, /campusEvidence = isUhoicSharedListingsSource \? hostLine/);
  assert.match(source, /event\.hostVerification !== "Needs confirmation"/);
  assert.match(source, /Innovation Playground: Fall ‘26 Updates: Gemini, NotebookLM, Vids/);
  assert.doesNotMatch(source, /Designing Accessible Courses in Lamakū/);
  assert.doesNotMatch(source, /Assessment Design with AI: Keeping Learning Visible/);
  assert.doesNotMatch(source, /Midyear Teaching Reflection & Course Tune-Up/);
});

test("event source management preserves provenance and unit-scoped review", () => {
  assert.match(source, /Event Sources/);
  assert.match(source, /Source Registry/);
  assert.match(source, /Field-level Review Queue/);
  assert.match(source, /Import and decision history/);
  assert.match(source, /plannerAccount\.units\.includes\(source\.ownerUnit\)/);
  assert.match(source, /Discovery source ≠ event host/);
  assert.match(source, /Shared listings never establish event ownership/);
  assert.match(source, /Host attribution/);
  assert.match(source, /Protected access URL/);
  assert.match(source, /Select all visible sources/);
  assert.match(source, /Archive replaces permanent deletion/);
  assert.match(source, /Test source/);
  assert.match(source, /Review all changes/);
  assert.match(source, /sourceRegistryStorageKey/);
  assert.doesNotMatch(source, /Delete source/);
  assert.match(styles, /source-registry-controls/);
  assert.match(styles, /source-value-compare/);
});

test("faculty discovery explains results and supports forgiving, time-zone clear discovery", () => {
  assert.match(source, /function forgivingTermMatch/);
  assert.match(source, /editDistance\(word, term\) <= 1/);
  assert.match(source, /a11y: \["accessibility"\]/);
  assert.match(source, /Shown because this UH System opportunity is open to/);
  assert.match(source, /whyShown=/);
  assert.match(source, /recentEventsStorageKey/);
  assert.match(source, /Recently viewed/);
  assert.match(source, /Optional starting campus/);
  assert.match(source, /emptyStateHint/);
  assert.ok((source.match(/HST/g) ?? []).length >= 8);
  assert.match(source, /What you’ll learn or practice/);
  assert.match(source, /Request an accommodation or access support/);
  assert.match(styles, /\.recently-viewed/);
  assert.match(styles, /\.why-shown/);
});

test("planner workflow consolidates action, readiness, evidence, and preview controls", () => {
  assert.match(source, /type PortalTab = "dashboard"/);
  assert.match(source, /function PlannerDashboard/);
  assert.match(source, /title="Planner overview"/);
  assert.match(source, /Action queue/);
  assert.match(source, /intakeTemplates/);
  assert.match(source, /Publication readiness/);
  assert.match(source, /Review linked field/);
  assert.match(source, /View as faculty/);
  assert.match(source, /Participant communications/);
  assert.match(source, /eventTitleSimilarity/);
  assert.match(source, /Version history &amp; undo/);
  assert.match(styles, /\.planner-dashboard-grid/);
  assert.match(styles, /\.readiness-navigator/);
  assert.match(styles, /\.communication-preview/);
});

test("planner portal stays complete while Smart Intake uses a direct fill-in form", () => {
  assert.match(source, /portal-nav-section">Everyday/);
  assert.match(source, /portal-nav-section">Advanced/);
  assert.match(source, /AI Smart Intake/);
  assert.match(source, /Website Sources/);
  assert.match(source, /const intakeFillInTemplate = `Title:/);
  assert.match(source, /Description:\nDate:\nTime:\nHost campus:\nHost unit:/);
  assert.match(source, /useState\(intakeFillInTemplate\)/);
  assert.match(source, /setRawText\(intakeFillInTemplate\)/);
  assert.match(source, /structuredLabelPattern/);
  assert.match(source, /structuredValue\("Title"\)/);
  assert.match(source, /Restore empty labels/);
  assert.doesNotMatch(source, /intakeFieldSuggestions/);
  assert.doesNotMatch(source, /insertSourceLabel/);
  assert.match(source, /portal-system-note/);
  assert.match(styles, /\.textarea-title-row/);
  assert.match(styles, /\.portal-nav-section/);
});

test("source and analytics pages expose data quality and production boundaries", () => {
  assert.match(source, /Field completeness/);
  assert.match(source, /Parser version/);
  assert.match(source, /Connection checks/);
  assert.match(source, /Data quality at a glance/);
  assert.match(source, /Operational monitoring/);
  assert.match(source, /ROI &amp; participation/);
  assert.match(source, /not simulated live services/);
  assert.match(styles, /\.source-quality-strip/);
  assert.match(styles, /\.analytics-data-quality/);
});
