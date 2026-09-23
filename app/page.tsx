"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Device persistence and accessible dialog/carousel state are hydrated after mount. */
/* eslint-disable @next/next/no-img-element -- Campus seals are supplied by UH brand sources and include a resilient fallback. */

import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";

type EventMode = "Online sync" | "Online async" | "In person" | "Hybrid";
type SyncProvider = "Zoom" | "Microsoft Teams" | "Google Meet" | "None";
type ListingVisibility = "Public" | "Unlisted" | "Private invitation";
type RosterVisibility = "Owner & collaborators" | "Owner unit" | "Campus data stewards";
type AnalyticsVisibility = "Event team" | "Owner unit" | "Campus aggregates" | "UH System aggregates";
type AudienceScope = "All UH campuses" | "Host campus only" | "Selected campuses";
type EventSourceType = "Organizer page" | "Shared listings page" | "Manual flyer or text";
type HostVerification = "Verified organizer source" | "Planner confirmed" | "Needs confirmation";
type ScheduleInterpretation = "not_applicable" | "needs_review" | "separate_sessions" | "continuous_event";
type PlannerProfile = { id: string; name: string; email: string; campus: string; campuses: string[]; units: string[]; role: string };
type SourceRelationship = "Organizer page" | "Shared listing" | "Campus calendar" | "RSS/API feed";
type SourceStatus = "Healthy" | "Review needed" | "Paused" | "Connection issue" | "Archived";
type ScanFrequency = "Manual" | "Daily" | "Weekly";
type SourceApprovalPolicy = "Review all changes" | "Review critical fields" | "Manual review only";

type EventSourceRecord = {
  id: string; name: string; url: string; relationship: SourceRelationship; ownerCampus: string; ownerUnit: string;
  frequency: ScanFrequency; approvalPolicy: SourceApprovalPolicy; status: SourceStatus; lastChecked: string; nextScan: string;
  importedEvents: number; pendingChanges: number; notes: string;
};

type SourceReviewRecord = {
  id: string; sourceId: string; eventTitle: string; field: "Host attribution" | "Start time" | "Location details" | "Protected access URL" | "Public event URL" | "Description";
  storedValue: string; detectedValue: string; detectedAt: string; severity: "Critical" | "Standard"; resolution: "Pending" | "Accepted" | "Kept manual";
};

type SourceAuditRecord = { id: string; sourceId: string; action: string; actor: string; timestamp: string };

const modeOptions: Array<{ value: EventMode; label: string }> = [
  { value: "Hybrid", label: "Hybrid (online & in-person)" },
  { value: "Online sync", label: "Online sync (live)" },
  { value: "Online async", label: "Online async (self-paced)" },
  { value: "In person", label: "In person (on campus)" },
];

function formatModeLabel(mode: EventMode) {
  return modeOptions.find((option) => option.value === mode)?.label ?? mode;
}

type EventItem = {
  id: number; date: string; month: string; day: string; weekday: string; time: string; endTime: string;
  title: string; summary: string; campus: string; department: string; mode: EventMode; location: string;
  tags: string[]; seats?: number; capacity?: number; virtualSeats?: number; virtualCapacity?: number;
  series?: string; sessionDates?: string[]; color: "teal" | "blue" | "gold" | "coral"; officialUrl?: string; accessUrl?: string;
  status?: "Published" | "Updated" | "Canceled"; updatedAt?: string;
  capacityModel?: "Limited" | "Unlimited" | "Waitlist only" | "Not applicable";
  listingVisibility?: ListingVisibility; rosterVisibility?: RosterVisibility; analyticsVisibility?: AnalyticsVisibility;
  collaborators?: string[]; provider?: SyncProvider; externalMeetingId?: string; providerStatus?: "Not connected" | "Ready" | "Synced" | "Needs review"; endDate?: string;
  audienceScope?: AudienceScope; eligibleCampuses?: string[]; sourceType?: EventSourceType; hostVerification?: HostVerification;
};

function eventAudienceLabel(event: EventItem) {
  const scope = event.audienceScope ?? (event.campus === "UH System" ? "All UH campuses" : "Host campus only");
  if (scope === "All UH campuses") return "Open to all UH campuses";
  if (scope === "Selected campuses") return `Open to ${event.eligibleCampuses?.length ?? 0} selected campuses`;
  return `Open to ${event.campus}`;
}

function eventSourceLinkLabel(event: EventItem) {
  return event.sourceType === "Shared listings page" ? "Shared event listing" : "Official host page";
}

function isEventOpenToCampus(event: EventItem, campus: string) {
  const scope = event.audienceScope ?? (event.campus === "UH System" ? "All UH campuses" : "Host campus only");
  return scope === "All UH campuses" || event.campus === campus || (scope === "Selected campuses" && Boolean(event.eligibleCampuses?.includes(campus)));
}

type RegistrationRecord = {
  eventId: number; name: string; email: string; campus?: string; attendance: string; waitlisted: boolean; registeredAt: string;
};

type AttendanceRecord = {
  id: string; name: string; email: string; minutes: number; percentage: number;
  status: "Attended" | "Partial" | "No show" | "Unmatched";
  matchMethod: "Registrant ID" | "Verified email" | "Manual review" | "No safe match";
  campus: string;
};

const uhoicName = "UH Online Innovation Center (UHOIC)";
const uhoicHostedPageUrl = "https://www.uhonline.hawaii.edu/uhoic/events-page/webinars-uhoic-hosted/";
const uhoicAllEventsPageUrl = "https://www.uhonline.hawaii.edu/uhoic/events-page/upcoming-events/";
const plannerProfiles: PlannerProfile[] = [
  { id: "uhwo", name: "M. Designer", email: "m.designer@hawaii.edu", campus: "UH West Oʻahu", campuses: ["UH West Oʻahu"], units: ["Campus Instructional Design Office"], role: "Approved contributor" },
  { id: "uhoic", name: "M. Designer", email: "m.designer@hawaii.edu", campus: "UH System", campuses: ["UH System"], units: [uhoicName], role: "Approved contributor" },
];

const initialEventSources: EventSourceRecord[] = [
  { id: "source-uhoic-hosted", name: "UHOIC Hosted Webinars", url: uhoicHostedPageUrl, relationship: "Organizer page", ownerCampus: "UH System", ownerUnit: uhoicName, frequency: "Daily", approvalPolicy: "Review critical fields", status: "Healthy", lastChecked: "Aug 24, 2026 · 6:15 AM", nextScan: "Aug 25 · 6:00 AM", importedEvents: 3, pendingChanges: 1, notes: "Authoritative evidence for events explicitly identified as UHOIC-hosted." },
  { id: "source-uhoic-upcoming", name: "UHOIC All Upcoming Events", url: uhoicAllEventsPageUrl, relationship: "Shared listing", ownerCampus: "UH System", ownerUnit: uhoicName, frequency: "Daily", approvalPolicy: "Review all changes", status: "Review needed", lastChecked: "Aug 24, 2026 · 6:18 AM", nextScan: "After review", importedEvents: 12, pendingChanges: 1, notes: "Discovery source only. The organizer must be verified from the individual event detail or flyer." },
  { id: "source-uhwo-id", name: "UH West Oʻahu Instructional Design Events", url: "https://westoahu.hawaii.edu/", relationship: "Organizer page", ownerCampus: "UH West Oʻahu", ownerUnit: "Campus Instructional Design Office", frequency: "Weekly", approvalPolicy: "Review all changes", status: "Review needed", lastChecked: "Aug 23, 2026 · 8:30 AM", nextScan: "After review", importedEvents: 4, pendingChanges: 1, notes: "Representative campus source for the Phase 2 source-management workflow." },
  { id: "source-its-training", name: "UH ITS Training", url: "https://www.hawaii.edu/its/", relationship: "Organizer page", ownerCampus: "UH System", ownerUnit: "Information Technology Services (ITS)", frequency: "Weekly", approvalPolicy: "Review critical fields", status: "Paused", lastChecked: "Aug 18, 2026 · 7:00 AM", nextScan: "Paused", importedEvents: 2, pendingChanges: 0, notes: "Paused while the source manager confirms the preferred training-calendar endpoint." },
];
const publicEventSources = initialEventSources.filter((source) => source.status !== "Archived");

const initialSourceReviews: SourceReviewRecord[] = [
  { id: "review-host-1", sourceId: "source-uhoic-upcoming", eventTitle: "Assessment Design with AI", field: "Host attribution", storedValue: uhoicName, detectedValue: "UH Mānoa Center for Teaching Excellence", detectedAt: "Aug 24 · 6:18 AM", severity: "Critical", resolution: "Pending" },
  { id: "review-time-1", sourceId: "source-uhoic-hosted", eventTitle: "Innovation Playground: Emerging Technologies", field: "Start time", storedValue: "10:00 AM", detectedValue: "10:30 AM", detectedAt: "Aug 24 · 6:15 AM", severity: "Critical", resolution: "Pending" },
  { id: "review-location-1", sourceId: "source-uhwo-id", eventTitle: "Creating Engaging Video Assignments in Lamakū", field: "Location details", storedValue: "B217 + Zoom", detectedValue: "C208 + Zoom", detectedAt: "Aug 23 · 8:30 AM", severity: "Critical", resolution: "Pending" },
];

const initialSourceAudits: SourceAuditRecord[] = [
  { id: "audit-1", sourceId: "source-uhoic-upcoming", action: "Host-attribution variance sent to review", actor: "Automated source monitor", timestamp: "Aug 24, 2026 · 6:18 AM" },
  { id: "audit-2", sourceId: "source-uhoic-hosted", action: "Daily scan completed; one critical change detected", actor: "Automated source monitor", timestamp: "Aug 24, 2026 · 6:15 AM" },
  { id: "audit-3", sourceId: "source-uhwo-id", action: "Source frequency changed from Daily to Weekly", actor: "M. Designer", timestamp: "Aug 20, 2026 · 2:40 PM" },
];

const initialEvents: EventItem[] = [
  { id: 1, date: "2026-09-25", month: "SEP", day: "25", weekday: "Friday", time: "10:00 AM", endTime: "11:00 AM", title: "Innovation Playground: Fall ‘26 Updates: Gemini, NotebookLM, Vids", summary: "Explore current Gemini, NotebookLM, and Google Vids features for instruction, student learning, content creation, and everyday productivity.", campus: "UH System", department: uhoicName, mode: "Online sync", location: "Zoom · link provided after RSVP", tags: ["Generative AI", "Productivity", "Active Learning"], capacityModel: "Not applicable", color: "teal", officialUrl: "https://www.uhonline.hawaii.edu/uhoic/events/innovation-playground-fall-26-updates-gemini-notebooklm-vids/", audienceScope: "All UH campuses", sourceType: "Organizer page", hostVerification: "Verified organizer source" },
  { id: 2, date: "2026-09-02", month: "SEP", day: "02", weekday: "Wednesday", time: "1:00 PM", endTime: "2:30 PM", title: "AI for Work: Build Your First Gemini Gem", summary: "Create a reusable AI collaborator for a real teaching, research, or administrative workflow.", campus: "UH Mānoa", department: "Center for Teaching Excellence", mode: "Hybrid", location: "Kuykendall 106 Events Room + Zoom", tags: ["Generative AI", "Productivity"], seats: 5, capacity: 24, virtualSeats: 26, virtualCapacity: 75, color: "blue" },
  { id: 3, date: "2026-09-11", month: "SEP", day: "11", weekday: "Friday", time: "9:00 AM", endTime: "12:00 PM", title: "Assessment for Learning Institute", summary: "A four-part series for designing transparent, authentic assessments with actionable feedback.", campus: "Leeward CC", department: "Faculty Senate PD", mode: "In person", location: "Learning Commons, Room 105", tags: ["Assessment", "Active Learning"], seats: 3, capacity: 28, series: "4-session series · RSVP once", sessionDates: ["2026-09-11", "2026-09-18", "2026-09-25", "2026-10-02"], color: "gold" },
  { id: 4, date: "2026-09-18", month: "SEP", day: "18", weekday: "Friday", time: "11:00 AM", endTime: "12:00 PM", title: "Small Teaching, Big Impact", summary: "Explore three evidence-based changes that improve engagement without redesigning your course.", campus: "UH Hilo", department: "Kilohana Academic Success Center", mode: "Online sync", location: "Zoom · link provided after RSVP", tags: ["Active Learning", "Assessment"], seats: 12, capacity: 35, color: "coral" },
  { id: 5, date: "2026-10-06", month: "OCT", day: "06", weekday: "Tuesday", time: "10:00 AM", endTime: "11:30 AM", title: "Creating Engaging Video Assignments in Lamakū", summary: "Design purposeful video activities with clear directions, accessible media, and meaningful student interaction.", campus: "UH West Oʻahu", department: "Campus Instructional Design Office", mode: "Hybrid", location: "B217 + Zoom", tags: ["Lamakū", "Active Learning"], seats: 9, capacity: 30, virtualSeats: 40, virtualCapacity: 80, color: "blue" },
  { id: 6, date: "2026-10-22", month: "OCT", day: "22", weekday: "Thursday", time: "1:00 PM", endTime: "2:30 PM", title: "Universal Design for Learning Studio", summary: "Apply practical UDL strategies to reduce barriers and give learners meaningful choices in one upcoming lesson.", campus: "Kapiʻolani CC", department: "Center for Excellence in Learning, Teaching and Technology", mode: "Online sync", location: "Zoom · link provided after RSVP", tags: ["Accessibility", "Active Learning"], seats: 34, capacity: 60, color: "teal" },
  { id: 7, date: "2026-10-23", month: "OCT", day: "23", weekday: "Friday", time: "10:00 AM", endTime: "11:00 AM", title: "Innovation Playground: Content Accessibility Checkers", summary: "Get hands-on with content accessibility checkers and explore practical ways to identify and address barriers in digital course materials.", campus: "UH System", department: uhoicName, mode: "Online sync", location: "Zoom · link provided after RSVP", tags: ["Accessibility", "Lamakū", "Active Learning"], capacityModel: "Not applicable", color: "coral", officialUrl: "https://www.uhonline.hawaii.edu/uhoic/events/innovation-playground-content-accessibility-checkers/", audienceScope: "All UH campuses", sourceType: "Organizer page", hostVerification: "Verified organizer source" },
  { id: 8, date: "2026-11-18", month: "NOV", day: "18", weekday: "Wednesday", time: "10:00 AM", endTime: "12:00 PM", title: "Open Educational Resources: Find, Adapt, Share", summary: "Locate openly licensed materials, evaluate quality, and adapt resources for an upcoming course or training.", campus: "Honolulu CC", department: "Faculty Development Center", mode: "In person", location: "Library Learning Commons, Room 201", tags: ["Accessibility", "Active Learning"], seats: 8, capacity: 32, color: "gold" },
  { id: 9, date: "2026-11-20", month: "NOV", day: "20", weekday: "Friday", time: "10:00 AM", endTime: "11:00 AM", title: "Innovation Playground: Emerging Technologies", summary: "Explore emerging technologies in a guided, low-pressure session focused on experimentation, practical possibilities, and peer exchange.", campus: "UH System", department: uhoicName, mode: "Online sync", location: "Zoom · link provided after RSVP", tags: ["Generative AI", "Active Learning"], capacityModel: "Not applicable", color: "teal", officialUrl: "https://www.uhonline.hawaii.edu/uhoic/events/innovation-playground-fall-2026-emerging-technologies/", audienceScope: "All UH campuses", sourceType: "Organizer page", hostVerification: "Verified organizer source" },
  { id: 10, date: "2026-12-10", month: "DEC", day: "10", weekday: "Thursday", time: "1:00 PM", endTime: "2:30 PM", title: "Data-Informed Course Improvement Lab", summary: "Turn course activity, assessment, and feedback data into a focused plan for improving student learning.", campus: "UH Hilo", department: "Kilohana Academic Success Center", mode: "Hybrid", location: "Mookini Library 123 + Zoom", tags: ["Assessment", "Active Learning"], seats: 10, capacity: 24, virtualSeats: 38, virtualCapacity: 60, color: "blue" },
];

const seededEventIds = new Set(initialEvents.map((event) => event.id));

function withEventDefaults(event: EventItem): EventItem {
  return {
    ...event,
    audienceScope: event.audienceScope ?? (event.campus === "UH System" ? "All UH campuses" : "Host campus only"),
    eligibleCampuses: event.eligibleCampuses ?? [],
    sourceType: event.sourceType ?? "Manual flyer or text",
    hostVerification: event.hostVerification ?? (event.department === uhoicName ? "Needs confirmation" : "Planner confirmed"),
  };
}

const campusOptions = ["All campuses", "UH System", "UH Mānoa", "UH Hilo", "UH West Oʻahu", "Hawaiʻi CC", "Honolulu CC", "Kapiʻolani CC", "Kauaʻi CC", "Leeward CC", "UH Maui College", "Windward CC"];
const topicOptions = ["All topics", "Accessibility", "Lamakū", "Generative AI", "Assessment", "Active Learning", "Productivity", "Other"];
const standardizedTopics = topicOptions.filter((topic) => topic !== "All topics" && topic !== "Other");
const campusUnitDirectory: Record<string, string[]> = {
  "UH System": [uhoicName, "Information Technology Services (ITS)", "Office of the Vice President for Community Colleges"],
  "UH Mānoa": ["Center for Teaching Excellence", "Office of Faculty Development and Academic Support"],
  "UH Hilo": ["Kilohana Academic Success Center", "Office of the Vice Chancellor for Academic Affairs"],
  "UH West Oʻahu": ["Campus Instructional Design Office", "Center for Teaching and Learning Excellence"],
  "Hawaiʻi CC": ["Academic Support Unit", "Faculty Development Committee"],
  "Honolulu CC": ["Faculty Development Center", "Academic Support Center"],
  "Kapiʻolani CC": ["Center for Excellence in Learning, Teaching and Technology", "Faculty Senate Professional Development"],
  "Kauaʻi CC": ["Teaching and Learning Center", "Faculty Development Committee"],
  "Leeward CC": ["Faculty Senate PD", "Educational Media Center"],
  "UH Maui College": ["Professional Development Committee", "Learning Center"],
  "Windward CC": ["Faculty Development Committee", "Library Learning Commons"],
};

function normalizeFilterText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function editDistance(left: string, right: string) {
  const rows = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let previous = rows[0];
    rows[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const saved = rows[rightIndex];
      rows[rightIndex] = Math.min(rows[rightIndex] + 1, rows[rightIndex - 1] + 1, previous + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return rows[right.length];
}

function forgivingTermMatch(searchable: string, term: string) {
  if (searchable.includes(term)) return true;
  if (term.length < 4) return false;
  return searchable.split(" ").some((word) => Math.abs(word.length - term.length) <= 1 && editDistance(word, term) <= 1);
}

function eventTitleSimilarity(left: string, right: string) {
  const leftWords = new Set(normalizeFilterText(left).split(" ").filter((word) => word.length > 2));
  const rightWords = new Set(normalizeFilterText(right).split(" ").filter((word) => word.length > 2));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  return shared / new Set([...leftWords, ...rightWords]).size;
}

function resolvePresetTopic(value: string) {
  const normalizedValue = normalizeFilterText(value);
  if (!normalizedValue) return undefined;
  return topicOptions.find((option) => option !== "All topics" && option !== "Other" && normalizeFilterText(option) === normalizedValue);
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(cell.trim()); cell = ""; }
    else cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

type AnalyticsEventRecord = {
  id: string; title: string; date: string; campus: string; department: string; mode: EventMode;
  status: "Upcoming" | "Past"; capacity: number; registered: number; attended?: number; waitlist: number;
  campusCounts: Record<string, number>; eventId?: number;
};

const analyticsEvents: AnalyticsEventRecord[] = [
  { id:"event-1", title:"Innovation Playground: Fall ‘26 Updates: Gemini, NotebookLM, Vids", date:"2026-09-25", campus:"UH System", department:uhoicName, mode:"Online sync", status:"Upcoming", capacity:0, registered:22, waitlist:0, campusCounts:{"UH Mānoa":7,"UH Hilo":3,"UH West Oʻahu":2,"Leeward CC":4,"Kapiʻolani CC":2,"Other UH campuses":4} },
  { id:"event-2", title:"AI for Work: Build Your First Gemini Gem", date:"2026-09-02", campus:"UH Mānoa", department:"Center for Teaching Excellence", mode:"Hybrid", status:"Upcoming", capacity:99, registered:68, waitlist:4, campusCounts:{"UH Mānoa":24,"UH Hilo":8,"UH West Oʻahu":7,"Leeward CC":9,"Kapiʻolani CC":8,"Other UH campuses":12} },
  { id:"event-3", title:"Assessment for Learning Institute", date:"2026-09-11", campus:"Leeward CC", department:"Faculty Senate PD", mode:"In person", status:"Upcoming", capacity:28, registered:25, waitlist:7, campusCounts:{"UH Mānoa":3,"UH Hilo":2,"UH West Oʻahu":2,"Leeward CC":13,"Kapiʻolani CC":3,"Other UH campuses":2} },
  { id:"event-4", title:"Small Teaching, Big Impact", date:"2026-09-18", campus:"UH Hilo", department:"Kilohana Academic Success Center", mode:"Online sync", status:"Upcoming", capacity:35, registered:23, waitlist:0, campusCounts:{"UH Mānoa":4,"UH Hilo":10,"UH West Oʻahu":2,"Leeward CC":2,"Kapiʻolani CC":2,"Other UH campuses":3} },
  { id:"event-5", title:"Creating Engaging Video Assignments in Lamakū", date:"2026-10-06", campus:"UH West Oʻahu", department:"Campus Instructional Design Office", mode:"Hybrid", status:"Upcoming", capacity:110, registered:61, waitlist:0, campusCounts:{"UH Mānoa":15,"UH Hilo":6,"UH West Oʻahu":14,"Leeward CC":8,"Kapiʻolani CC":7,"Other UH campuses":11} },
  { id:"event-101", title:"Creator+, H5P, and Lumi Showcase", date:"2026-05-01", campus:"UH System", department:uhoicName, mode:"Online sync", status:"Past", capacity:100, registered:86, attended:71, waitlist:0, campusCounts:{"UH Mānoa":24,"UH Hilo":12,"UH West Oʻahu":9,"Leeward CC":15,"Kapiʻolani CC":14,"Other UH campuses":12} },
  { id:"event-102", title:"AI for Teaching: Practical First Steps", date:"2026-05-07", campus:"UH Mānoa", department:"Center for Teaching Excellence", mode:"Hybrid", status:"Past", capacity:70, registered:64, attended:52, waitlist:9, campusCounts:{"UH Mānoa":29,"UH Hilo":7,"UH West Oʻahu":6,"Leeward CC":8,"Kapiʻolani CC":6,"Other UH campuses":8} },
  { id:"event-103", title:"Lamakū Course Tune-Up", date:"2026-06-12", campus:"Leeward CC", department:"Faculty Senate PD", mode:"In person", status:"Past", capacity:48, registered:42, attended:36, waitlist:2, campusCounts:{"UH Mānoa":6,"UH Hilo":4,"UH West Oʻahu":4,"Leeward CC":19,"Kapiʻolani CC":5,"Other UH campuses":4} },
];

const analyticsCampuses = ["UH Mānoa", "UH Hilo", "UH West Oʻahu", "Leeward CC", "Kapiʻolani CC"];
const rosterNames = ["K. Aki", "N. Wong", "P. Silva", "L. Kim", "R. Santos"];

function formatAnalyticsDate(date: string) {
  return new Intl.DateTimeFormat("en-US", { month:"short", day:"numeric", year:"numeric", timeZone:"UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function formatEventDateRange(event: EventItem) {
  return event.endDate && event.endDate !== event.date
    ? `${formatAnalyticsDate(event.date)}–${formatAnalyticsDate(event.endDate)}`
    : formatAnalyticsDate(event.date);
}

function getHawaiiMonthKey() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Honolulu", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function getHawaiiDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Honolulu", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

const presentMonthKey = getHawaiiMonthKey();
const presentDateKey = getHawaiiDateKey();
const welcomeStorageKey = "uh-pd-welcome-seen-v1";
const registrationStorageKey = "uh-pd-registrations-v1";
const eventStorageKey = "uh-pd-events-v2";
const preferenceStorageKey = "uh-pd-filter-preferences-v1";
const draftStorageKey = "uh-pd-planner-draft-v1";
const sourceRegistryStorageKey = "uh-pd-event-sources-v1";
const recentEventsStorageKey = "uh-pd-recent-events-v1";
const siteBaseUrl = "https://uh-professional-development-hub.md21x8.chatgpt.site";
const campusSealUrl = "/system-seal.jpg";

const campusBrands: Record<string, { className: string; label: string }> = {
  "UH System": { className: "campus-system", label: "UH System" },
  "UH Mānoa": { className: "campus-manoa", label: "UH Mānoa" },
  "UH Hilo": { className: "campus-hilo", label: "UH Hilo" },
  "UH West Oʻahu": { className: "campus-west-oahu", label: "UH West Oʻahu" },
  "Honolulu CC": { className: "campus-honolulu", label: "Honolulu Community College" },
  "Hawaiʻi CC": { className: "campus-hawaii", label: "Hawaiʻi Community College" },
  "Kapiʻolani CC": { className: "campus-kapiolani", label: "Kapiʻolani Community College" },
  "Kauaʻi CC": { className: "campus-kauai", label: "Kauaʻi Community College" },
  "Leeward CC": { className: "campus-leeward", label: "Leeward Community College" },
  "UH Maui College": { className: "campus-maui", label: "University of Hawaiʻi Maui College" },
  "Windward CC": { className: "campus-windward", label: "Windward Community College" },
};

function formatMonthLabel(monthKey: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${monthKey}-01T12:00:00Z`));
}

function slugify(value: string) {
  return normalizeFilterText(value).replaceAll(" ", "-");
}

function eventSlug(event: EventItem) {
  return `${event.date}-${slugify(event.title)}`;
}

function eventPermalink(event: EventItem) {
  return `${siteBaseUrl}/?event=${eventSlug(event)}`;
}

function UhSystemMark() {
  return <span className="brand-mark uh-system-mark" aria-hidden="true"><span>UH</span><img src={campusSealUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /></span>;
}

function CampusSeal({ campus, className }: { campus: string; className: string }) {
  const brand = campusBrands[campus] ?? campusBrands["UH System"];
  return <span className={`${className} authentic-campus-seal ${brand.className}`} aria-hidden="true"><span>UH</span></span>;
}

function CampusIdentity({ campus }: { campus: string }) {
  const campusName = campus || "Campus not selected";
  const brand = campusBrands[campus] ?? campusBrands["UH System"];
  return (
    <span className={`event-campus-chip ${brand.className}`}>
      <CampusSeal campus={campus} className="event-campus-seal" />
      <strong>{campusName}</strong>
    </span>
  );
}

function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getEventStatus(event: EventItem) {
  if (event.status === "Canceled") return { label: "Canceled", className: "canceled" };
  if (event.status === "Updated") return { label: "Recently updated", className: "updated" };
  if (event.capacityModel === "Waitlist only") return { label: "Waitlist only", className: "almost-full" };
  const capacity = getCapacityDetails(event);
  if (capacity.low && event.mode === "Hybrid") {
    const inPersonLow = nonnegativeCapacity(event.seats) <= 5;
    const virtualLow = nonnegativeCapacity(event.virtualSeats) <= 5;
    return { label: inPersonLow && virtualLow ? "Both options nearly full" : inPersonLow ? "In-person nearly full" : "Virtual nearly full", className: "almost-full" };
  }
  if (capacity.low && event.mode !== "Online async") return { label: "Almost full", className: "almost-full" };
  return null;
}

function nonnegativeCapacity(value: number | undefined) {
  return Math.max(0, value ?? 0);
}

function modeClass(mode: EventMode) {
  return mode.toLowerCase().replaceAll(" ", "-");
}

function getTimePeriod(event: EventItem) {
  if (event.mode === "Online async") return "Anytime";
  const match = event.time.match(/^(\d+):/);
  const hour = match ? Number(match[1]) % 12 + (event.time.includes("PM") ? 12 : 0) : 12;
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

function getCapacityDetails(event: EventItem) {
  const seatsOpen = nonnegativeCapacity(event.seats);
  const virtualSeatsOpen = nonnegativeCapacity(event.virtualSeats);
  if (event.capacityModel === "Unlimited") return { primary: "Unlimited registration", secondary: "No seat cap", low: false };
  if (event.capacityModel === "Waitlist only") return { primary: "Waitlist only", secondary: "Registrants will be notified if space opens", low: true };
  if (event.capacityModel === "Not applicable") return { primary: "Capacity not listed", secondary: "Registration remains available", low: false };
  if (event.mode === "Online async") return { primary: "Open enrollment", secondary: "Complete on your schedule", low: false };
  if (event.mode === "Online sync") return { primary: seatsOpen === 0 ? "Virtual waitlist available" : `${seatsOpen} virtual seats open`, secondary: event.capacity ? `${event.capacity} total capacity` : "", low: seatsOpen <= 5 };
  if (event.mode === "Hybrid") return { primary: seatsOpen === 0 ? "In-person waitlist available" : `${seatsOpen} in-person seats open`, secondary: virtualSeatsOpen === 0 ? "Virtual waitlist available" : `${virtualSeatsOpen} virtual seats open`, low: seatsOpen <= 5 || virtualSeatsOpen <= 5 };
  return { primary: seatsOpen === 0 ? "Waitlist available" : seatsOpen <= 5 ? `Only ${seatsOpen} seats left` : `${seatsOpen} of ${nonnegativeCapacity(event.capacity)} seats open`, secondary: "", low: seatsOpen <= 5 };
}

function availabilitySortScore(event: EventItem) {
  if (event.capacityModel === "Unlimited" || event.capacityModel === "Not applicable" || event.mode === "Online async") return 1_000_000;
  if (event.capacityModel === "Waitlist only") return -1;
  return nonnegativeCapacity(event.seats) + nonnegativeCapacity(event.virtualSeats);
}

function eventDurationMinutes(event: EventItem) {
  const parse = (time: string) => {
    const match = time.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return 90;
    let hour = Number(match[1]) % 12;
    if (match[3].toUpperCase() === "PM") hour += 12;
    return hour * 60 + Number(match[2]);
  };
  const daySpan = event.endDate ? Math.max(0, Math.round((new Date(`${event.endDate}T12:00:00Z`).getTime() - new Date(`${event.date}T12:00:00Z`).getTime()) / 86_400_000)) : 0;
  const duration = daySpan * 24 * 60 + parse(event.endTime) - parse(event.time);
  return duration > 0 ? duration : duration + 24 * 60;
}

type DraftIssue = { id: string; severity: "blocker" | "review"; message: string };

type EventDraft = {
  title: string; description: string; startDateTime: string; endDateTime: string;
  campus: string; department: string; mode: EventMode; location: string;
  inPersonCapacity: number; virtualCapacity: number; tags: string[];
  officialUrl: string; accessUrl: string;
  capacityModel: "Limited" | "Unlimited" | "Waitlist only" | "Not applicable";
  seriesDates: string[]; confidence: Record<string, "High" | "Review">;
  sourceEvidence: Array<{ field: string; excerpt: string }>;
  sourceEventId?: number;
  scheduleInterpretation: ScheduleInterpretation;
  listingVisibility: ListingVisibility; rosterVisibility: RosterVisibility; analyticsVisibility: AnalyticsVisibility;
  collaborators: string[]; provider: SyncProvider; externalMeetingId: string;
  audienceConfirmed: boolean; audienceScope: AudienceScope; eligibleCampuses: string[];
  sourceType: EventSourceType; hostVerification: HostVerification; sourceIssues: DraftIssue[];
};

const monthNumbers: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };

function toTwentyFourHour(time: string, period: string) {
  const [hourText, minute = "00"] = time.split(":");
  let hour = Number(hourText) % 12;
  if (period.toUpperCase() === "PM") hour += 12;
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function extractMeetingId(url: string, provider: SyncProvider = "Zoom") {
  if (!url) return "";
  if (provider === "Zoom") return url.match(/zoom\.us\/(?:j|wc)\/(\d+)/i)?.[1] ?? "";
  if (provider === "Google Meet") return url.match(/meet\.google\.com\/([a-z-]+)/i)?.[1] ?? "";
  if (provider === "Microsoft Teams") return url.match(/19%3ameeting_([^@/?]+)/i)?.[1] ?? "";
  return "";
}

function parseEventText(rawText: string): EventDraft {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const structuredLabelPattern = /^(title|description|date|time|host campus|host unit|format|location(?:\/access)?|capacity|audience|topics?|event page)\s*:/i;
  const structuredLine = (...labels: string[]) => lines.find((line) => labels.some((label) => line.toLowerCase().startsWith(`${label.toLowerCase()}:`))) ?? "";
  const structuredValue = (...labels: string[]) => {
    const line = structuredLine(...labels);
    return line ? line.slice(line.indexOf(":") + 1).trim() : "";
  };
  const title = structuredValue("Title") || lines.find((line) => !structuredLabelPattern.test(line)) || "";
  const structuredDescription = structuredValue("Description");
  const structuredHostCampus = structuredValue("Host campus");
  const structuredHostUnit = structuredValue("Host unit");
  const structuredLocation = structuredValue("Location/access", "Location");
  const lowered = rawText.toLowerCase();
  const isUhoicHostedSource = lowered.includes(uhoicHostedPageUrl.toLowerCase()) || /webinars\s*\(uhoic-hosted\)|upcoming webinars\s*\(uhoic-hosted\)/i.test(rawText);
  const isUhoicSharedListingsSource = lowered.includes(uhoicAllEventsPageUrl.toLowerCase()) || /#?\s*all upcoming events/i.test(rawText);
  const sourceType: EventSourceType = isUhoicHostedSource ? "Organizer page" : isUhoicSharedListingsSource ? "Shared listings page" : "Manual flyer or text";
  const mode: EventMode = /async|asynchronous|self[- ]paced|on demand/.test(lowered) ? "Online async" : /hybrid/.test(lowered) ? "Hybrid" : /zoom|online|virtual/.test(lowered) ? "Online sync" : "In person";
  const writtenDateMatches = Array.from(rawText.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})/gi));
  const numericDateMatches = Array.from(rawText.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g));
  const defaultYear = rawText.match(/\b(20\d{2})\b/)?.[1] ?? "";
  const monthToken = /(January|February|March|April|May|June|July|August|September|October|November|December)/i;
  const groupedWrittenDates = lines.flatMap((line) => {
    if (!monthToken.test(line) || !defaultYear) return [];
    const parts = line.split(new RegExp(`(${Object.keys(monthNumbers).join("|")})`, "i"));
    const parsed: string[] = [];
    for (let index = 1; index < parts.length; index += 2) {
      const monthName = parts[index].toLowerCase();
      const dateSegment = (parts[index + 1] ?? "").split(/\bfrom\b|\bat\b|\b\d{1,2}:\d{2}/i)[0].replace(/20\d{2}/g, "");
      const days = dateSegment.match(/\b\d{1,2}\b/g)?.map(Number).filter((day) => day >= 1 && day <= 31) ?? [];
      days.forEach((day) => parsed.push(`${defaultYear}-${monthNumbers[monthName]}-${String(day).padStart(2, "0")}`));
    }
    return parsed;
  });
  const seriesDates = Array.from(new Set([
    ...writtenDateMatches.map((match) => `${match[3]}-${monthNumbers[match[1].toLowerCase()]}-${String(Number(match[2])).padStart(2, "0")}`),
    ...numericDateMatches.map((match) => `${match[3]}-${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`),
    ...groupedWrittenDates,
  ])).sort();
  const date = seriesDates[0] ?? "";
  const timeMatch = rawText.match(/(\d{1,2}:\d{2})\s*(AM|PM)?\s*(?:–|—|-)\s*(\d{1,2}:\d{2})\s*(AM|PM)/i);
  const startPeriod = timeMatch?.[2] || timeMatch?.[4] || "AM";
  const startDateTime = date ? `${date}T${timeMatch ? toTwentyFourHour(timeMatch[1], startPeriod) : mode === "Online async" ? "00:00" : ""}`.replace(/T$/, "") : "";
  const endDateTime = date ? `${date}T${timeMatch ? toTwentyFourHour(timeMatch[3], timeMatch[4]) : mode === "Online async" ? "23:59" : ""}`.replace(/T$/, "") : "";
  const campusNames = campusOptions.filter((item) => item !== "All campuses");
  const hostLine = lines.find((line) => /^hosted by/i.test(line));
  const campusEvidence = isUhoicSharedListingsSource ? hostLine ?? structuredHostCampus : structuredHostCampus || rawText;
  const campus = campusNames.find((item) => campusEvidence.toLowerCase().includes(item.toLowerCase())) ?? (isUhoicHostedSource || (!isUhoicSharedListingsSource && /system[- ]wide/i.test(rawText)) ? "UH System" : "");
  const hostOwner = hostLine?.replace(/^hosted by\s+(the\s+)?/i, "").trim() ?? "";
  const extractedDepartment = campus ? hostOwner.replace(new RegExp(campus.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").trim() : hostOwner;
  const department = structuredHostUnit || extractedDepartment || (isUhoicHostedSource ? uhoicName : "");
  const hostVerification: HostVerification = (isUhoicHostedSource && department === uhoicName) || Boolean(hostLine && department) ? "Verified organizer source" : "Needs confirmation";
  const audienceScope: AudienceScope = /across the UH system|all UH campuses|system[- ]wide/i.test(rawText) || isUhoicHostedSource ? "All UH campuses" : "Host campus only";
  const metadataPattern = /^(title:|description:|date:|time:|host campus:|host unit:|format:|location(?:\/access)?:|event page:|audience:|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hosted by|topics?:|capacity:|faculty|staff|hybrid:|online|in[- ]person|f2f)/i;
  const description = structuredDescription || (lines.slice(1).find((line) => !metadataPattern.test(line) && !/(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d/i.test(line) && !/\d+\s+(in[- ]person|virtual)?\s*seats?/i.test(line)) ?? "");
  const urls = (rawText.match(/https?:\/\/[^\s<>)]+/gi) ?? []).map((url) => url.replace(/[.,;!?]+$/, ""));
  const eventPageUrl = structuredValue("Event page").match(/https?:\/\/[^\s<>)]+/i)?.[0]?.replace(/[.,;!?]+$/, "") ?? "";
  const accessUrl = urls.find((url) => url !== eventPageUrl && /zoom|teams|meet|brightspace|lamaku|lms/i.test(url)) ?? "";
  const officialUrl = eventPageUrl || urls.find((url) => url !== accessUrl) || "";
  const locationLine = structuredLine("Location/access", "Location") || lines.find((line) => /zoom|room\s*\d|hybrid:|online sync|in[- ]person:|f2f:|learning commons|events room/i.test(line)) || "";
  const cleanedLocation = (structuredLocation || locationLine).replace(/https?:\/\/[^\s<>)]+/gi, "").replace(/^(location(?:\/access)?|hybrid|online sync|online async|online|in[- ]person|f2f)\s*:?\s*/i, "").replace(/\s{2,}/g, " ").trim();
  const location = cleanedLocation || (mode === "Online async" ? "Online self-paced course" : mode === "Online sync" ? "Live online session" : "");
  const inPersonMatch = rawText.match(/(-?\d+)\s*in[- ]person\s*seats?/i);
  const virtualMatch = rawText.match(/(-?\d+)\s*virtual\s*seats?/i);
  const genericCapacity = rawText.match(/capacity\s*:\s*(-?\d+)/i);
  const inPersonCapacity = Math.max(0, Number(inPersonMatch?.[1] ?? (mode === "In person" ? genericCapacity?.[1] : 0) ?? 0));
  const virtualCapacity = Math.max(0, Number(virtualMatch?.[1] ?? (mode === "Online sync" ? genericCapacity?.[1] : 0) ?? 0));
  const capacityModel: EventDraft["capacityModel"] = mode === "Online async" ? "Not applicable" : /unlimited|open enrollment|no seat cap/i.test(rawText) ? "Unlimited" : /waitlist only|waitlist opens/i.test(rawText) ? "Waitlist only" : "Limited";
  const tagMatch = rawText.match(/topics?\s*:\s*(.+)/i);
  const tags = tagMatch ? tagMatch[1].split(",").map((tag) => tag.trim()).filter(Boolean) : standardizedTopics.filter((tag) => lowered.includes(tag.toLowerCase()));
  const sourceIssues: DraftIssue[] = [];
  if (/(?:capacity\s*:\s*|\b)-\d+|[-−]\d+\s+(?:in[- ]person|virtual)?\s*seats?/i.test(rawText)) sourceIssues.push({ id: "negative-capacity-normalized", severity: "review", message: "A negative capacity was found and normalized to 0. Confirm the intended nonnegative value or choose Waitlist only." });
  if (/\bclick here\b/i.test(rawText)) sourceIssues.push({ id: "nondescriptive-link", severity: "blocker", message: "Replace “click here” with descriptive link text in the source." });
  if (/(image|graphic|flyer)/i.test(rawText) && !/alt text|image description/i.test(rawText)) sourceIssues.push({ id: "missing-alt", severity: "blocker", message: "Add an image description or alt-text note for the flyer or graphic." });
  if ((mode === "Online sync" || mode === "Hybrid") && !accessUrl) sourceIssues.push({ id: "missing-access-link", severity: "review", message: "Add the protected Zoom or meeting URL before reminder emails are sent." });
  if (isUhoicSharedListingsSource) sourceIssues.push({ id: "shared-listing-source", severity: "review", message: "The UHOIC All Upcoming Events page is a distribution source. Confirm the actual campus and organizing unit from the event detail or flyer." });
  if (isUhoicSharedListingsSource && department === uhoicName && hostVerification === "Needs confirmation") sourceIssues.push({ id: "aggregator-host-conflict", severity: "blocker", message: "A listing on the UHOIC All Upcoming Events page does not establish UHOIC as the host. Select the organizer named on the event detail or flyer." });
  const hasAmbiguousRange = seriesDates.length > 1 && /(?:\d{1,2}\/\d{1,2}(?:\/20\d{2})?|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*20\d{2})?)\s*(?:–|—|-)\s*(?:\d{1,2}(?:\/\d{1,2}(?:\/20\d{2})?)?|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*20\d{2})?)/i.test(rawText);
  const scheduleInterpretation: ScheduleInterpretation = seriesDates.length <= 1 ? "not_applicable" : hasAmbiguousRange ? "needs_review" : "separate_sessions";
  if (seriesDates.length > 1) sourceIssues.push({ id: "series-detected", severity: hasAmbiguousRange ? "blocker" : "review", message: hasAmbiguousRange ? "Confirm whether the date range means separate daily sessions or one continuous multi-day event." : `${seriesDates.length} session dates were detected. Confirm the parent series and each child session.` });
  const confidence: EventDraft["confidence"] = {
    title: title ? "High" : "Review", description: description ? "High" : "Review", schedule: date && (timeMatch || mode === "Online async") ? "High" : "Review",
    campus: campus ? "High" : "Review", department: hostVerification === "Verified organizer source" ? "High" : "Review", mode: /async|hybrid|zoom|online|virtual|in[- ]person|f2f/i.test(rawText) ? "High" : "Review",
    location: locationLine ? "High" : "Review", capacity: capacityModel !== "Limited" || inPersonCapacity > 0 || virtualCapacity > 0 ? "High" : "Review", links: urls.length > 0 ? "High" : "Review",
  };
  const sourceEvidence = [
    { field: "Title", excerpt: title },
    { field: "Schedule", excerpt: lines.find((line) => /\d{4}|\d{1,2}:\d{2}/.test(line)) ?? "No clear source line found" },
    { field: "Format & location", excerpt: locationLine || structuredLine("Format") || "No clear source line found" },
    { field: "Host", excerpt: hostLine || [structuredHostCampus, structuredHostUnit].filter(Boolean).join(" · ") || "No clear source line found" },
    { field: "Source relationship", excerpt: sourceType === "Shared listings page" ? "Shared event listing—not organizer evidence" : sourceType },
    { field: "Capacity", excerpt: lines.find((line) => /capacity|seats?|unlimited|waitlist/i.test(line)) ?? "No clear source line found" },
  ];
  const provider: SyncProvider = mode === "Online sync" || mode === "Hybrid" ? /teams\.microsoft/i.test(accessUrl) ? "Microsoft Teams" : /meet\.google/i.test(accessUrl) ? "Google Meet" : "Zoom" : "None";
  return { title, description, startDateTime, endDateTime, campus, department, mode, location, inPersonCapacity, virtualCapacity, officialUrl, accessUrl, capacityModel, seriesDates, scheduleInterpretation, confidence, sourceEvidence, tags, listingVisibility: "Public", rosterVisibility: "Owner & collaborators", analyticsVisibility: "Owner unit", collaborators: [], provider, externalMeetingId: extractMeetingId(accessUrl, provider), audienceConfirmed: /faculty|instructors?|staff/i.test(rawText), audienceScope, eligibleCampuses: [], sourceType, hostVerification, sourceIssues };
}

function withDraftDefaults(draft: EventDraft): EventDraft {
  return {
    ...draft,
    scheduleInterpretation: draft.scheduleInterpretation ?? (draft.seriesDates?.length > 1 ? "separate_sessions" : "not_applicable"),
    listingVisibility: draft.listingVisibility ?? "Public",
    rosterVisibility: draft.rosterVisibility ?? "Owner & collaborators",
    analyticsVisibility: draft.analyticsVisibility ?? "Owner unit",
    collaborators: draft.collaborators ?? [],
    provider: draft.provider ?? (draft.mode === "Online sync" || draft.mode === "Hybrid" ? "Zoom" : "None"),
    externalMeetingId: draft.externalMeetingId ?? "",
    audienceScope: draft.audienceScope ?? (draft.campus === "UH System" ? "All UH campuses" : "Host campus only"),
    eligibleCampuses: draft.eligibleCampuses ?? [],
    sourceType: draft.sourceType ?? "Manual flyer or text",
    hostVerification: draft.hostVerification ?? "Needs confirmation",
  };
}

function getDraftIssues(draft: EventDraft) {
  const issues = draft.sourceIssues.filter((issue) => issue.id !== "series-detected" && !(issue.id === "missing-access-link" && draft.accessUrl) && !(issue.id === "aggregator-host-conflict" && draft.department !== uhoicName));
  if (!draft.title.trim()) issues.push({ id: "title", severity: "blocker", message: "Add an event title." });
  if (!draft.description.trim()) issues.push({ id: "description", severity: "blocker", message: "Add a concise description of what participants will learn or do." });
  if (!draft.startDateTime || !draft.endDateTime) issues.push({ id: "date-time", severity: "blocker", message: "Confirm both the start and end date/time." });
  else if (draft.endDateTime <= draft.startDateTime) issues.push({ id: "date-order", severity: "blocker", message: "End date/time must be after the start date/time." });
  if (!draft.campus) issues.push({ id: "campus", severity: "blocker", message: "Select the host campus or UH System." });
  if (!draft.department.trim()) issues.push({ id: "department", severity: "blocker", message: "Select or enter the institutional owner unit." });
  if (draft.hostVerification === "Needs confirmation") issues.push({ id: "host-verification", severity: "blocker", message: "Confirm that the selected campus and unit actually host this event—not merely advertise it on a shared listings page." });
  if (draft.sourceType === "Shared listings page" && draft.department === uhoicName && draft.hostVerification === "Needs confirmation") issues.push({ id: "aggregator-host-conflict", severity: "blocker", message: "Do not assign UHOIC solely because the event appeared on its All Upcoming Events page. Verify the organizer from the event detail or flyer." });
  if (draft.audienceScope === "Selected campuses" && draft.eligibleCampuses.length === 0) issues.push({ id: "eligible-campuses", severity: "blocker", message: "Select at least one campus that may attend." });
  if (!draft.location.trim()) issues.push({ id: "location", severity: "blocker", message: "Add the public room or access description." });
  else if (/\b(pending|tbd|to be determined)\b/i.test(draft.location)) issues.push({ id: "location-pending", severity: "blocker", message: "Replace the pending location or access details before publishing." });
  if (draft.officialUrl && !/^https:\/\//i.test(draft.officialUrl)) issues.push({ id: "official-url", severity: "blocker", message: "The official event page must use a secure https:// URL." });
  if (draft.accessUrl && !/^https:\/\//i.test(draft.accessUrl)) issues.push({ id: "access-url", severity: "blocker", message: "The protected access link must use a secure https:// URL." });
  if ((draft.mode === "Online sync" || draft.mode === "Hybrid") && !draft.accessUrl) issues.push({ id: "missing-access-link", severity: "review", message: "Add the protected live-session URL before reminder emails are sent." });
  if ((draft.mode === "Online sync" || draft.mode === "Hybrid") && draft.provider === "None") issues.push({ id: "sync-provider", severity: "review", message: "Choose Zoom, Microsoft Teams, or Google Meet to automate attendance—or plan a CSV import." });
  if (draft.provider !== "None" && !draft.externalMeetingId.trim()) issues.push({ id: "external-meeting-id", severity: "review", message: `Add the ${draft.provider} meeting ID when it is available to enable attendance syncing.` });
  if (draft.scheduleInterpretation === "needs_review") issues.push({ id: "schedule-interpretation", severity: "blocker", message: "Confirm how the multi-day date range should be scheduled." });
  if (draft.capacityModel === "Limited" && draft.mode !== "Online async" && draft.inPersonCapacity + draft.virtualCapacity === 0) issues.push({ id: "limited-capacity", severity: "review", message: "Limited registration currently has zero seats. Choose Waitlist only or enter a capacity." });
  if (!draft.audienceConfirmed) issues.push({ id: "audience", severity: "blocker", message: "Confirm this opportunity is only for UH faculty, instructors, or staff." });
  return Array.from(new Map(issues.map((issue) => [issue.id, issue])).values());
}

function formatDraftTime(dateTime: string) {
  const time = dateTime.split("T")[1] || "00:00";
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`;
}

function eventFromDraft(draft: EventDraft): EventItem {
  const date = draft.startDateTime.slice(0, 10);
  const dateValue = new Date(`${date}T12:00:00Z`);
  const isVirtualOnly = draft.mode === "Online sync";
  return {
    id: draft.sourceEventId ?? Date.now(), date,
    month: new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(dateValue).toUpperCase(),
    day: String(dateValue.getUTCDate()).padStart(2, "0"),
    weekday: new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(dateValue),
    time: formatDraftTime(draft.startDateTime), endTime: formatDraftTime(draft.endDateTime),
    title: draft.title.trim(), summary: draft.description.trim(), campus: draft.campus, department: draft.department.trim(), mode: draft.mode, location: draft.location.trim(), tags: draft.tags,
    officialUrl: draft.officialUrl || undefined, accessUrl: draft.accessUrl || undefined, capacityModel: draft.capacityModel,
    listingVisibility: draft.listingVisibility, rosterVisibility: draft.rosterVisibility, analyticsVisibility: draft.analyticsVisibility,
    collaborators: draft.collaborators, provider: draft.provider, externalMeetingId: draft.externalMeetingId || undefined, providerStatus: draft.externalMeetingId ? "Ready" : "Not connected", endDate: draft.scheduleInterpretation === "continuous_event" ? draft.endDateTime.slice(0, 10) : undefined,
    audienceScope: draft.audienceScope, eligibleCampuses: draft.eligibleCampuses, sourceType: draft.sourceType, hostVerification: draft.hostVerification,
    seats: draft.capacityModel !== "Limited" ? undefined : isVirtualOnly ? draft.virtualCapacity : draft.mode === "Online async" ? undefined : draft.inPersonCapacity,
    capacity: draft.capacityModel !== "Limited" ? undefined : isVirtualOnly ? draft.virtualCapacity : draft.mode === "Online async" ? undefined : draft.inPersonCapacity,
    virtualSeats: draft.capacityModel === "Limited" && draft.mode === "Hybrid" ? draft.virtualCapacity : undefined,
    virtualCapacity: draft.capacityModel === "Limited" && draft.mode === "Hybrid" ? draft.virtualCapacity : undefined,
    series: draft.scheduleInterpretation === "separate_sessions" && draft.seriesDates.length > 1 ? `${draft.seriesDates.length}-session series · RSVP once` : draft.scheduleInterpretation === "continuous_event" ? "Multi-day event" : undefined, sessionDates: draft.scheduleInterpretation === "separate_sessions" && draft.seriesDates.length > 1 ? draft.seriesDates : undefined,
    color: draft.mode === "Hybrid" ? "blue" : draft.mode === "In person" ? "gold" : "teal",
    status: "Published", updatedAt: new Date().toISOString(),
  };
}

function preventNegativeCapacity(event: FormEvent<HTMLInputElement>) {
  if (Number(event.currentTarget.value) < 0) event.currentTarget.value = "0";
}

function downloadCalendar(event: EventItem, attendance: string) {
  const toLocalStamp = (date: string, time: string) => {
    const match = time.match(/(\d+):(\d+)\s+(AM|PM)/);
    if (!match) return `${date.replaceAll("-", "")}T000000`;
    let hour = Number(match[1]) % 12;
    if (match[3] === "PM") hour += 12;
    return `${date.replaceAll("-", "")}T${String(hour).padStart(2, "0")}${match[2]}00`;
  };
  const escapeIcs = (value: string) => value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
  const sessionDates = event.sessionDates ?? [event.date];
  const calendarLocation = attendance === "Virtual" ? "Secure online access in My RSVPs" : event.location;
  const calendarEvents = sessionDates.flatMap((date, index) => ["BEGIN:VEVENT", `UID:uh-pd-${event.id}-${index + 1}@hawaii.edu`, `DTSTART;TZID=Pacific/Honolulu:${toLocalStamp(date, event.time)}`, `DTEND;TZID=Pacific/Honolulu:${toLocalStamp(event.endDate ?? date, event.endTime)}`, `SUMMARY:${escapeIcs(`${event.title}${sessionDates.length > 1 ? ` — Session ${index + 1}` : ""}`)}`, `DESCRIPTION:${escapeIcs(`${event.summary} Attendance: ${attendance}. Open the event page or My RSVPs for current access details: ${eventPermalink(event)}`)}`, `LOCATION:${escapeIcs(calendarLocation)}`, `URL:${eventPermalink(event)}`, "END:VEVENT"]);
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UH PD Hub//EN", "X-WR-TIMEZONE:Pacific/Honolulu", "BEGIN:VTIMEZONE", "TZID:Pacific/Honolulu", "BEGIN:STANDARD", "DTSTART:19700101T000000", "TZOFFSETFROM:-1000", "TZOFFSETTO:-1000", "TZNAME:HST", "END:STANDARD", "END:VTIMEZONE", ...calendarEvents, "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${event.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1500);
}

export default function Home() {
  const [eventList, setEventList] = useState<EventItem[]>(initialEvents);
  const [plannerProfileId, setPlannerProfileId] = useState("uhwo");
  const plannerAccount = plannerProfiles.find((profile) => profile.id === plannerProfileId) ?? plannerProfiles[0];
  const [query, setQuery] = useState("");
  const [campus, setCampus] = useState("All campuses");
  const [includeSystemEvents, setIncludeSystemEvents] = useState(false);
  const [department, setDepartment] = useState("All host units");
  const [topic, setTopic] = useState("All topics");
  const [otherTopic, setOtherTopic] = useState("");
  const [mode, setMode] = useState("All formats");
  const [monthFilter, setMonthFilter] = useState("All months");
  const [timeFilter, setTimeFilter] = useState("Any time");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [availability, setAvailability] = useState("Any availability");
  const [sortOrder, setSortOrder] = useState("Soonest");
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [recentEventIds, setRecentEventIds] = useState<number[]>([]);
  const [registrationNotice, setRegistrationNotice] = useState<{ event: EventItem; message: string; waitlisted: boolean; heading?: string } | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationRecord[]>([]);
  const [myRsvpsOpen, setMyRsvpsOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [plannerMode, setPlannerMode] = useState(false);
  const [plannerEditEvent, setPlannerEditEvent] = useState<EventItem | null>(null);
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set([presentMonthKey]));
  const [showWelcome, setShowWelcome] = useState(false);
  const [welcomeCampus, setWelcomeCampus] = useState("All campuses");
  const [heroIndex, setHeroIndex] = useState(0);
  const [carouselPlaying, setCarouselPlaying] = useState(true);
  const [carouselInteracting, setCarouselInteracting] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [announcedResultCount, setAnnouncedResultCount] = useState(initialEvents.length);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const welcomeDialogRef = useRef<HTMLDivElement>(null);
  const mobileFilterDrawerRef = useRef<HTMLDivElement>(null);
  const mobileFilterButtonRef = useRef<HTMLButtonElement>(null);
  const upcomingEvents = useMemo(() => eventList.filter((event) => (event.endDate ?? event.sessionDates?.at(-1) ?? event.date) >= presentDateKey && event.status !== "Canceled" && (plannerMode || ((!event.listingVisibility || event.listingVisibility === "Public") && event.hostVerification !== "Needs confirmation"))).sort((a, b) => a.date.localeCompare(b.date)), [eventList, plannerMode]);
  const featuredMonthKey = upcomingEvents.some((event) => event.date.startsWith(presentMonthKey)) ? presentMonthKey : upcomingEvents[0]?.date.slice(0, 7) ?? presentMonthKey;
  const featuredMonthHeroEvents = useMemo(() => upcomingEvents.filter((event) => event.date.startsWith(featuredMonthKey)), [upcomingEvents, featuredMonthKey]);
  const heroEvents = featuredMonthHeroEvents.length > 0 ? featuredMonthHeroEvents : eventList.slice(-1);
  const heroEvent = heroEvents[heroIndex] ?? heroEvents[0];
  const heroBrand = campusBrands[heroEvent.campus] ?? campusBrands["UH System"];
  const heroMonthLabel = formatMonthLabel(heroEvent.date.slice(0, 7));

  const departmentOptions = useMemo(() => {
    const campusEvents = campus === "All campuses" ? upcomingEvents : upcomingEvents.filter((event) => event.campus === campus || (includeSystemEvents && campus !== "UH System" && event.campus === "UH System" && isEventOpenToCampus(event, campus)));
    return Array.from(new Set(campusEvents.map((event) => event.department))).sort();
  }, [upcomingEvents, campus, includeSystemEvents]);
  const searchSuggestionOptions = useMemo(() => Array.from(new Set([
    ...upcomingEvents.flatMap((event) => event.tags).sort(),
    ...upcomingEvents.map((event) => event.department).sort(),
    ...upcomingEvents.map((event) => event.title),
  ])).slice(0, 14), [upcomingEvents]);
  const monthOptions = useMemo(() => ["All months", ...Array.from(new Set(upcomingEvents.map((event) => event.date.slice(0, 7))))], [upcomingEvents]);
  const matchedOtherPreset = topic === "Other" ? resolvePresetTopic(otherTopic) : undefined;
  const activeFilters = Boolean(query || campus !== "All campuses" || includeSystemEvents || department !== "All host units" || topic !== "All topics" || mode !== "All formats" || monthFilter !== "All months" || timeFilter !== "Any time" || dateFrom || dateTo || availability !== "Any availability");
  const activeFilterCount = [Boolean(query), campus !== "All campuses", includeSystemEvents, department !== "All host units", topic !== "All topics", mode !== "All formats", monthFilter !== "All months", timeFilter !== "Any time", Boolean(dateFrom || dateTo), availability !== "Any availability"].filter(Boolean).length;

  const facetCounts = useMemo(() => ({
    campuses: upcomingEvents.reduce<Record<string, number>>((counts, event) => { counts[event.campus] = (counts[event.campus] ?? 0) + 1; return counts; }, {}),
    topics: upcomingEvents.reduce<Record<string, number>>((counts, event) => { event.tags.forEach((tag) => { counts[tag] = (counts[tag] ?? 0) + 1; }); return counts; }, {}),
    modes: upcomingEvents.reduce<Record<string, number>>((counts, event) => { counts[event.mode] = (counts[event.mode] ?? 0) + 1; return counts; }, {}),
  }), [upcomingEvents]);

  const filtered = useMemo(() => {
    const needle = normalizeFilterText(query);
    const customTopic = normalizeFilterText(otherTopic);
    const presetTopic = resolvePresetTopic(otherTopic);
    const aliases: Record<string, string[]> = {
      ai: ["generative ai", "artificial intelligence", "gemini", "notebooklm"],
      genai: ["generative ai", "artificial intelligence"],
      udl: ["universal design for learning", "accessibility"],
      ada: ["accessibility", "universal design for learning"],
      a11y: ["accessibility"],
      wcag: ["accessibility"],
      oer: ["open educational resources", "open textbooks"],
      lms: ["lamaku", "d2l", "brightspace"],
      d2l: ["lamaku", "lms", "brightspace"],
      zoom: ["online sync", "live online"],
    };
    const queryTermGroups = needle ? needle.split(" ").filter(Boolean).map((term) => [term, ...(aliases[term] ?? [])]) : [];
    const matching = upcomingEvents.filter((event) => {
      const searchable = normalizeFilterText(`${event.title} ${event.summary} ${event.campus} ${event.department} ${event.mode} ${event.location} ${event.tags.join(" ")}`);
      const hasAvailability = event.mode === "Online async" || event.capacityModel === "Unlimited" || event.capacityModel === "Not applicable" || nonnegativeCapacity(event.seats) > 0 || nonnegativeCapacity(event.virtualSeats) > 0;
      return (!needle || queryTermGroups.every((group) => group.some((term) => forgivingTermMatch(searchable, term))))
        && (campus === "All campuses" || event.campus === campus || (includeSystemEvents && campus !== "UH System" && event.campus === "UH System" && isEventOpenToCampus(event, campus)))
        && (department === "All host units" || event.department === department)
        && (topic === "All topics" || (topic === "Other" ? !customTopic || (presetTopic ? event.tags.includes(presetTopic) : searchable.includes(customTopic)) : event.tags.includes(topic)))
        && (mode === "All formats" || event.mode === mode)
        && (monthFilter === "All months" || event.date.startsWith(monthFilter))
        && (timeFilter === "Any time" || getTimePeriod(event) === timeFilter)
        && (!dateFrom || (event.endDate ?? event.sessionDates?.at(-1) ?? event.date) >= dateFrom)
        && (!dateTo || event.date <= dateTo)
        && (availability === "Any availability" || hasAvailability)
        && event.status !== "Canceled";
    });
    return matching.sort((a, b) => sortOrder === "Recently added" ? b.id - a.id : sortOrder === "Seats available" ? availabilitySortScore(b) - availabilitySortScore(a) : sortOrder === "Best match" && needle ? Number(normalizeFilterText(b.title).includes(needle)) - Number(normalizeFilterText(a.title).includes(needle)) || a.date.localeCompare(b.date) : a.date.localeCompare(b.date));
  }, [upcomingEvents, query, campus, includeSystemEvents, department, topic, otherTopic, mode, monthFilter, timeFilter, dateFrom, dateTo, availability, sortOrder]);

  const monthGroups = useMemo(() => {
    const grouped = new Map<string, EventItem[]>();
    filtered.forEach((event) => {
      const monthKey = event.date.slice(0, 7);
      grouped.set(monthKey, [...(grouped.get(monthKey) ?? []), event]);
    });
    return Array.from(grouped, ([monthKey, monthEvents]) => ({ monthKey, monthEvents }));
  }, [filtered]);
  const selectedCampusEventCount = campus === "All campuses" ? 0 : filtered.filter((event) => event.campus === campus).length;
  const includedSystemEventCount = campus === "All campuses" || !includeSystemEvents ? 0 : filtered.filter((event) => event.campus === "UH System").length;
  const recentEvents = recentEventIds.map((id) => eventList.find((event) => event.id === id)).filter((event): event is EventItem => Boolean(event) && event!.status !== "Canceled");
  const emptyStateHint = query ? `No title, description, host, location, or topic closely matched “${query}.” Search also recognizes common abbreviations and one-character typos.` : department !== "All host units" ? `No upcoming opportunities from ${department} match the remaining choices.` : topic !== "All topics" ? `No upcoming ${topic === "Other" && otherTopic ? otherTopic : topic} opportunities match the selected campus, format, and dates.` : mode !== "All formats" ? `No ${formatModeLabel(mode as EventMode).toLowerCase()} opportunities match the selected campus and dates.` : dateFrom || dateTo || monthFilter !== "All months" ? "No opportunities fall inside the selected date window." : "No upcoming opportunities match this combination.";

  const activeFilterChips: Array<{ id: string; label: string; clear: () => void }> = [];
  if (query) activeFilterChips.push({ id: "query", label: `Search: ${query}`, clear: () => setQuery("") });
  if (campus !== "All campuses") activeFilterChips.push({ id: "campus", label: `Hosted by: ${campus}`, clear: () => changeCampus("All campuses") });
  if (includeSystemEvents) activeFilterChips.push({ id: "system-events", label: "UH System opportunities included", clear: () => changeSystemInclusion(false) });
  if (department !== "All host units") activeFilterChips.push({ id: "department", label: department, clear: () => setDepartment("All host units") });
  if (topic !== "All topics") activeFilterChips.push({ id: "topic", label: topic === "Other" && otherTopic ? otherTopic : topic, clear: () => { setTopic("All topics"); setOtherTopic(""); } });
  if (mode !== "All formats") activeFilterChips.push({ id: "mode", label: formatModeLabel(mode as EventMode), clear: () => setMode("All formats") });
  if (monthFilter !== "All months") activeFilterChips.push({ id: "month", label: formatMonthLabel(monthFilter), clear: () => setMonthFilter("All months") });
  if (timeFilter !== "Any time") activeFilterChips.push({ id: "time", label: timeFilter, clear: () => setTimeFilter("Any time") });
  if (dateFrom || dateTo) activeFilterChips.push({ id: "dates", label: dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : dateFrom ? `From ${dateFrom}` : `Through ${dateTo}`, clear: () => { setDateFrom(""); setDateTo(""); } });
  if (availability !== "Any availability") activeFilterChips.push({ id: "availability", label: "Seats available", clear: () => setAvailability("Any availability") });

  function toggleMonth(monthKey: string) {
    setOpenMonths((current) => {
      const next = new Set(current);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  }

  function collapseMonthFromBottom(monthKey: string) {
    setOpenMonths((current) => {
      const next = new Set(current);
      next.delete(monthKey);
      return next;
    });
    window.setTimeout(() => {
      const headingButton = document.getElementById(`month-toggle-${monthKey}`) as HTMLButtonElement | null;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      headingButton?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      headingButton?.focus({ preventScroll: true });
    }, 50);
  }

  function clearFilters() {
    setQuery("");
    setCampus("All campuses");
    setIncludeSystemEvents(false);
    setDepartment("All host units");
    setTopic("All topics");
    setOtherTopic("");
    setMode("All formats");
    setMonthFilter("All months");
    setTimeFilter("Any time");
    setDateFrom("");
    setDateTo("");
    setAvailability("Any availability");
    setAdvancedFiltersOpen(false);
    setOpenMonths(new Set([presentMonthKey]));
  }

  function openEvent(event: EventItem) {
    setSelected(event);
    setRecentEventIds((current) => [event.id, ...current.filter((id) => id !== event.id)].slice(0, 4));
  }

  function changeCampus(nextCampus: string) {
    setCampus(nextCampus);
    setIncludeSystemEvents(false);
    setDepartment("All host units");
  }

  function changeSystemInclusion(nextValue: boolean) {
    setIncludeSystemEvents(nextValue);
    setDepartment("All host units");
  }

  function changeRegistrationAttendance(registration: RegistrationRecord, nextAttendance: string) {
    const registeredEvent = eventList.find((event) => event.id === registration.eventId);
    if (!registeredEvent || registration.waitlisted || registration.attendance === nextAttendance) return;
    const targetSeats = nextAttendance === "Virtual" ? nonnegativeCapacity(registeredEvent.virtualSeats) : nonnegativeCapacity(registeredEvent.seats);
    if ((registeredEvent.capacityModel === "Limited" || registeredEvent.capacityModel === "Waitlist only") && targetSeats === 0) {
      setRegistrationNotice({ event: registeredEvent, heading: `${nextAttendance} option is full`, message: `Your ${registration.attendance.toLowerCase()} reservation was kept. Join the ${nextAttendance.toLowerCase()} waitlist from the event team when production waitlist transfers are enabled.`, waitlisted: true });
      return;
    }
    setRegistrations((current) => current.map((item) => item.eventId === registration.eventId && item.email === registration.email ? { ...item, attendance: nextAttendance } : item));
    setEventList((current) => current.map((event) => {
      if (event.id !== registration.eventId || event.capacityModel === "Unlimited" || event.capacityModel === "Not applicable") return event;
      const restored = registration.attendance === "Virtual" ? { ...event, virtualSeats: nonnegativeCapacity(event.virtualSeats) + 1 } : { ...event, seats: nonnegativeCapacity(event.seats) + 1 };
      return nextAttendance === "Virtual" ? { ...restored, virtualSeats: nonnegativeCapacity(restored.virtualSeats) - 1 } : { ...restored, seats: nonnegativeCapacity(restored.seats) - 1 };
    }));
  }

  function moveHero(direction: number) {
    setCarouselPlaying(false);
    setHeroIndex((current) => (current + direction + heroEvents.length) % heroEvents.length);
  }

  function chooseHero(index: number) {
    setCarouselPlaying(false);
    setHeroIndex(index);
  }

  useEffect(() => {
    try {
      const savedRegistrations = JSON.parse(window.localStorage.getItem(registrationStorageKey) || "[]") as RegistrationRecord[];
      setRegistrations(Array.isArray(savedRegistrations) ? savedRegistrations : []);
      const savedRecentIds = JSON.parse(window.localStorage.getItem(recentEventsStorageKey) || "[]") as number[];
      setRecentEventIds(Array.isArray(savedRecentIds) ? savedRecentIds.filter((id) => Number.isFinite(id)).slice(0, 4) : []);
      const savedEvents = JSON.parse(window.localStorage.getItem(eventStorageKey) || "null") as EventItem[] | null;
      const customEvents = Array.isArray(savedEvents) ? savedEvents.filter((event) => !seededEventIds.has(event.id)).map(withEventDefaults) : [];
      const hydratedEvents = [...initialEvents.map(withEventDefaults), ...customEvents];
      setEventList(hydratedEvents);
      const savedPreferences = JSON.parse(window.localStorage.getItem(preferenceStorageKey) || "{}") as Record<string, string | boolean>;
      const params = new URLSearchParams(window.location.search);
      const requestedCampus = params.get("campus") ?? String(savedPreferences.campus ?? "All campuses");
      setQuery(params.get("q") ?? "");
      setCampus(requestedCampus);
      setIncludeSystemEvents(requestedCampus !== "All campuses" && requestedCampus !== "UH System" && (params.get("includeSystem") === "1" || savedPreferences.includeSystemEvents === true));
      setDepartment(params.get("unit") ?? "All host units");
      setTopic(params.get("topic") ?? "All topics");
      setOtherTopic(params.get("otherTopic") ?? "");
      setMode(params.get("mode") ?? String(savedPreferences.mode ?? "All formats"));
      setMonthFilter(params.get("month") ?? "All months");
      setTimeFilter(params.get("time") ?? "Any time");
      setDateFrom(params.get("from") ?? "");
      setDateTo(params.get("to") ?? "");
      setAvailability(params.get("availability") ?? "Any availability");
      setSortOrder(params.get("sort") ?? "Soonest");
      setAdvancedFiltersOpen(Boolean(params.get("unit") || params.get("month") || params.get("time") || params.get("from") || params.get("to")));
      const linkedEvent = params.get("event");
      if (linkedEvent) {
        const deepLinkedEvent = hydratedEvents.find((event) => eventSlug(event) === linkedEvent) ?? null;
        setSelected(deepLinkedEvent);
        if (deepLinkedEvent) setRecentEventIds((current) => [deepLinkedEvent.id, ...current.filter((id) => id !== deepLinkedEvent.id)].slice(0, 4));
      }
    } catch {
      // Device-local conveniences never block event discovery.
    }
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try { window.localStorage.setItem(registrationStorageKey, JSON.stringify(registrations)); } catch { /* Optional device storage is unavailable. */ }
  }, [registrations, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    try { window.localStorage.setItem(recentEventsStorageKey, JSON.stringify(recentEventIds)); } catch { /* Recently viewed is an optional device convenience. */ }
  }, [recentEventIds, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    try { window.localStorage.setItem(eventStorageKey, JSON.stringify(eventList)); } catch { /* Production uses the shared event store; device persistence is a draft fallback. */ }
  }, [eventList, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    try { window.localStorage.setItem(preferenceStorageKey, JSON.stringify({ campus, includeSystemEvents, mode })); } catch { /* Optional device storage is unavailable. */ }
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (campus !== "All campuses") params.set("campus", campus);
    if (includeSystemEvents) params.set("includeSystem", "1");
    if (department !== "All host units") params.set("unit", department);
    if (topic !== "All topics") params.set("topic", topic);
    if (otherTopic) params.set("otherTopic", otherTopic);
    if (mode !== "All formats") params.set("mode", mode);
    if (monthFilter !== "All months") params.set("month", monthFilter);
    if (timeFilter !== "Any time") params.set("time", timeFilter);
    if (dateFrom) params.set("from", dateFrom);
    if (dateTo) params.set("to", dateTo);
    if (availability !== "Any availability") params.set("availability", availability);
    if (sortOrder !== "Soonest") params.set("sort", sortOrder);
    if (selected) params.set("event", eventSlug(selected));
    const queryString = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`);
  }, [preferencesReady, query, campus, includeSystemEvents, department, topic, otherTopic, mode, monthFilter, timeFilter, dateFrom, dateTo, availability, sortOrder, selected]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAnnouncedResultCount(filtered.length), 350);
    return () => window.clearTimeout(timer);
  }, [filtered.length]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setCarouselPlaying(false);
  }, []);

  useEffect(() => {
    if (heroEvents.length <= 1 || !carouselPlaying || carouselInteracting || selected || showWelcome) return;
    const timer = window.setInterval(() => setHeroIndex((current) => (current + 1) % heroEvents.length), 7000);
    return () => window.clearInterval(timer);
  }, [carouselPlaying, carouselInteracting, selected, showWelcome, heroEvents.length]);

  useEffect(() => {
    if (heroIndex >= heroEvents.length) setHeroIndex(0);
  }, [heroEvents.length, heroIndex]);

  useEffect(() => {
    const visibleMonthKeys = new Set(monthGroups.map(({ monthKey }) => monthKey));
    setOpenMonths((current) => {
      const hasVisibleOpenMonth = Array.from(current).some((monthKey) => visibleMonthKeys.has(monthKey));
      if (monthGroups.length === 0 || hasVisibleOpenMonth) return current;
      return new Set([monthGroups[0].monthKey]);
    });
  }, [monthGroups]);

  useEffect(() => {
    const wideLayout = window.matchMedia("(min-width: 1025px)");
    const closeOnWideLayout = (event: MediaQueryListEvent) => { if (event.matches) setMobileFiltersOpen(false); };
    wideLayout.addEventListener("change", closeOnWideLayout);
    return () => wideLayout.removeEventListener("change", closeOnWideLayout);
  }, []);

  useEffect(() => {
    if (!mobileFiltersOpen) return;
    const previousOverflow = document.body.style.overflow;
    const returnButton = mobileFilterButtonRef.current;
    document.body.style.overflow = "hidden";
    window.setTimeout(() => mobileFilterDrawerRef.current?.querySelector<HTMLInputElement>("input")?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileFiltersOpen(false);
      if (event.key === "Tab" && mobileFilterDrawerRef.current) {
        const focusable = Array.from(mobileFilterDrawerRef.current.querySelectorAll<HTMLElement>("button, input, select, [href], [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled"));
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      returnButton?.focus();
    };
  }, [mobileFiltersOpen]);

  useEffect(() => {
    if (!selected) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("button, input, select, textarea, [href], [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled"));
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; previousFocus?.focus(); };
  }, [selected]);

  useEffect(() => {
    try {
      const isEventDeepLink = Boolean(new URLSearchParams(window.location.search).get("event"));
      setShowWelcome(!isEventDeepLink && window.localStorage.getItem(welcomeStorageKey) !== "true");
    } catch {
      setShowWelcome(true);
    }
  }, []);

  useEffect(() => {
    if (!showWelcome) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    welcomeDialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        try { window.localStorage.setItem(welcomeStorageKey, "true"); } catch { /* Escape still closes the welcome when device storage is unavailable. */ }
        setShowWelcome(false);
      }
      if (event.key === "Tab" && welcomeDialogRef.current) {
        const focusable = Array.from(welcomeDialogRef.current.querySelectorAll<HTMLElement>("button, select, [href], [tabindex]:not([tabindex='-1'])")).filter((element) => !element.hasAttribute("disabled"));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [showWelcome]);

  function dismissWelcome(goToEvents = false) {
    try {
      window.localStorage.setItem(welcomeStorageKey, "true");
    } catch {
      // The welcome can still be dismissed when browser storage is unavailable.
    }
    setShowWelcome(false);
    if (goToEvents) {
      if (welcomeCampus !== "All campuses") changeCampus(welcomeCampus);
      window.setTimeout(() => {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        document.getElementById("events")?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }, 75);
    }
  }

  if (portalOpen) return <PlannerPortal events={eventList} registrations={registrations} plannerAccount={plannerAccount} plannerProfileId={plannerProfileId} onChangePlannerProfile={setPlannerProfileId} initialEditEvent={plannerEditEvent} onClose={() => { setPortalOpen(false); setPlannerEditEvent(null); }} onPublish={(publishedEvent) => setEventList((current) => [...current.filter((event) => event.id !== publishedEvent.id), publishedEvent].sort((a, b) => a.date.localeCompare(b.date)))} onViewPublished={(publishedEvent) => {
    const monthKey = publishedEvent.date.slice(0, 7);
    setQuery(""); setCampus("All campuses"); setIncludeSystemEvents(false); setDepartment("All host units"); setTopic("All topics"); setOtherTopic(""); setMode("All formats"); setMonthFilter("All months"); setTimeFilter("Any time"); setDateFrom(""); setDateTo(""); setAvailability("Any availability");
    setOpenMonths((current) => new Set([...current, monthKey]));
    setPortalOpen(false);
    window.setTimeout(() => {
      const eventCard = document.getElementById(`event-${publishedEvent.id}`);
      eventCard?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      eventCard?.focus({ preventScroll: true });
    }, 100);
  }} />;

  return (
    <>
      <div className="public-app-shell" inert={showWelcome || Boolean(selected)} aria-hidden={showWelcome || Boolean(selected) ? true : undefined}>
      <a className="skip-link" href="#main-content">Skip to event listings</a>
      <header className="site-header">
        <div className="utility-bar"><div className="shell utility-inner"><span>University of Hawaiʻi</span><span className="audience-note">For UH faculty, instructors &amp; staff</span></div></div>
        <div className="shell nav-row">
          <a className="brand" href="#top" aria-label="UH Professional Development Hub home"><UhSystemMark /><span><strong>Professional Development Hub</strong><small>Connect · Learn · Grow</small></span></a>
          <nav aria-label="Primary navigation"><a className="active" href="#events">Find events</a></nav>
          <button className="my-rsvps-nav" type="button" onClick={() => { setMyRsvpsOpen((current) => !current); window.setTimeout(() => document.getElementById("my-rsvps")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}>My RSVPs{registrations.length > 0 ? ` (${registrations.length})` : ""}</button>
          <button className="sign-in" type="button" onClick={() => { setPlannerMode(true); setPlannerEditEvent(null); setPortalOpen(true); }}>Planner Portal</button>
        </div>
      </header>

      <main id="main-content">
        {plannerMode && <section className="planner-mode-banner" aria-label="Planner mode"><div className="shell"><span aria-hidden="true">✓</span><div><strong>Planner mode: {plannerAccount.name}</strong><p>{plannerAccount.role} · {plannerAccount.units.join(", ")} · Edit controls appear only on authorized events.</p></div><button type="button" onClick={() => { setPlannerMode(false); setPlannerEditEvent(null); }}>Exit planner mode</button></div></section>}
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="shell hero-grid">
            <div className="hero-copy">
              <p className="eyebrow"><span aria-hidden="true">✦</span> One UH · Shared learning</p>
              <h1 id="hero-title">UH professional development.<br /><em>All in one place.</em></h1>
              <p className="hero-lede">Explore workshops, webinars, and learning opportunities for UH faculty and staff—then filter by campus, topic, format, or date.</p>
              <a className="primary-link" href="#events">Explore upcoming events <span aria-hidden="true">↓</span></a>
            </div>
            <div
              className={`hero-panel ${heroBrand.className}`}
              role="region"
              aria-roledescription={heroEvents.length > 1 ? "carousel" : undefined}
              aria-label={`Professional development for ${heroMonthLabel}`}
              onMouseEnter={() => setCarouselInteracting(true)}
              onMouseLeave={() => setCarouselInteracting(false)}
              onFocus={() => setCarouselInteracting(true)}
              onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCarouselInteracting(false); }}
            >
              <div className="hero-carousel-heading"><span className="kicker">Coming up next</span><span className="carousel-count">{heroEvents.length > 1 ? `${heroIndex + 1} of ${heroEvents.length}` : `${heroEvents.length} opportunity`} · {heroMonthLabel}</span></div>
              {heroEvents.length > 1 && <button className="carousel-side-control previous" type="button" aria-label="Show previous event" onClick={() => moveHero(-1)}><span aria-hidden="true">‹</span></button>}
              <div className="hero-slide" key={heroEvent.id} role={heroEvents.length > 1 ? "group" : undefined} aria-roledescription={heroEvents.length > 1 ? "slide" : undefined} aria-label={heroEvents.length > 1 ? `${heroIndex + 1} of ${heroEvents.length}` : undefined} aria-live={heroEvents.length > 1 && !carouselPlaying ? "polite" : "off"} aria-atomic="true">
                <div className="campus-lockup">
                  <CampusSeal campus={heroEvent.campus} className="campus-seal" />
                  <span className="campus-name"><small>Hosted by</small><strong>{heroBrand.label}</strong><b>{heroEvent.department}</b></span>
                </div>
                <div className="next-event"><span className="mini-date"><b>{heroEvent.month}</b><strong>{heroEvent.day}</strong></span><div><span className={`mode-pill ${modeClass(heroEvent.mode)}`}>● {formatModeLabel(heroEvent.mode)}</span><span className="hero-audience-scope">{eventAudienceLabel(heroEvent)}</span><h2>{heroEvent.title}</h2><p>{heroEvent.weekday} · {heroEvent.mode === "Online async" ? "Available anytime" : `${heroEvent.time}–${heroEvent.endTime} HST`}</p></div></div>
              </div>
              {heroEvents.length > 1 && <button className="carousel-side-control next" type="button" aria-label="Show next event" onClick={() => moveHero(1)}><span aria-hidden="true">›</span></button>}
              <div className="hero-card-footer">
                <button type="button" className="text-button" onClick={() => openEvent(heroEvent)}>View event &amp; RSVP <span aria-hidden="true">→</span></button>
                {heroEvents.length > 1 && <div className="carousel-controls" aria-label="Featured events carousel controls">
                  <button type="button" aria-label={carouselPlaying ? "Pause event carousel" : "Play event carousel"} onClick={() => setCarouselPlaying((playing) => !playing)}>{carouselPlaying ? "Ⅱ" : "▶"}</button>
                </div>}
              </div>
              {heroEvents.length > 1 && <div className="carousel-dots" aria-label="Choose a featured event">{heroEvents.map((event, index) => <button type="button" key={event.id} className={index === heroIndex ? "active" : ""} aria-label={`Show ${event.title}`} aria-current={index === heroIndex ? "true" : undefined} onClick={() => chooseHero(index)} />)}</div>}
              <div className="wave-rule" aria-hidden="true"><span></span><span></span><span></span></div>
            </div>
          </div>
        </section>

        <section className="trust-strip" aria-label="Service highlights"><div className="shell trust-grid"><p><span aria-hidden="true">✓</span><strong>UH-only opportunities</strong><small>Designed for faculty &amp; staff</small></p><p><span aria-hidden="true">⌁</span><strong>One-click RSVP</strong><small>Calendar invite included</small></p><p><span aria-hidden="true">◴</span><strong>Timely reminders</strong><small>Details when you need them</small></p></div></section>

        {myRsvpsOpen && <MyRsvps registrations={registrations} events={eventList} onClose={() => setMyRsvpsOpen(false)} onChangeAttendance={changeRegistrationAttendance} onCancel={(registration) => { setRegistrations((current) => current.filter((item) => !(item.eventId === registration.eventId && item.email === registration.email))); setEventList((current) => current.map((event) => event.id !== registration.eventId || registration.waitlisted || event.capacityModel === "Unlimited" || event.capacityModel === "Not applicable" ? event : registration.attendance === "Virtual" ? { ...event, virtualSeats: nonnegativeCapacity(event.virtualSeats) + 1 } : { ...event, seats: nonnegativeCapacity(event.seats) + 1 })); }} />}

        {recentEvents.length > 0 && <section className="recently-viewed shell" aria-labelledby="recently-viewed-title"><div><p className="eyebrow dark">Continue exploring</p><h2 id="recently-viewed-title">Recently viewed</h2></div><div>{recentEvents.map((event) => <button type="button" key={event.id} onClick={() => openEvent(event)}><CampusSeal campus={event.campus} className="recent-event-seal" /><span><strong>{event.title}</strong><small>{formatAnalyticsDate(event.date)} · {event.mode === "Online async" ? "Self-paced" : `${event.time} HST`}</small></span><b aria-hidden="true">→</b></button>)}</div><button className="clear-recent" type="button" onClick={() => setRecentEventIds([])}>Clear</button></section>}

        <section className="events-section shell" id="events" aria-labelledby="events-title">
          <div className="section-heading"><div><p className="eyebrow dark">Find your next opportunity</p><h2 id="events-title">Upcoming professional development</h2></div><p>Browse learning opportunities from UH campuses and system offices.</p></div>
          <div className="mobile-filter-bar">
            <button ref={mobileFilterButtonRef} type="button" aria-expanded={mobileFiltersOpen} aria-controls="event-filter-drawer" onClick={() => setMobileFiltersOpen(true)}><span aria-hidden="true">⌕</span><span><strong>Search &amp; filters</strong><small>{activeFilterCount > 0 ? `${activeFilterCount} active` : "All opportunities"}</small></span><b>{filtered.length} results</b></button>
          </div>
          <div className="events-layout">
            <aside className={`filter-sidebar${mobileFiltersOpen ? " mobile-open" : ""}`} aria-label="Event search and filters">
              <button className="filter-scrim" type="button" tabIndex={-1} aria-label="Close event filters" onClick={() => setMobileFiltersOpen(false)} />
              <div className="filter-sidebar-inner" id="event-filter-drawer" ref={mobileFilterDrawerRef} role={mobileFiltersOpen ? "dialog" : undefined} aria-modal={mobileFiltersOpen || undefined} aria-labelledby="filter-drawer-title">
                <div className="filter-sidebar-heading"><div><span>Refine results</span><h3 id="filter-drawer-title">Search &amp; filters</h3></div><div className="filter-heading-actions"><button className="filter-heading-reset" type="button" disabled={!activeFilters} onClick={clearFilters}>Clear selections</button><button className="filter-close-button" type="button" aria-label="Close filters" onClick={() => setMobileFiltersOpen(false)}>×</button></div></div>
                <form className="filter-panel sidebar-filters" role="search" aria-label="Filter professional development" onSubmit={(event) => event.preventDefault()}>
                  <label className="search-field"><span>Search events</span><div className="input-wrap"><span aria-hidden="true">⌕</span><input id="event-keyword-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="AI, OER, accessibility…" /><details className="search-suggestion-menu"><summary><span className="sr-only">Show keyword suggestions</span><span aria-hidden="true">⌄</span></summary><div aria-label="Keyword suggestions">{searchSuggestionOptions.map((item) => <button type="button" key={item} onClick={(event) => { setQuery(item); event.currentTarget.closest("details")?.removeAttribute("open"); window.setTimeout(() => document.getElementById("event-keyword-search")?.focus(), 0); }}>{item}</button>)}</div></details></div></label>
                  <div className="quick-filters" aria-label="Quick filters"><span>Quick choices</span><div><button className={dateFrom === presentDateKey && dateTo === addDays(presentDateKey, 7) ? "active" : ""} type="button" onClick={() => { setDateFrom(presentDateKey); setDateTo(addDays(presentDateKey, 7)); setMonthFilter("All months"); }}>Next 7 days</button><button className={monthFilter === presentMonthKey ? "active" : ""} type="button" onClick={() => { setMonthFilter(presentMonthKey); setDateFrom(""); setDateTo(""); }}>This month</button><button className={mode === "Online sync" ? "active" : ""} type="button" onClick={() => setMode(mode === "Online sync" ? "All formats" : "Online sync")}>Live online</button><button className={mode === "Online async" ? "active" : ""} type="button" onClick={() => setMode(mode === "Online async" ? "All formats" : "Online async")}>Self-paced</button><button className={availability === "Seats available" ? "active" : ""} type="button" onClick={() => setAvailability(availability === "Seats available" ? "Any availability" : "Seats available")}>Seats available</button></div></div>
                  <label><span>Hosted by campus</span><select value={campus} onChange={(event) => changeCampus(event.target.value)}>{campusOptions.map((item) => <option key={item} value={item} disabled={item !== "All campuses" && item !== campus && !facetCounts.campuses[item]}>{item}{item !== "All campuses" ? ` (${facetCounts.campuses[item] ?? 0})` : ""}</option>)}</select><small className="filter-help">Selecting a campus shows only opportunities hosted there.</small></label>
                  {campus !== "All campuses" && campus !== "UH System" && <label className="system-inclusion-toggle"><input type="checkbox" checked={includeSystemEvents} onChange={(event) => changeSystemInclusion(event.target.checked)} /><span><strong>Also include UH System opportunities</strong><small>Only System-hosted PD that is open to {campus}.</small></span></label>}
                  <label><span>Topic</span><select value={topic} onChange={(event) => { const nextTopic = event.target.value; setTopic(nextTopic); if (nextTopic !== "Other") setOtherTopic(""); }}>{topicOptions.map((item) => <option key={item} value={item} disabled={item !== "All topics" && item !== "Other" && item !== topic && !facetCounts.topics[item]}>{item !== "All topics" && item !== "Other" ? `${item} (${facetCounts.topics[item] ?? 0})` : item}</option>)}</select></label>
                  {topic === "Other" && <label className="other-topic-field"><span>Other topic</span><input value={otherTopic} onChange={(event) => setOtherTopic(event.target.value)} placeholder="OER, research, advising, leadership…" /><small>{matchedOtherPreset ? <>Recognized as the listed topic “{matchedOtherPreset}.”</> : <>Searches event titles, descriptions, hosts, locations, and tags.</>}</small></label>}
                  <label><span>Format</span><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="All formats">All formats</option>{modeOptions.map((item) => <option key={item.value} value={item.value} disabled={item.value !== mode && !facetCounts.modes[item.value]}>{item.label} ({facetCounts.modes[item.value] ?? 0})</option>)}</select></label>
                  <details className="advanced-filters" open={advancedFiltersOpen} onToggle={(event) => setAdvancedFiltersOpen(event.currentTarget.open)}><summary>More filters</summary><div>
                    <label className="dependent-filter"><span>Host unit</span><select value={department} disabled={campus !== "All campuses" && departmentOptions.length === 0} onChange={(event) => setDepartment(event.target.value)}><option value="All host units">{campus === "All campuses" ? "All host units" : departmentOptions.length > 0 ? includeSystemEvents ? `All ${campus} + UH System host units` : `All ${campus} host units` : "No host units with upcoming events"}</option>{departmentOptions.map((item) => <option key={item}>{item}</option>)}</select><small>{campus === "All campuses" ? "Select a host campus to narrow this list." : includeSystemEvents ? `${campus} and eligible UH System host units are listed.` : `Only ${campus} units hosting upcoming opportunities are listed.`}</small></label>
                    <label><span>Month</span><select value={monthFilter} onChange={(event) => setMonthFilter(event.target.value)}>{monthOptions.map((item) => <option key={item} value={item}>{item === "All months" ? item : formatMonthLabel(item)}</option>)}</select></label>
                    <label><span>Time</span><select value={timeFilter} onChange={(event) => setTimeFilter(event.target.value)}>{["Any time", "Morning", "Afternoon", "Evening", "Anytime"].map((item) => <option key={item}>{item}</option>)}</select></label>
                    <div className="date-range"><span>Date range</span><label><span>From</span><input type="date" value={dateFrom} min={presentDateKey} onChange={(event) => setDateFrom(event.target.value)} /></label><label><span>Through</span><input type="date" value={dateTo} min={dateFrom || presentDateKey} onChange={(event) => setDateTo(event.target.value)} /></label></div>
                  </div></details>
                  <div className="filter-live-count"><strong>{filtered.length}</strong><span>matching {filtered.length === 1 ? "opportunity" : "opportunities"}</span></div><p className="sr-only" aria-live="polite">{announcedResultCount} matching {announcedResultCount === 1 ? "opportunity" : "opportunities"}</p>
                  <div className="filter-sidebar-actions"><button className="filter-done" type="button" onClick={() => setMobileFiltersOpen(false)}>Show {filtered.length} {filtered.length === 1 ? "result" : "results"}</button></div>
                </form>
              </div>
            </aside>

            <div className="events-results">
              <div className="results-bar"><div><p><strong>{filtered.length}</strong> matching {filtered.length === 1 ? "opportunity" : "opportunities"}</p>{campus !== "All campuses" && <p className="scope-result-note">{selectedCampusEventCount} hosted by {campus}{includeSystemEvents ? ` · ${includedSystemEventCount} UH System ${includedSystemEventCount === 1 ? "opportunity" : "opportunities"} open to ${campus}` : " · UH System opportunities excluded"}</p>}</div><label className="sort-results"><span>Sort</span><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}><option>Soonest</option><option>Best match</option><option>Seats available</option><option>Recently added</option></select></label><div className="results-actions">{monthGroups.length > 0 && <><button type="button" onClick={() => setOpenMonths(new Set(monthGroups.map(({ monthKey }) => monthKey)))}>Expand all months</button><button type="button" onClick={() => setOpenMonths(new Set())}>Collapse all</button></>}{activeFilters && <button type="button" onClick={clearFilters}>Clear filters</button>}</div></div>
              {activeFilterChips.length > 0 && <div className="active-filter-chips" aria-label="Active filters">{activeFilterChips.map((chip) => <button type="button" key={chip.id} onClick={chip.clear} aria-label={`Remove ${chip.label} filter`}>{chip.label} <span aria-hidden="true">×</span></button>)}</div>}
              <div className="month-list">
                {monthGroups.map(({ monthKey, monthEvents }) => {
                  const isOpen = openMonths.has(monthKey);
                  const panelId = `month-panel-${monthKey}`;
                  const headingId = `month-heading-${monthKey}`;
                  return (
                    <section className={`month-group${isOpen ? " open" : ""}`} key={monthKey}>
                      <h3 id={headingId}>
                        <button id={`month-toggle-${monthKey}`} type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggleMonth(monthKey)}>
                          <span className="month-heading-copy">
                            <span className="month-title">{formatMonthLabel(monthKey)}</span>
                            <span className="month-count">{monthEvents.length} {monthEvents.length === 1 ? "opportunity" : "opportunities"}</span>
                            {monthKey === presentMonthKey && <span className="current-month-badge">Current month</span>}
                          </span>
                          <span className="accordion-chevron" aria-hidden="true">⌄</span>
                        </button>
                      </h3>
                      <div className="month-panel" id={panelId} role="region" aria-labelledby={headingId} hidden={!isOpen}>
                        <div className="event-list">{monthEvents.map((event) => <EventCard key={event.id} event={event} onSelect={openEvent} whyShown={campus !== "All campuses" && includeSystemEvents && event.campus === "UH System" ? `Shown because this UH System opportunity is open to ${campus}.` : undefined} canEdit={plannerMode && plannerAccount.units.includes(event.department)} onEdit={(editableEvent) => { setPlannerEditEvent(editableEvent); setPortalOpen(true); }} />)}</div>
                        <div className="accordion-footer"><button type="button" onClick={() => collapseMonthFromBottom(monthKey)}><span aria-hidden="true">↑</span> Collapse {formatMonthLabel(monthKey)}</button></div>
                      </div>
                    </section>
                  );
                })}
                {filtered.length === 0 && <div className="empty-state"><span aria-hidden="true">⌕</span><h3>No events match this combination</h3><p>{emptyStateHint}</p><div>{activeFilterChips.slice(-3).map((chip) => <button type="button" key={chip.id} onClick={chip.clear}>Remove {chip.label}</button>)}<button type="button" onClick={clearFilters}>Show all opportunities</button></div></div>}
              </div>
              {monthGroups.length > 0 && <div className="bottom-accordion-controls" aria-label="Month accordion controls"><span>Month sections</span><div><button type="button" onClick={() => setOpenMonths(new Set(monthGroups.map(({ monthKey }) => monthKey)))}>Expand all months</button><button type="button" onClick={() => setOpenMonths(new Set())}>Collapse all months</button></div></div>}
            </div>
          </div>
        </section>

        <section className="planner-callout" id="for-planners" aria-labelledby="planner-title"><div className="shell planner-inner"><div><p className="eyebrow">For instructional designers &amp; event planners</p><h2 id="planner-title">Have an opportunity to share?</h2><p>Use Smart Intake to create the listing, protect the roster, connect a sync platform, and verify attendance.</p></div><button className="light-button" type="button" onClick={() => { setPlannerMode(true); setPlannerEditEvent(null); setPortalOpen(true); }}>Open planner portal <span aria-hidden="true">→</span></button></div></section>
      </main>

      <footer id="about"><div className="shell footer-inner"><div><strong>UH Professional Development Hub</strong><p>Connecting learning across our island campuses.</p></div><div className="footer-contact"><strong>Questions or technical problems?</strong><a href="mailto:uhoic@hawaii.edu">Email uhoic@hawaii.edu</a></div><div className="footer-meta"><p>Phase 1 prototype · WCAG 2.1 AA–informed</p><details className="footer-sources"><summary>Event sources</summary><div className="footer-source-panel"><div className="footer-source-heading"><span aria-hidden="true">↗</span><div><strong>Event source websites</strong><p>Public websites configured for event discovery. Automated collection is not yet connected in this prototype.</p></div><button type="button" aria-label="Close event sources" onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}>×</button></div><ul>{publicEventSources.map((source) => <li key={source.id}><div><strong>{source.name}</strong><small>{source.ownerCampus} · {source.ownerUnit}</small></div><a href={source.url} target="_blank" rel="noreferrer">{source.url}<span className="sr-only"> (opens in a new tab)</span></a><small>Last checked {source.lastChecked}</small></li>)}</ul><p className="footer-source-note">Planners can view monitoring status and source history in the Planner Portal.</p></div></details></div></div></footer>
      </div>

      {showWelcome && (
        <div className="welcome-backdrop">
          <div className="welcome-dialog" role="dialog" aria-modal="true" aria-labelledby="welcome-title" aria-describedby="welcome-description" tabIndex={-1} ref={welcomeDialogRef}>
            <button className="welcome-close" type="button" aria-label="Close welcome message" onClick={() => dismissWelcome()}>×</button>
            <div className="welcome-brand" aria-hidden="true"><UhSystemMark /><span>Professional Development Hub</span></div>
            <p className="eyebrow dark">Welcome to one UH learning community</p>
            <h2 id="welcome-title">Professional development, all in one place.</h2>
            <p className="welcome-lede" id="welcome-description">The UH Professional Development Hub brings opportunities from across all 10 UH campuses into one easy-to-use place for faculty, instructors, and staff.</p>

            <div className="welcome-features" aria-label="What you can do">
              <article><span className="welcome-feature-icon" aria-hidden="true">⌕</span><h3>Search &amp; filter</h3><p>Narrow opportunities by campus, topic, or format.</p></article>
              <article><span className="welcome-feature-icon" aria-hidden="true">▤</span><h3>Browse by month</h3><p>Open monthly sections to plan several months ahead.</p></article>
              <article><span className="welcome-feature-icon" aria-hidden="true">✓</span><h3>RSVP with ease</h3><p>Reserve your place and add the event to your calendar.</p></article>
            </div>

            <label className="welcome-campus"><span>Optional starting campus</span><select value={welcomeCampus} onChange={(event) => setWelcomeCampus(event.target.value)}>{campusOptions.map((item) => <option key={item}>{item}</option>)}</select><small>This only sets your first host-campus view. You can return to all opportunities at any time.</small></label>

            <div className="welcome-start">
              <span aria-hidden="true">1</span>
              <div><strong>Start here</strong><p>Use the event search and filters, open a month, then choose “Details &amp; RSVP.”</p></div>
            </div>

            <div className="welcome-actions">
              <button className="welcome-secondary" type="button" onClick={() => dismissWelcome()}>I’ll explore on my own</button>
              <button className="welcome-primary" type="button" onClick={() => dismissWelcome(true)}>Find professional development <span aria-hidden="true">→</span></button>
            </div>
            <p className="welcome-note">This welcome appears only on your first visit on this device.</p>
          </div>
        </div>
      )}

      {selected && <RsvpDialog event={selected} registrations={registrations} onClose={() => setSelected(null)} onRegistered={(registration) => { setRegistrations((current) => [...current, registration]); setRegistrationNotice({ event: selected, waitlisted: registration.waitlisted, message: registration.waitlisted ? "We’ll notify you if a place opens." : "Saved to My RSVPs. The calendar download has started; you can download it again from My RSVPs." }); if (!registration.waitlisted) { setEventList((current) => current.map((event) => event.id !== selected.id || event.mode === "Online async" || event.capacityModel === "Unlimited" || event.capacityModel === "Not applicable" ? event : registration.attendance === "Virtual" ? { ...event, virtualSeats: Math.max(0, nonnegativeCapacity(event.virtualSeats) - 1) } : { ...event, seats: Math.max(0, nonnegativeCapacity(event.seats) - 1) })); downloadCalendar(selected, registration.attendance); } setSelected(null); }} dialogRef={dialogRef} />}
      {registrationNotice && <div className="toast" role="status" inert={showWelcome || Boolean(selected)} aria-hidden={showWelcome || Boolean(selected) ? true : undefined}><span aria-hidden="true">✓</span><div><strong>{registrationNotice.heading ?? (registrationNotice.waitlisted ? "You’re on the waitlist" : "You’re registered!")}</strong><small>{registrationNotice.message}</small></div><button aria-label="Dismiss confirmation" onClick={() => setRegistrationNotice(null)}>×</button></div>}
    </>
  );
}

function MyRsvps({ registrations, events, onClose, onCancel, onChangeAttendance }: { registrations: RegistrationRecord[]; events: EventItem[]; onClose: () => void; onCancel: (registration: RegistrationRecord) => void; onChangeAttendance: (registration: RegistrationRecord, attendance: string) => void }) {
  return <section className="my-rsvps-panel shell" id="my-rsvps" aria-labelledby="my-rsvps-title"><div className="my-rsvps-heading"><div><p className="eyebrow dark">Your registrations on this device</p><h2 id="my-rsvps-title">My RSVPs</h2><p>Manage attendance, download calendar files, or cancel a reservation.</p></div><button type="button" onClick={onClose}>Close</button></div>{registrations.length === 0 ? <div className="my-rsvps-empty"><strong>No saved RSVPs yet</strong><p>After registering with a UH email, your opportunities will appear here on this device.</p></div> : <div className="my-rsvps-list">{registrations.map((registration) => { const event = events.find((item) => item.id === registration.eventId); if (!event) return null; const dates = event.sessionDates ?? [event.date]; return <article key={`${registration.eventId}-${registration.email}`}><div><span className={`table-status ${registration.waitlisted ? "flag" : "live"}`}>{registration.waitlisted ? "Waitlisted" : "Confirmed"}</span><h3>{event.title}</h3><p>{event.mode === "Online async" ? "Self-paced" : `${event.time}–${event.endTime} HST`} · {event.campus}{registration.campus ? ` · ${registration.campus} registrant` : ""}</p>{dates.length > 1 ? <ol className="rsvp-session-list">{dates.map((date, index) => <li key={date}><b>Session {index + 1}</b><span>{formatAnalyticsDate(date)} · {event.time}–{event.endTime} HST</span></li>)}</ol> : <p>{formatEventDateRange(event)}</p>}<p className="reminder-state"><span aria-hidden="true">◴</span> {registration.waitlisted ? "Confirmation reminder begins if a place opens" : "24-hour reminder scheduled"}</p><a href={eventPermalink(event)}>Open event page<small>{eventPermalink(event)}</small></a>{event.accessUrl && !registration.waitlisted && <a className="protected-access-link" href={event.accessUrl} target="_blank" rel="noreferrer">Open protected session access<span className="sr-only"> (opens in a new tab)</span></a>}<a className="accommodation-link" href={`mailto:uhoic@hawaii.edu?subject=${encodeURIComponent(`Accommodation request: ${event.title}`)}`}>Request an accommodation</a></div><div className="my-rsvp-actions">{event.mode === "Hybrid" && !registration.waitlisted && <label><span>Attendance</span><select value={registration.attendance} onChange={(changeEvent) => onChangeAttendance(registration, changeEvent.target.value)}><option>In person</option><option>Virtual</option></select></label>}<button type="button" onClick={() => downloadCalendar(event, registration.attendance)}>Download calendar</button><button className="danger-button" type="button" onClick={() => { if (window.confirm(`Cancel your RSVP for ${event.title}?`)) onCancel(registration); }}>Cancel RSVP</button></div></article>; })}</div>}<p className="device-note">Draft behavior: registrations and events persist on this device. UH SSO and the shared transactional registration store are still required before production launch.</p></section>;
}

function EventCard({ event, onSelect, whyShown, canEdit = false, onEdit }: { event: EventItem; onSelect: (event: EventItem) => void; whyShown?: string; canEdit?: boolean; onEdit?: (event: EventItem) => void }) {
  const capacity = getCapacityDetails(event);
  const status = getEventStatus(event);
  const permalink = eventPermalink(event);
  const campusBrand = campusBrands[event.campus] ?? campusBrands["UH System"];
  return (
    <article className={`event-card ${campusBrand.className}`} id={`event-${event.id}`} tabIndex={-1}>
      <div className="event-date" aria-label={`${event.weekday}, ${event.month} ${event.day}`}><span>{event.month}</span><strong>{event.day}</strong><small>{event.weekday.slice(0, 3)}</small></div>
      <div className="event-details"><div className="event-meta"><CampusIdentity campus={event.campus} /><span className={`mode-pill ${modeClass(event.mode)}`}>● {formatModeLabel(event.mode)}</span></div>{whyShown && <p className="why-shown"><span aria-hidden="true">i</span>{whyShown}</p>}<h4>{event.title}</h4><div className="event-submeta"><span>{event.department}</span><span className="audience-scope-text">{eventAudienceLabel(event)}</span>{event.listingVisibility && event.listingVisibility !== "Public" && <span className="event-status private">{event.listingVisibility}</span>}{status && <span className={`event-status ${status.className}`}>{status.label}</span>}</div>{event.endDate && <p className="continuous-event-dates"><strong>{formatEventDateRange(event)}</strong></p>}<p>{event.summary}</p><div className="event-facts"><span><b aria-hidden="true">◷</b> {event.mode === "Online async" ? "Available anytime" : `${event.time}–${event.endTime} HST`}</span><span><b aria-hidden="true">⌖</b> {event.location}</span></div><a className="event-permalink" href={permalink} onClick={(clickEvent) => { clickEvent.preventDefault(); onSelect(event); }}><strong>View event page: {event.title}</strong><small>{permalink}</small></a>{event.officialUrl && <a className="official-event-link" href={event.officialUrl} target="_blank" rel="noreferrer"><strong>{eventSourceLinkLabel(event)}</strong><small>{event.officialUrl}</small><span className="sr-only"> (opens in a new tab)</span></a>}<div className="tag-row">{event.tags.map((tag) => <span key={tag}>{tag}</span>)}{event.series && <span className="series-tag">↻ {event.series}</span>}</div></div>
      <div className="event-action"><span className={capacity.low ? "capacity low" : "capacity"}>{capacity.primary}</span>{capacity.secondary && <small>{capacity.secondary}</small>}<button type="button" onClick={() => onSelect(event)}>Details &amp; RSVP <span aria-hidden="true">→</span></button>{canEdit && onEdit && <button className="authorized-edit-button" type="button" onClick={() => onEdit(event)}><span aria-hidden="true">✎</span> Edit authorized event</button>}</div>
    </article>
  );
}

function RsvpDialog({ event, registrations, onClose, onRegistered, dialogRef }: { event: EventItem; registrations: RegistrationRecord[]; onClose: () => void; onRegistered: (registration: RegistrationRecord) => void; dialogRef: React.RefObject<HTMLDivElement | null> }) {
  const fixedAttendance = event.mode === "Online sync" ? "Virtual" : event.mode === "In person" ? "In person" : event.mode === "Online async" ? "Self-paced" : "";
  const [attendance, setAttendance] = useState(fixedAttendance);
  const [errors, setErrors] = useState<{ attendance?: string; name?: string; email?: string; campus?: string; duplicate?: string }>({});
  const [linkCopied, setLinkCopied] = useState(false);
  const selectedSeats = attendance === "Virtual" ? nonnegativeCapacity(event.virtualSeats) : nonnegativeCapacity(event.seats);
  const waitlisted = event.capacityModel === "Waitlist only" || (event.capacityModel === "Limited" && event.mode !== "Online async" && selectedSeats === 0);
  function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    const name = String(data.get("name") || "").trim();
    const email = String(data.get("email") || "").trim().toLowerCase();
    const registrantCampus = String(data.get("campus") || "").trim();
    const nextErrors: { attendance?: string; name?: string; email?: string; campus?: string; duplicate?: string } = {};
    if (event.mode === "Hybrid" && !attendance) nextErrors.attendance = "Choose in-person or virtual attendance.";
    if (name.length < 2) nextErrors.name = "Enter your full name.";
    if (!/^[^\s@]+@hawaii\.edu$/i.test(email)) nextErrors.email = "Enter a valid @hawaii.edu email address.";
    if (!registrantCampus) nextErrors.campus = "Select your primary campus affiliation.";
    if (registrations.some((registration) => registration.eventId === event.id && registration.email === email)) nextErrors.duplicate = "This UH email is already registered for this opportunity. Use My RSVPs to manage it.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    onRegistered({ eventId: event.id, name, email, campus: registrantCampus || undefined, attendance, waitlisted, registeredAt: new Date().toISOString() });
  }
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rsvp-dialog" role="dialog" aria-modal="true" aria-labelledby="rsvp-title" aria-describedby="rsvp-summary" tabIndex={-1} ref={dialogRef}>
        <button className="dialog-close" type="button" aria-label="Close event details and RSVP" onClick={onClose}>×</button><p className="eyebrow dark">Event details &amp; registration</p><h2 id="rsvp-title">{event.title}</h2><p className="dialog-date">{formatEventDateRange(event)} · {event.mode === "Online async" ? "Available anytime" : `${event.time}–${event.endTime} HST`}</p>
        <div className="rsvp-summary" id="rsvp-summary"><section className="event-learning-outcome"><strong>What you’ll learn or practice</strong><p>{event.summary}</p></section><dl><div><dt>Hosted by</dt><dd>{event.campus} · {event.department}</dd></div><div><dt>Audience</dt><dd>UH faculty, instructors &amp; staff · {eventAudienceLabel(event)}</dd></div><div><dt>Format</dt><dd>{formatModeLabel(event.mode)}</dd></div><div><dt>Location/access</dt><dd>{event.location}</dd></div><div><dt>Topic(s)</dt><dd>{event.tags.join(", ")}</dd></div><div><dt>Last verified</dt><dd>{event.updatedAt ? new Date(event.updatedAt).toLocaleString("en-US", { timeZone: "Pacific/Honolulu", timeZoneName: "short" }) : "Published listing"}</dd></div></dl>{event.sessionDates && <div className="detail-series"><strong>Series dates</strong><ol>{event.sessionDates.map((date, index) => <li key={date}>Session {index + 1}: {formatAnalyticsDate(date)} · {event.time}–{event.endTime} HST</li>)}</ol></div>}<div className="detail-link-row"><a href={eventPermalink(event)}>Event page: {event.title}<small>{eventPermalink(event)}</small></a><button type="button" onClick={async () => { await navigator.clipboard?.writeText(eventPermalink(event)); setLinkCopied(true); }}>{linkCopied ? "Copied" : "Copy link"}</button></div><a className="detail-accommodation" href={`mailto:uhoic@hawaii.edu?subject=${encodeURIComponent(`Accommodation request: ${event.title}`)}`}>Request an accommodation or access support</a></div>
        <form onSubmit={submit} noValidate>
          {event.mode === "Hybrid" && <fieldset aria-invalid={Boolean(errors.attendance)} aria-describedby={errors.attendance ? "attendance-error" : undefined}><legend>How will you attend?</legend><div className="choice-grid">{[{ label: "In person", count: nonnegativeCapacity(event.seats) }, { label: "Virtual", count: nonnegativeCapacity(event.virtualSeats) }].map((choice) => <label key={choice.label} className={attendance === choice.label ? "choice active" : "choice"}><input type="radio" name="attendance" value={choice.label} checked={attendance === choice.label} onChange={() => { setAttendance(choice.label); setErrors((current) => ({ ...current, attendance: undefined })); }} /><strong>{choice.label}</strong><small>{event.capacityModel === "Unlimited" ? "Unlimited registration" : event.capacityModel === "Not applicable" ? "Capacity not listed" : event.capacityModel === "Waitlist only" || choice.count === 0 ? "Join waitlist" : `${choice.count} seats open`}</small></label>)}</div>{errors.attendance && <p id="attendance-error" className="field-error" role="alert">{errors.attendance}</p>}</fieldset>}
          <label className="form-field"><span>Full name</span><input name="name" autoComplete="name" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "name-error" : undefined} required /></label>{errors.name && <p id="name-error" className="field-error" role="alert">{errors.name}</p>}
          <label className="form-field"><span>UH email</span><input name="email" type="email" autoComplete="email" placeholder="name@hawaii.edu" aria-invalid={Boolean(errors.email || errors.duplicate)} aria-describedby={errors.email ? "email-note email-error" : errors.duplicate ? "email-note duplicate-error" : "email-note"} required /></label><small id="email-note">Draft validation checks the UH domain. Production registration will also require UH identity and employee-affiliation verification.</small>{errors.email && <p id="email-error" className="field-error" role="alert">{errors.email}</p>}{errors.duplicate && <p id="duplicate-error" className="field-error" role="alert">{errors.duplicate}</p>}
          <label className="form-field"><span>Primary campus affiliation</span><select name="campus" defaultValue="" required aria-invalid={Boolean(errors.campus)} aria-describedby={errors.campus ? "campus-note campus-error" : "campus-note"}><option value="">Select campus or UH System</option>{campusOptions.filter((item) => item !== "All campuses").map((item) => <option key={item}>{item}</option>)}</select></label><small id="campus-note">Choose where you primarily work; it does not have to match the event host.</small>{errors.campus && <p id="campus-error" className="field-error" role="alert">{errors.campus}</p>}
          <button className="submit-rsvp" type="submit">{waitlisted ? "Join waitlist" : "Confirm RSVP & add to calendar"}</button><p className="privacy-note">You’ll receive a 24-hour reminder and post-event message. You can cancel anytime.</p>
        </form>
      </div>
    </div>
  );
}

type PortalTab = "dashboard" | "intake" | "events" | "sources" | "attendance" | "analytics" | "contributors";

const intakeFillInTemplate = `Title:
Description:
Date:
Time:
Host campus:
Host unit:
Format:
Location/access:
Capacity:
Audience: UH faculty, instructors, and staff
Topics:
Event page:`;

const intakeSample = `Title: Using AI for Assignments
Description: Design responsible AI-supported assignments that preserve student voice and make learning visible.
Date: August 21, 2026–August 22, 2026
Time: 1:00–3:00 PM HST
Host campus: UH West Oʻahu
Host unit: Campus Instructional Design Office
Format: Hybrid
Location/access: UH West Oʻahu C208 and Zoom https://hawaii.zoom.us/j/123456789
Capacity: 24 in-person seats and 80 virtual seats
Audience: UH faculty, instructors, and staff
Topics: Generative AI, Assessment
Event page:`;

const intakeTemplates: Array<{ name: string; description: string; text: string }> = [
  { name: "Hybrid workshop", description: "Separate room and virtual capacities", text: intakeSample },
  { name: "Live webinar", description: "Virtual access and attendance report", text: `Title: Accessible Assessment in Lamakū\nDescription: Practice three ways to make online assessments clearer and more accessible.\nDate: October 14, 2026\nTime: 10:00–11:30 AM HST\nHost campus: UH West Oʻahu\nHost unit: Campus Instructional Design Office\nFormat: Online sync (live)\nLocation/access: Zoom\nCapacity: 100 virtual seats\nAudience: UH faculty, instructors, and staff\nTopics: Accessibility, Assessment, Lamakū\nEvent page:` },
  { name: "Self-paced course", description: "Availability window without seat counts", text: `Title: Designing Inclusive Course Materials\nDescription: Build an accessibility improvement plan for one course module.\nDate: October 1–December 18, 2026\nTime: Self-paced\nHost campus: UH West Oʻahu\nHost unit: Campus Instructional Design Office\nFormat: Online async (self-paced)\nLocation/access: Online self-paced course\nCapacity:\nAudience: UH faculty, instructors, and staff\nTopics: Accessibility, Active Learning\nEvent page:` },
];

function PlannerDashboard({ events, registrations, plannerAccount, hasDraft, onNavigate, onNewEvent }: { events: EventItem[]; registrations: RegistrationRecord[]; plannerAccount: PlannerProfile; hasDraft: boolean; onNavigate: (tab: PortalTab) => void; onNewEvent: () => void }) {
  const ownedEvents = events.filter((event) => plannerAccount.units.includes(event.department));
  const ownedIds = new Set(ownedEvents.map((event) => event.id));
  const upcoming = ownedEvents.filter((event) => event.status !== "Canceled" && (event.endDate ?? event.sessionDates?.at(-1) ?? event.date) >= presentDateKey);
  const activeRegistrations = registrations.filter((registration) => ownedIds.has(registration.eventId) && !registration.waitlisted);
  const capacityAlerts = upcoming.filter((event) => getCapacityDetails(event).low);
  const attendancePending = ownedEvents.filter((event) => (event.mode === "Online sync" || event.mode === "Hybrid") && event.providerStatus !== "Synced");
  const unitSourceReviews = initialSourceReviews.filter((review) => initialEventSources.some((source) => source.id === review.sourceId && plannerAccount.units.includes(source.ownerUnit) && review.resolution === "Pending"));
  const nextEvent = upcoming.slice().sort((a, b) => a.date.localeCompare(b.date))[0];
  return <>
    <PortalHeading eyebrow="Planner workspace" title="Planner overview" description="See what needs attention, continue unfinished work, and move directly to the task that matters." />
    <div className="planner-dashboard-metrics"><article><span>Upcoming owned events</span><strong>{upcoming.length}</strong><small>{nextEvent ? `Next: ${formatAnalyticsDate(nextEvent.date)}` : "No upcoming events"}</small></article><article><span>Active registrations</span><strong>{activeRegistrations.length}</strong><small>Authorized unit records</small></article><article><span>Needs attention</span><strong>{capacityAlerts.length + unitSourceReviews.length + attendancePending.length}</strong><small>Capacity, source, or sync review</small></article></div>
    <div className="planner-dashboard-grid">
      <section className="action-queue" aria-labelledby="action-queue-title"><div className="data-card-header"><div><h2 id="action-queue-title">Action queue</h2><p>Prioritized from records inside your approved unit scope.</p></div><span className="admin-note">{capacityAlerts.length + unitSourceReviews.length + attendancePending.length + (hasDraft ? 1 : 0)} items</span></div>
        <div className="action-queue-list">
          {hasDraft && <button type="button" onClick={() => onNavigate("intake")}><span className="queue-icon draft">✦</span><span><strong>Continue saved intake draft</strong><small>Review extracted fields and publication readiness.</small></span><b>Continue →</b></button>}
          {capacityAlerts.map((event) => <button type="button" key={`capacity-${event.id}`} onClick={() => onNavigate("events")}><span className="queue-icon urgent">!</span><span><strong>Review capacity: {event.title}</strong><small>{getCapacityDetails(event).primary} · {formatAnalyticsDate(event.date)}</small></span><b>Manage →</b></button>)}
          {unitSourceReviews.length > 0 && <button type="button" onClick={() => onNavigate("sources")}><span className="queue-icon urgent">⌁</span><span><strong>{unitSourceReviews.length} source change{unitSourceReviews.length === 1 ? "" : "s"} need review</strong><small>Critical fields remain unchanged until a planner decides.</small></span><b>Review →</b></button>}
          {attendancePending.length > 0 && <button type="button" onClick={() => onNavigate("attendance")}><span className="queue-icon">↻</span><span><strong>Attendance sync is not complete</strong><small>{attendancePending.length} live or hybrid event{attendancePending.length === 1 ? "" : "s"} in your unit.</small></span><b>Open sync →</b></button>}
          {!hasDraft && capacityAlerts.length === 0 && unitSourceReviews.length === 0 && attendancePending.length === 0 && <div className="queue-empty"><span aria-hidden="true">✓</span><div><strong>You’re caught up</strong><p>No planner actions need attention right now.</p></div></div>}
        </div>
      </section>
      <aside className="planner-quick-actions" aria-labelledby="quick-actions-title"><h2 id="quick-actions-title">Quick actions</h2><button type="button" className="primary" onClick={onNewEvent}><span aria-hidden="true">＋</span><strong>Create a new event</strong><small>Start with source text or a template</small></button><button type="button" onClick={() => onNavigate("analytics")}><span aria-hidden="true">▥</span><strong>Check registration demand</strong><small>Choose one or more events</small></button><button type="button" onClick={() => onNavigate("sources")}><span aria-hidden="true">⌁</span><strong>Review event sources</strong><small>Health, provenance, and changes</small></button></aside>
    </div>
    <details className="dashboard-production-note"><summary>Production connection status</summary><p>UH SSO, shared PostgreSQL storage, transactional email, and scheduled crawling are integration-ready requirements—not simulated live services in this prototype.</p></details>
  </>;
}

function PlannerPortal({ events, registrations, plannerAccount, plannerProfileId, onChangePlannerProfile, initialEditEvent, onClose, onPublish, onViewPublished }: { events: EventItem[]; registrations: RegistrationRecord[]; plannerAccount: PlannerProfile; plannerProfileId: string; onChangePlannerProfile: (id: string) => void; initialEditEvent: EventItem | null; onClose: () => void; onPublish: (event: EventItem) => void; onViewPublished: (event: EventItem) => void }) {
  const [tab, setTab] = useState<PortalTab>(initialEditEvent ? "intake" : "dashboard");
  const [rawText, setRawText] = useState(intakeFillInTemplate);
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [published, setPublished] = useState(false);
  const [approved, setApproved] = useState(false);
  const [draftReady, setDraftReady] = useState(false);

  useEffect(() => {
    if (initialEditEvent) {
      editEvent(initialEditEvent);
      setDraftReady(true);
      return;
    }
    try {
      const saved = JSON.parse(window.localStorage.getItem(draftStorageKey) || "null") as { rawText?: string; draft?: EventDraft | null } | null;
      if (saved?.rawText) setRawText(saved.rawText);
      if (saved?.draft?.confidence && saved.draft.sourceEvidence) setDraft(withDraftDefaults(saved.draft));
    } catch { /* Autosave is an optional device convenience. */ }
    setDraftReady(true);
    // The portal intentionally hydrates only once; changing the clicked event remounts it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draftReady) return;
    try { window.localStorage.setItem(draftStorageKey, JSON.stringify({ rawText, draft })); } catch { /* Keep the intake usable when storage is blocked. */ }
  }, [rawText, draft, draftReady]);

  function startNewEvent() {
    setRawText(intakeFillInTemplate);
    setDraft(null);
    setPublished(false);
    setTab("intake");
  }

  function editEvent(event: EventItem) {
    const capacityLine = event.mode === "Hybrid" ? `${nonnegativeCapacity(event.capacity)} in-person seats and ${nonnegativeCapacity(event.virtualCapacity)} virtual seats` : event.mode === "Online sync" ? `Capacity: ${nonnegativeCapacity(event.capacity)} virtual seats` : event.mode === "In person" ? `Capacity: ${nonnegativeCapacity(event.capacity)}` : "Open enrollment";
    const source = `${event.title}\n${event.weekday}, ${formatMonthLabel(event.date.slice(0, 7)).replace(/\s\d{4}$/, "")} ${Number(event.day)}, ${event.date.slice(0, 4)} from ${event.time}–${event.endTime}\n${event.mode}: ${event.location}\nHosted by ${event.campus} ${event.department}\n${capacityLine}\n${event.summary}\nFaculty and staff only\nAudience: ${eventAudienceLabel(event)}\nTopics: ${event.tags.join(", ")}`;
    setRawText(source);
    const parsed = parseEventText(source);
    setDraft({ ...parsed, sourceEventId: event.id, officialUrl: event.officialUrl ?? "", accessUrl: event.accessUrl ?? "", capacityModel: event.capacityModel ?? (event.mode === "Online async" ? "Not applicable" : "Limited"), seriesDates: event.sessionDates ?? (event.endDate ? [event.date, event.endDate] : [event.date]), scheduleInterpretation: event.sessionDates?.length ? "separate_sessions" : event.endDate ? "continuous_event" : "not_applicable", endDateTime: event.endDate ? `${event.endDate}${parsed.endDateTime.slice(10)}` : parsed.endDateTime, listingVisibility: event.listingVisibility ?? "Public", rosterVisibility: event.rosterVisibility ?? "Owner & collaborators", analyticsVisibility: event.analyticsVisibility ?? "Owner unit", collaborators: event.collaborators ?? [], provider: event.provider ?? (event.mode === "Online sync" || event.mode === "Hybrid" ? "Zoom" : "None"), externalMeetingId: event.externalMeetingId ?? "", audienceScope: event.audienceScope ?? (event.campus === "UH System" ? "All UH campuses" : "Host campus only"), eligibleCampuses: event.eligibleCampuses ?? [], sourceType: event.sourceType ?? "Manual flyer or text", hostVerification: event.hostVerification ?? "Planner confirmed" });
    setPublished(false);
    setTab("intake");
  }

  return (
    <div className="portal-app">
      <a className="skip-link" href="#portal-main">Skip to portal content</a>
      <aside className="portal-sidebar" aria-label="Contributor portal navigation">
        <div className="portal-brand"><UhSystemMark /><span><strong>PD Hub</strong><small>Contributor portal</small></span></div>
        <nav className="portal-nav" aria-label="Portal sections">
          <span className="portal-nav-section">Everyday</span>
          <button type="button" aria-current={tab === "dashboard" ? "page" : undefined} className={tab === "dashboard" ? "active" : ""} onClick={() => setTab("dashboard")}><span aria-hidden="true">⌂</span> Overview</button>
          <button type="button" aria-current={tab === "intake" ? "page" : undefined} className={tab === "intake" ? "active" : ""} onClick={() => setTab("intake")}><span aria-hidden="true">✦</span> AI Smart Intake</button>
          <button type="button" aria-current={tab === "events" ? "page" : undefined} className={tab === "events" ? "active" : ""} onClick={() => setTab("events")}><span aria-hidden="true">▤</span> Events</button>
          <button type="button" aria-current={tab === "analytics" ? "page" : undefined} className={tab === "analytics" ? "active" : ""} onClick={() => setTab("analytics")}><span aria-hidden="true">▥</span> Analytics</button>
          <span className="portal-nav-section">Advanced</span>
          <button type="button" aria-current={tab === "attendance" ? "page" : undefined} className={tab === "attendance" ? "active" : ""} onClick={() => setTab("attendance")}><span aria-hidden="true">↻</span> Attendance</button>
          <button type="button" aria-current={tab === "sources" ? "page" : undefined} className={tab === "sources" ? "active" : ""} onClick={() => setTab("sources")}><span aria-hidden="true">⌁</span> Website Sources</button>
          {plannerAccount.role === "Super Admin" && <button type="button" aria-current={tab === "contributors" ? "page" : undefined} className={tab === "contributors" ? "active" : ""} onClick={() => setTab("contributors")}><span aria-hidden="true">♙</span> Contributors</button>}
        </nav>
        <div className="sidebar-meta"><span className="status-dot"></span><div><strong>Approved contributor</strong><small>{plannerAccount.units.join(", ")} · {plannerAccount.campus}</small></div></div>
        <button className="return-button" type="button" onClick={onClose}>← Return to public site</button>
      </aside>

      <div className="portal-content">
        <header className="portal-header">
          <div><p>University of Hawaiʻi</p><strong>Professional Development Hub</strong></div>
          <label className="planner-profile-switch"><span>Demo planner scope</span><select value={plannerProfileId} onChange={(event) => onChangePlannerProfile(event.target.value)}>{plannerProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.campus} · {profile.units[0]}</option>)}</select></label>
          <div className="user-chip"><span aria-hidden="true">MD</span><div><strong>{plannerAccount.name}</strong><small>{plannerAccount.role} demo</small></div></div>
        </header>
        <main id="portal-main" className="portal-main">
          <details className="portal-system-note"><summary><span aria-hidden="true">↗</span><strong>Prototype access status</strong><small>Production details</small></summary><p>The role switcher demonstrates campus/unit permissions. Production access must require UH SSO, an employee-affiliation claim, manual contributor approval, and server-enforced RLS.</p></details>
          {tab === "dashboard" && <PlannerDashboard events={events} registrations={registrations} plannerAccount={plannerAccount} hasDraft={Boolean(draft)} onNavigate={setTab} onNewEvent={startNewEvent} />}
          {tab === "intake" && <SmartIntake events={events} plannerAccount={plannerAccount} rawText={rawText} setRawText={setRawText} draft={draft} setDraft={setDraft} published={published} setPublished={setPublished} onPublish={onPublish} onViewPublic={onViewPublished} />}
          {tab === "events" && <EventManagement events={events} registrations={registrations} authorizedUnits={plannerAccount.units} onNewEvent={startNewEvent} onEditEvent={editEvent} onUpsertEvent={onPublish} />}
          {tab === "sources" && <EventSources plannerAccount={plannerAccount} />}
          {tab === "attendance" && <AttendanceSync events={events.filter((event) => plannerAccount.units.includes(event.department) && (event.mode === "Online sync" || event.mode === "Hybrid"))} registrations={registrations} onUpdateEvent={onPublish} />}
          {tab === "analytics" && <Analytics authorizedUnit={plannerAccount.units[0]} events={events} registrations={registrations} />}
          {tab === "contributors" && plannerAccount.role === "Super Admin" && <Contributors approved={approved} setApproved={setApproved} />}
        </main>
        <footer className="portal-footer"><div><strong>Need help with the Professional Development Hub?</strong><span>For questions or technical problems, contact <a href="mailto:uhoic@hawaii.edu">uhoic@hawaii.edu</a>.</span></div><small>UH faculty, instructors, and staff support</small></footer>
      </div>
    </div>
  );
}

function PortalHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="portal-heading"><div><p className="eyebrow dark">{eyebrow}</p><h1>{title}</h1></div><p>{description}</p></div>;
}

function PlannerPublicCardPreview({ event, draft }: { event: EventItem; draft: EventDraft }) {
  const capacity = getCapacityDetails(event);
  const permalink = eventPermalink(event);
  const campusBrand = campusBrands[event.campus] ?? campusBrands["UH System"];
  const [facultyDetailOpen, setFacultyDetailOpen] = useState(false);
  return <section className="public-preview" aria-labelledby="public-preview-title">
    <div className="preview-heading"><div><strong id="public-preview-title">Live public card preview</strong><span>Every public-facing edit appears here immediately.</span></div><div><b><span aria-hidden="true">●</span> Updating live</b><button type="button" aria-expanded={facultyDetailOpen} onClick={() => setFacultyDetailOpen((current) => !current)}>{facultyDetailOpen ? "Hide faculty detail" : "View as faculty"}</button></div></div>
    <article className={`event-card planner-live-card ${campusBrand.className}`} aria-label={`Live preview of ${event.title}`}>
      <div className="event-date" aria-label={`${event.weekday}, ${event.month} ${event.day}`}><span>{event.month}</span><strong>{event.day}</strong><small>{event.weekday.slice(0, 3)}</small></div>
      <div className="event-details"><div className="event-meta"><CampusIdentity campus={event.campus} /><span className={`mode-pill ${modeClass(event.mode)}`}>● {formatModeLabel(event.mode)}</span></div><h4>{event.title || "Untitled opportunity"}</h4><div className="event-submeta"><span>{event.department || "Unit not selected"}</span><span className="audience-scope-text">{eventAudienceLabel(event)}</span>{event.listingVisibility && event.listingVisibility !== "Public" && <span className="event-status private">{event.listingVisibility}</span>}</div>{event.endDate && <p className="continuous-event-dates"><strong>{formatEventDateRange(event)}</strong></p>}<p>{event.summary || "Add a concise participant-focused description."}</p><div className="event-facts"><span><b aria-hidden="true">◷</b> {event.mode === "Online async" ? "Available anytime" : `${event.time}–${event.endTime} HST`}</span><span><b aria-hidden="true">⌖</b> {event.location || "Location not entered"}</span></div><span className="event-permalink preview-link"><strong>View event page: {event.title || "Untitled opportunity"}</strong><small>{permalink}</small></span>{event.officialUrl && <span className="official-event-link preview-link"><strong>{eventSourceLinkLabel(event)}</strong><small>{event.officialUrl}</small></span>}<div className="tag-row">{event.tags.length > 0 ? event.tags.map((tag) => <span key={tag}>{tag}</span>) : <span>No topic tags yet</span>}{event.series && <span className="series-tag">↻ {event.series}</span>}</div></div>
      <div className="event-action"><span className={capacity.low ? "capacity low" : "capacity"}>{capacity.primary}</span>{capacity.secondary && <small>{capacity.secondary}</small>}<span className="preview-rsvp-button">Details &amp; RSVP <span aria-hidden="true">→</span></span></div>
    </article>
    {facultyDetailOpen && <section className="faculty-detail-preview" aria-label="Faculty event detail preview"><div><p className="eyebrow dark">Faculty view</p><h3>{event.title}</h3><p>{formatEventDateRange(event)} · {event.mode === "Online async" ? "Available anytime" : `${event.time}–${event.endTime} HST`}</p></div><dl><div><dt>What you’ll learn</dt><dd>{event.summary}</dd></div><div><dt>Audience</dt><dd>{eventAudienceLabel(event)}</dd></div><div><dt>Location</dt><dd>{event.location}</dd></div><div><dt>Topics</dt><dd>{event.tags.join(", ")}</dd></div></dl><span>RSVP form follows this detail summary for faculty.</span></section>}
    <details className="preview-private-settings"><summary>Private settings—not displayed to faculty on the card</summary><dl><div><dt>Protected access</dt><dd>{draft.accessUrl ? "Saved for registrants" : "Not added"}</dd></div><div><dt>Attendance source</dt><dd>{draft.provider}{draft.externalMeetingId ? " · meeting ID saved" : ""}</dd></div><div><dt>Host evidence</dt><dd>{draft.hostVerification}</dd></div><div><dt>Named roster</dt><dd>{draft.rosterVisibility}</dd></div><div><dt>Analytics</dt><dd>{draft.analyticsVisibility}</dd></div><div><dt>Collaborators</dt><dd>{draft.collaborators.length}</dd></div><div><dt>UH audience</dt><dd>{draft.audienceConfirmed ? "Confirmed" : "Confirmation required"}</dd></div></dl></details>
  </section>;
}

function SmartIntake({ events, plannerAccount, rawText, setRawText, draft, setDraft, published, setPublished, onPublish, onViewPublic }: { events: EventItem[]; plannerAccount: PlannerProfile; rawText: string; setRawText: (value: string) => void; draft: EventDraft | null; setDraft: (value: EventDraft | null) => void; published: boolean; setPublished: (value: boolean) => void; onPublish: (event: EventItem) => void; onViewPublic: (event: EventItem) => void }) {
  const [tagInput, setTagInput] = useState("");
  const [collaboratorInput, setCollaboratorInput] = useState("");
  const [seriesDateInput, setSeriesDateInput] = useState("");
  const [draftSaved, setDraftSaved] = useState(false);
  const [lastPublishedEvent, setLastPublishedEvent] = useState<EventItem | null>(null);
  const [communicationPreview, setCommunicationPreview] = useState<"confirmation" | "reminder" | "update" | "followup">("confirmation");
  const [communicationNotice, setCommunicationNotice] = useState("");
  const authorizationIssues: DraftIssue[] = draft ? [
    ...(!plannerAccount.campuses.includes(draft.campus) ? [{ id: "unauthorized-campus", severity: "blocker" as const, message: `Your contributor account cannot publish for ${draft.campus || "this campus"}. Switch to an authorized planner scope or contact a Super Admin.` }] : []),
    ...(!plannerAccount.units.includes(draft.department) ? [{ id: "unauthorized-unit", severity: "blocker" as const, message: `Your contributor account is not approved to publish for ${draft.department || "this unit"}. Select an authorized owner unit.` }] : []),
  ] : [];
  const issues = draft ? [...getDraftIssues(draft), ...authorizationIssues] : [];
  const blockers = issues.filter((issue) => issue.severity === "blocker");
  const confidence = Math.max(35, 100 - blockers.length * 14 - (issues.length - blockers.length) * 6);
  const unitOptions = draft ? (campusUnitDirectory[draft.campus] ?? []).filter((unit) => plannerAccount.units.includes(unit)) : [];
  const duplicateEvent = draft ? events.find((event) => {
    if (event.id === draft.sourceEventId) return false;
    const dayDifference = Math.abs(new Date(`${event.date}T12:00:00Z`).getTime() - new Date(`${draft.startDateTime.slice(0, 10)}T12:00:00Z`).getTime()) / 86400000;
    return dayDifference <= 7 && event.department === draft.department && (normalizeFilterText(event.title) === normalizeFilterText(draft.title) || eventTitleSimilarity(event.title, draft.title) >= .6);
  }) : undefined;
  const previewEvent = draft && draft.startDateTime && draft.endDateTime && draft.title ? eventFromDraft(draft) : null;
  const readinessItems = draft ? [
    { label: "Event basics", ready: Boolean(draft.title.trim() && draft.description.trim()), target: "planner-event-basics" },
    { label: "Schedule", ready: Boolean(draft.startDateTime && draft.endDateTime && draft.scheduleInterpretation !== "needs_review"), target: "planner-schedule" },
    { label: "Ownership", ready: Boolean(draft.campus && draft.department && draft.hostVerification !== "Needs confirmation" && authorizationIssues.length === 0), target: "planner-ownership" },
    { label: "Delivery", ready: Boolean(draft.mode && draft.location && (draft.mode === "In person" || draft.mode === "Online async" || draft.accessUrl)), target: "planner-delivery" },
    { label: "Capacity", ready: draft.mode === "Online async" || draft.capacityModel !== "Limited" || (draft.mode === "Hybrid" ? draft.inPersonCapacity > 0 && draft.virtualCapacity > 0 : draft.mode === "Online sync" ? draft.virtualCapacity > 0 : draft.inPersonCapacity > 0), target: "planner-delivery" },
    { label: "UH audience", ready: draft.audienceConfirmed, target: "publish-title" },
  ] : [];
  const evidenceTarget = (field: string) => /title|description/i.test(field) ? "planner-event-basics" : /date|time|schedule/i.test(field) ? "planner-schedule" : /campus|department|host|source relationship/i.test(field) ? "planner-ownership" : /format|location|link/i.test(field) ? "planner-delivery" : "planner-event-basics";
  const messageSubject = !draft ? "" : communicationPreview === "confirmation" ? `Registration confirmed: ${draft.title}` : communicationPreview === "reminder" ? `Tomorrow: ${draft.title}` : communicationPreview === "update" ? `Updated details: ${draft.title}` : `Thank you for attending ${draft.title}`;
  function updateDraft<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
    if (!draft) return;
    setDraft({ ...draft, [key]: value });
    setPublished(false);
    setDraftSaved(false);
  }
  function addTag() {
    const tag = tagInput.trim();
    if (!draft || !tag || draft.tags.includes(tag)) return;
    updateDraft("tags", [...draft.tags, tag]);
    setTagInput("");
  }
  function addCollaborator() {
    const email = collaboratorInput.trim().toLowerCase();
    if (!draft || !/^[^\s@]+@hawaii\.edu$/i.test(email) || draft.collaborators.includes(email)) return;
    updateDraft("collaborators", [...draft.collaborators, email]);
    setCollaboratorInput("");
  }
  function replaceSeriesDates(nextDates: string[]) {
    if (!draft) return;
    const dates = Array.from(new Set(nextDates.filter(Boolean))).sort();
    const firstDate = dates[0] ?? draft.startDateTime.slice(0, 10);
    setDraft({ ...draft, seriesDates: dates, scheduleInterpretation: dates.length > 1 ? "separate_sessions" : "not_applicable", startDateTime: `${firstDate}${draft.startDateTime.slice(10)}`, endDateTime: `${firstDate}${draft.endDateTime.slice(10)}` });
    setPublished(false);
    setDraftSaved(false);
  }
  function confirmSchedule(interpretation: Exclude<ScheduleInterpretation, "needs_review" | "not_applicable">) {
    if (!draft) return;
    const firstDate = draft.seriesDates[0] ?? draft.startDateTime.slice(0, 10);
    const lastDate = draft.seriesDates.at(-1) ?? firstDate;
    setDraft({
      ...draft,
      scheduleInterpretation: interpretation,
      startDateTime: `${firstDate}${draft.startDateTime.slice(10)}`,
      endDateTime: `${interpretation === "continuous_event" ? lastDate : firstDate}${draft.endDateTime.slice(10)}`,
    });
    setPublished(false);
    setDraftSaved(false);
  }
  function changeAccessUrl(value: string) {
    if (!draft) return;
    const inferredProvider: SyncProvider = /teams\.microsoft/i.test(value) ? "Microsoft Teams" : /meet\.google/i.test(value) ? "Google Meet" : /zoom\.us/i.test(value) ? "Zoom" : draft.provider;
    setDraft({ ...draft, accessUrl: value, provider: inferredProvider, externalMeetingId: extractMeetingId(value, inferredProvider) || draft.externalMeetingId });
    setPublished(false);
    setDraftSaved(false);
  }
  function changeMode(nextMode: EventMode) {
    if (!draft) return;
    setDraft({
      ...draft,
      mode: nextMode,
      capacityModel: nextMode === "Online async" ? "Not applicable" : draft.capacityModel === "Not applicable" ? "Limited" : draft.capacityModel,
      inPersonCapacity: nextMode === "Online sync" || nextMode === "Online async" ? 0 : draft.inPersonCapacity,
      virtualCapacity: nextMode === "In person" || nextMode === "Online async" ? 0 : draft.virtualCapacity,
      provider: nextMode === "Online sync" || nextMode === "Hybrid" ? draft.provider === "None" ? "Zoom" : draft.provider : "None",
      externalMeetingId: nextMode === "Online sync" || nextMode === "Hybrid" ? draft.externalMeetingId : "",
    });
    setPublished(false);
    setDraftSaved(false);
  }
  function publishEvent() {
    if (!draft || blockers.length > 0 || duplicateEvent) return;
    const publishedEvent = eventFromDraft(draft);
    onPublish(publishedEvent);
    setLastPublishedEvent(publishedEvent);
    setPublished(true);
  }
  return (
    <>
      <PortalHeading eyebrow="Create an opportunity" title="AI Smart Intake" description="Fill in the labeled source form or paste what you already have. The intake assistant extracts the details, flags uncertainty, and requires your review before publication." />
      <div className="workflow-steps" aria-label="Three-step intake workflow"><span className="active"><b>1</b> Paste source</span><span className={draft ? "active" : ""}><b>2</b> Review details</span><span className={published ? "active" : ""}><b>3</b> Publish</span></div>

      {!draft ? (
        <section className="intake-card" aria-labelledby="paste-heading">
          <div className="card-title-row"><div><span className="feature-icon" aria-hidden="true">✦</span><div><h2 id="paste-heading">Enter or paste your event details</h2><p>Fill in the labeled form, choose a reusable example, or clear it and paste existing flyer or email text.</p></div></div><span className="prototype-badge">Review required</span></div>
          <div className="intake-templates" aria-labelledby="template-title"><div><strong id="template-title">Start from a reusable pattern</strong><small>Choosing a template replaces the source text below; you can edit it before extraction.</small></div><div>{intakeTemplates.map((template) => <button type="button" key={template.name} onClick={() => setRawText(template.text)}><span aria-hidden="true">＋</span><strong>{template.name}</strong><small>{template.description}</small></button>)}</div></div>
          <div className="intake-source-editor">
            <div className="textarea-title-row"><label className="textarea-label" htmlFor="raw-event">Source text fill-in form</label><button type="button" onClick={() => setRawText(intakeFillInTemplate)}>Restore empty labels</button></div>
            <textarea id="raw-event" value={rawText} onChange={(event) => setRawText(event.target.value)} rows={14} aria-describedby="source-text-help" />
            <p id="source-text-help">Type after each relevant label. Leave non-applicable lines blank; for ordinary source text, select Clear and paste it directly.</p>
          </div>
          <details className="source-policy-guide"><summary>How UHOIC event sources are attributed</summary><p><a href={uhoicAllEventsPageUrl} target="_blank" rel="noreferrer">All Upcoming Events<span className="sr-only"> (opens in a new tab)</span></a> is a shared discovery source; its listings retain the organizer named on the event detail. <a href={uhoicHostedPageUrl} target="_blank" rel="noreferrer">Webinars (UHOIC-hosted)<span className="sr-only"> (opens in a new tab)</span></a> is authoritative evidence that UHOIC is the host.</p></details>
          <div className="intake-actions"><p><span aria-hidden="true">◈</span> You will review every extracted field before publishing.</p><div><button className="secondary-button" type="button" disabled={!rawText} onClick={() => setRawText("")}>Clear</button><button type="button" disabled={!rawText.trim()} onClick={() => { setDraft(parseEventText(rawText)); setPublished(false); }}>Extract event details <span aria-hidden="true">→</span></button></div></div>
        </section>
      ) : (
        <div className="review-layout">
          <div>
            {published && <div className="success-banner" role="status"><span aria-hidden="true">✓</span><div><strong>Event published to the discovery feed</strong><p>It is now saved in this device-backed draft feed and available in the public preview.</p></div><button type="button" disabled={!lastPublishedEvent} onClick={() => lastPublishedEvent && onViewPublic(lastPublishedEvent)}>View public listing →</button></div>}
            <section className="intake-card review-card" aria-labelledby="review-heading">
              <div className="authorized-scope-note"><span aria-hidden="true">▣</span><div><strong>Authorized publishing scope</strong><p>{plannerAccount.campus} · {plannerAccount.units.join(", ")}. A mismatched campus or owner unit blocks publication.</p></div></div>
              <nav className="readiness-navigator" aria-label="Publication readiness"><div><strong>Publication readiness</strong><span>{readinessItems.filter((item) => item.ready).length} of {readinessItems.length} sections complete</span></div><ol>{readinessItems.map((item) => <li key={item.label}><button type="button" className={item.ready ? "ready" : "needs-review"} onClick={() => { const target = document.getElementById(item.target); target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); (target?.querySelector("input, select, textarea, button") as HTMLElement | null)?.focus({ preventScroll: true }); }}><span aria-hidden="true">{item.ready ? "✓" : "!"}</span>{item.label}</button></li>)}</ol></nav>
              <div className="review-score"><span className="score-ring">{confidence}</span><div><h2 id="review-heading">{blockers.length === 0 && !duplicateEvent ? "Ready for final review" : "Review required before publishing"}</h2><p>Confirm every field; highlighted issues are never silently guessed.</p></div><span className={blockers.length === 0 && !duplicateEvent ? "review-status" : "review-status needs-review"}>{duplicateEvent ? "Possible duplicate" : blockers.length === 0 ? "No blockers" : `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}`}</span></div>
              <div className="review-form">
                <label className="wide" id="planner-event-basics"><span>Event title <b className={`field-confidence ${draft.confidence.title.toLowerCase()}`}>{draft.confidence.title} confidence</b></span><input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} /></label>
                <label className="wide"><span>Description / participant outcome <b className={`field-confidence ${draft.confidence.description.toLowerCase()}`}>{draft.confidence.description} confidence</b></span><textarea rows={4} value={draft.description} placeholder="What will participants learn, practice, or leave with?" onChange={(event) => updateDraft("description", event.target.value)} /></label>
                <label id="planner-schedule"><span>{draft.mode === "Online async" ? "Available from" : "Start date & time"} <b className={`field-confidence ${draft.confidence.schedule.toLowerCase()}`}>{draft.confidence.schedule}</b></span><input type="datetime-local" value={draft.startDateTime} onChange={(event) => updateDraft("startDateTime", event.target.value)} /><small>Times are stored and displayed in Hawaiʻi Standard Time (HST).</small></label>
                <label><span>{draft.mode === "Online async" ? "Available until" : "End date & time"}</span><input type="datetime-local" value={draft.endDateTime} onChange={(event) => updateDraft("endDateTime", event.target.value)} /></label>
                <label id="planner-ownership"><span>Host campus <b className={`field-confidence ${draft.confidence.campus.toLowerCase()}`}>{draft.confidence.campus}</b></span><select value={draft.campus} onChange={(event) => { const nextCampus = event.target.value; setDraft({ ...draft, campus: nextCampus, department: plannerAccount.units.find((unit) => campusUnitDirectory[nextCampus]?.includes(unit)) ?? "", hostVerification: "Needs confirmation" }); setPublished(false); }}><option value="">Select a campus</option>{Array.from(new Set([...plannerAccount.campuses, draft.campus].filter(Boolean))).map((item) => <option key={item} disabled={!plannerAccount.campuses.includes(item)}>{item}{!plannerAccount.campuses.includes(item) ? " · not authorized" : ""}</option>)}</select></label>
                <label><span>Department / unit <b className={`field-confidence ${draft.confidence.department.toLowerCase()}`}>{draft.confidence.department}</b></span><select value={draft.department} disabled={!draft.campus} onChange={(event) => { setDraft({ ...draft, department: event.target.value, hostVerification: "Needs confirmation" }); setPublished(false); setDraftSaved(false); }}><option value="">{draft.campus ? "Select an approved unit" : "Select a campus first"}</option>{Array.from(new Set([...unitOptions, draft.department].filter(Boolean))).map((unit) => <option key={unit} disabled={!plannerAccount.units.includes(unit)}>{unit}{!plannerAccount.units.includes(unit) ? " · not authorized" : ""}</option>)}</select><small>Ownership stays with this institutional unit if staffing changes.</small></label>
                <div className="host-attribution-review wide"><label><span>Source relationship</span><select value={draft.sourceType} onChange={(event) => { setDraft({ ...draft, sourceType: event.target.value as EventSourceType, hostVerification: "Needs confirmation" }); setPublished(false); setDraftSaved(false); }}><option>Organizer page</option><option>Shared listings page</option><option>Manual flyer or text</option></select></label><p className={draft.sourceType === "Shared listings page" ? "source-relationship-warning" : ""}>{draft.sourceType === "Shared listings page" ? "A shared calendar proves the event was advertised there—not who organized it. Verify the host from the event detail or flyer." : "Use an organizer page only when it explicitly identifies the campus or unit as the host."}</p><label className="host-confirm"><input type="checkbox" checked={draft.hostVerification !== "Needs confirmation"} disabled={!draft.campus || !draft.department} onChange={(event) => updateDraft("hostVerification", event.target.checked ? "Planner confirmed" : "Needs confirmation")} /><span><strong>I verified the actual host</strong><small>{draft.hostVerification === "Verified organizer source" ? "The source explicitly identifies this organizer; changing the host requires reconfirmation." : "The selected unit organized the event and did not merely advertise it."}</small></span></label></div>
                <label><span>Who can attend?</span><select value={draft.audienceScope} onChange={(event) => { const nextScope = event.target.value as AudienceScope; setDraft({ ...draft, audienceScope: nextScope, eligibleCampuses: nextScope === "Selected campuses" ? draft.eligibleCampuses : [] }); setPublished(false); setDraftSaved(false); }}><option>All UH campuses</option><option>Host campus only</option><option>Selected campuses</option></select><small>This controls eligibility; it never changes the host attribution.</small></label>
                {draft.audienceScope === "Selected campuses" && <fieldset className="eligible-campus-selector"><legend>Eligible campuses</legend>{campusOptions.filter((item) => item !== "All campuses" && item !== "UH System").map((item) => <label key={item}><input type="checkbox" checked={draft.eligibleCampuses.includes(item)} onChange={(event) => updateDraft("eligibleCampuses", event.target.checked ? [...draft.eligibleCampuses, item] : draft.eligibleCampuses.filter((campusName) => campusName !== item))} /><span>{item}</span></label>)}</fieldset>}
                <label id="planner-delivery"><span>Delivery mode <b className={`field-confidence ${draft.confidence.mode.toLowerCase()}`}>{draft.confidence.mode}</b></span><select value={draft.mode} onChange={(event) => changeMode(event.target.value as EventMode)}>{modeOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <label><span>{draft.mode === "In person" ? "Room / public location" : "Public location label"} <b className={`field-confidence ${draft.confidence.location.toLowerCase()}`}>{draft.confidence.location}</b></span><input value={draft.location} placeholder={draft.mode === "Online sync" ? "Live online session" : draft.mode === "Online async" ? "Online self-paced course" : "Building and room"} onChange={(event) => updateDraft("location", event.target.value)} /><small>Shown publicly; do not place a protected meeting URL here.</small></label>
                <label className="wide"><span>Official event page URL <b className={`field-confidence ${draft.confidence.links.toLowerCase()}`}>{draft.confidence.links}</b></span><input type="url" inputMode="url" value={draft.officialUrl} placeholder="https://unit.hawaii.edu/descriptive-event-page" onChange={(event) => updateDraft("officialUrl", event.target.value)} /><small>Optional public source page. The hub always creates its own descriptive event link.</small></label>
                {draft.mode !== "In person" && <label className="wide protected-field"><span>Protected access URL</span><input type="url" inputMode="url" value={draft.accessUrl} placeholder="https://hawaii.zoom.us/..." onChange={(event) => changeAccessUrl(event.target.value)} /><small>Never displayed in the public card; included only in authorized reminders and My RSVPs.</small></label>}
                {(draft.mode === "Online sync" || draft.mode === "Hybrid") && <><label><span>Attendance provider</span><select value={draft.provider} onChange={(event) => { const nextProvider = event.target.value as SyncProvider; setDraft({ ...draft, provider: nextProvider, externalMeetingId: extractMeetingId(draft.accessUrl, nextProvider) || draft.externalMeetingId }); setPublished(false); }}><option>Zoom</option><option>Microsoft Teams</option><option>Google Meet</option><option>None</option></select><small>Choose the platform that will supply the attendance report.</small></label><label className="protected-field"><span>Meeting ID / UUID</span><input value={draft.externalMeetingId} placeholder="Enter the provider meeting identifier" onChange={(event) => updateDraft("externalMeetingId", event.target.value)} /><small>Private matching key; never shown on public event cards.</small></label></>}
              </div>
              {draft.scheduleInterpretation === "needs_review" && <fieldset className="schedule-clarifier"><legend>How should this date range work?</legend><p>The source contains multiple dates. Choose the intended registration and calendar behavior before publishing.</p><div><button type="button" onClick={() => confirmSchedule("separate_sessions")}><strong>Separate daily sessions</strong><span>One parent RSVP with a calendar entry and reminder for each day.</span></button><button type="button" onClick={() => confirmSchedule("continuous_event")}><strong>One continuous multi-day event</strong><span>One calendar event running from the first date through the last date.</span></button></div></fieldset>}
              {draft.scheduleInterpretation === "continuous_event" && <div className="continuous-schedule-note"><span aria-hidden="true">✓</span><div><strong>Continuous multi-day schedule</strong><p>{formatAnalyticsDate(draft.startDateTime.slice(0, 10))}–{formatAnalyticsDate(draft.endDateTime.slice(0, 10))}. Change the start or end field above if needed.</p></div><button type="button" onClick={() => confirmSchedule("separate_sessions")}>Use separate sessions instead</button></div>}
              {draft.scheduleInterpretation !== "continuous_event" && draft.seriesDates.length <= 1 && <details className="series-starter"><summary>Make this a multi-session series</summary><p>Faculty RSVP once; each date gets its own calendar entry and reminder.</p><div><input aria-label="Additional session date" type="date" min={draft.startDateTime.slice(0, 10)} value={seriesDateInput} onChange={(event) => setSeriesDateInput(event.target.value)} /><button type="button" disabled={!seriesDateInput || draft.seriesDates.includes(seriesDateInput)} onClick={() => { replaceSeriesDates([draft.startDateTime.slice(0, 10), seriesDateInput]); setSeriesDateInput(""); }}>+ Add session</button></div></details>}
              {draft.scheduleInterpretation === "separate_sessions" && draft.seriesDates.length > 1 && <section className="series-review" aria-labelledby="detected-series-title"><div><strong id="detected-series-title">Recurring series detected</strong><span>{draft.seriesDates.length} child sessions · one parent RSVP</span></div><ol>{draft.seriesDates.map((date, index) => <li key={`${date}-${index}`}><span>Session {index + 1}</span><input aria-label={`Date for session ${index + 1}`} type="date" value={date} onChange={(event) => replaceSeriesDates(draft.seriesDates.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><button type="button" aria-label={`Remove session ${index + 1}`} onClick={() => replaceSeriesDates(draft.seriesDates.filter((_, itemIndex) => itemIndex !== index))}>Remove</button></li>)}</ol><div className="series-add"><label><span className="sr-only">Add a child session date</span><input type="date" min={draft.startDateTime.slice(0, 10)} value={seriesDateInput} onChange={(event) => setSeriesDateInput(event.target.value)} /></label><button type="button" disabled={!seriesDateInput || draft.seriesDates.includes(seriesDateInput)} onClick={() => { replaceSeriesDates([...draft.seriesDates, seriesDateInput]); setSeriesDateInput(""); }}>+ Add session</button></div><p>Each child session receives its own calendar entry and 24-hour reminder.</p><button type="button" className="series-interpretation-switch" onClick={() => confirmSchedule("continuous_event")}>Treat as one continuous event instead</button></section>}
              {draft.mode !== "Online async" ? <fieldset className="capacity-builder"><legend>Registration and capacity</legend><label className="capacity-model"><span>Capacity model</span><select value={draft.capacityModel} onChange={(event) => updateDraft("capacityModel", event.target.value as EventDraft["capacityModel"])}><option>Limited</option><option>Unlimited</option><option>Waitlist only</option><option value="Not applicable">Capacity not listed</option></select></label>{draft.capacityModel === "Limited" && <div>{(draft.mode === "Hybrid" || draft.mode === "In person") && <label><span>In-person capacity</span><input type="number" min="0" step="1" inputMode="numeric" value={draft.inPersonCapacity} onInput={preventNegativeCapacity} onChange={(event) => updateDraft("inPersonCapacity", Math.max(0, Number(event.target.value)))} /></label>}{(draft.mode === "Hybrid" || draft.mode === "Online sync") && <label><span>Virtual capacity</span><input type="number" min="0" step="1" inputMode="numeric" value={draft.virtualCapacity} onInput={preventNegativeCapacity} onChange={(event) => updateDraft("virtualCapacity", Math.max(0, Number(event.target.value)))} /></label>}</div>}<p>{draft.capacityModel === "Limited" ? draft.mode === "Hybrid" ? "Separate nonnegative capacities create independent in-person and virtual waitlists." : "Enter the actual available capacity; values can never be negative." : draft.capacityModel === "Unlimited" ? "Registration remains open without a seat counter." : draft.capacityModel === "Not applicable" ? "No seat total is shown; registration remains available." : "Every registration starts on the waitlist."}</p></fieldset> : <div className="async-capacity-note"><strong>Capacity not applicable</strong><p>Self-paced opportunities use an availability window and never show in-person seating.</p></div>}
              <div className="tag-editor"><span>Topic tags</span><div>{draft.tags.map((tag) => <button type="button" key={tag} aria-label={`Remove ${tag} tag`} onClick={() => updateDraft("tags", draft.tags.filter((item) => item !== tag))}>{tag} <b aria-hidden="true">×</b></button>)}</div><div className="standard-tag-choices" aria-label="Standard topic suggestions">{standardizedTopics.filter((tag) => !draft.tags.includes(tag)).map((tag) => <button type="button" key={tag} onClick={() => updateDraft("tags", [...draft.tags, tag])}>+ {tag}</button>)}</div><div className="tag-entry"><input aria-label="New topic tag" list="planner-topic-suggestions" value={tagInput} placeholder="Add another topic" onChange={(event) => setTagInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTag(); } }} /><datalist id="planner-topic-suggestions"><option value="Open Educational Resources" /><option value="Research" /><option value="Leadership" /><option value="Advising" /></datalist><button type="button" className="add-tag" onClick={addTag}>+ Add tag</button></div></div>
              {duplicateEvent && <div className="duplicate-warning" role="alert"><span aria-hidden="true">!</span><div><strong>Possible duplicate found</strong><p>“{duplicateEvent.title}” already exists on {formatAnalyticsDate(duplicateEvent.date)}. Open the existing event to edit it instead of publishing a second record.</p></div></div>}
              <details className="source-evidence"><summary>See what the intake extracted from your source</summary><p>Each excerpt stays linked to the field it informed, so planners can verify the source without rescanning the whole flyer.</p><dl>{draft.sourceEvidence.map((item) => <div key={item.field}><dt>{item.field}</dt><dd><span>{item.excerpt}</span><button type="button" onClick={() => { const target = document.getElementById(evidenceTarget(item.field)); target?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }); (target?.querySelector("input, select, textarea") as HTMLElement | null)?.focus({ preventScroll: true }); }}>Review linked field</button></dd></div>)}</dl></details>
              {previewEvent && <PlannerPublicCardPreview event={previewEvent} draft={draft} />}
            </section>
          </div>
          <aside className="review-sidebar">
            <section className="audit-panel" aria-labelledby="audit-title"><div className="audit-title"><span aria-hidden="true">{blockers.length === 0 ? "✓" : "!"}</span><div><h2 id="audit-title">Accessibility & data check</h2><p>{blockers.length === 0 ? "No publication blockers found." : "Resolve blockers before publishing."}</p></div></div>{issues.length > 0 ? issues.map((issue) => <div className={`audit-item ${issue.severity === "blocker" ? "warning" : "pass"}`} key={issue.id}><span aria-hidden="true">{issue.severity === "blocker" ? "!" : "i"}</span><div><strong>{issue.severity === "blocker" ? "Action required" : "Please verify"}</strong><p>{issue.message}</p></div></div>) : <div className="audit-item pass"><span aria-hidden="true">✓</span><div><strong>Ready to publish</strong><p>Required details, audience scope, and accessibility checks are complete.</p></div></div>}<button className="audit-source-button" type="button" onClick={() => { setDraft(null); setPublished(false); }}>← Revise source text</button></section>
            <section className="privacy-builder" aria-labelledby="privacy-title"><div><p className="eyebrow dark">Access control</p><h2 id="privacy-title">Privacy & collaborators</h2><p>Choose who can discover the event and who can see named registration data.</p></div><label><span>Listing visibility</span><select value={draft.listingVisibility} onChange={(event) => updateDraft("listingVisibility", event.target.value as ListingVisibility)}><option>Public</option><option>Unlisted</option><option>Private invitation</option></select><small>Unlisted events require the link; private invitations require authorization.</small></label><label><span>Named roster access</span><select value={draft.rosterVisibility} onChange={(event) => updateDraft("rosterVisibility", event.target.value as RosterVisibility)}><option>Owner &amp; collaborators</option><option>Owner unit</option><option>Campus data stewards</option></select></label><label><span>Analytics access</span><select value={draft.analyticsVisibility} onChange={(event) => updateDraft("analyticsVisibility", event.target.value as AnalyticsVisibility)}><option>Event team</option><option>Owner unit</option><option>Campus aggregates</option><option>UH System aggregates</option></select></label><div className="collaborator-editor"><span>Event collaborators</span>{draft.collaborators.length > 0 && <div>{draft.collaborators.map((email) => <button type="button" key={email} onClick={() => updateDraft("collaborators", draft.collaborators.filter((item) => item !== email))} aria-label={`Remove ${email}`}>{email} <b aria-hidden="true">×</b></button>)}</div>}<label><span className="sr-only">UH collaborator email</span><input type="email" value={collaboratorInput} placeholder="colleague@hawaii.edu" onChange={(event) => setCollaboratorInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCollaborator(); } }} /></label><button type="button" disabled={!/^[^\s@]+@hawaii\.edu$/i.test(collaboratorInput.trim())} onClick={addCollaborator}>Add collaborator</button></div><p className="privacy-continuity-note"><span aria-hidden="true">▣</span> Emergency Super Admin access is logged and reserved for institutional continuity.</p></section>
            <section className="publish-panel" aria-labelledby="publish-title"><div className="publish-panel-heading"><h2 id="publish-title">Publish event</h2><p>Confirm ownership and audience before making this opportunity discoverable.</p></div><div className="source-note"><strong>Institutional ownership</strong><p>This event belongs to <b>{draft.department || "the selected unit"}</b>—not an individual account.</p></div><label className="audience-confirm"><input type="checkbox" checked={draft.audienceConfirmed} onChange={(event) => updateDraft("audienceConfirmed", event.target.checked)} /><span><strong>UH employee audience only</strong><small>Faculty, instructors, and staff; no student-facing registration.</small></span></label><p className="autosave-note"><span aria-hidden="true">✓</span> Changes are autosaved on this device.</p>{draftSaved && <p className="save-status" role="status">✓ Draft saved on this device.</p>}<div className="publish-stack"><button className="publish-button" type="button" disabled={blockers.length > 0 || Boolean(duplicateEvent) || published} onClick={publishEvent}>{published ? "Published" : duplicateEvent ? "Review duplicate" : blockers.length > 0 ? `Resolve ${blockers.length} blocker${blockers.length === 1 ? "" : "s"}` : "Publish event"}</button><button className="secondary-button" type="button" onClick={() => setDraftSaved(true)}>Save on this device</button></div></section>
            <section className="communication-preview" aria-labelledby="communication-preview-title"><div><p className="eyebrow dark">Participant communications</p><h2 id="communication-preview-title">Preview before publish</h2><p>Check the words and details participants will receive. No message is sent from this prototype.</p></div><div className="communication-tabs" role="tablist" aria-label="Message type">{(["confirmation", "reminder", "update", "followup"] as const).map((messageType) => <button type="button" role="tab" aria-selected={communicationPreview === messageType} className={communicationPreview === messageType ? "active" : ""} key={messageType} onClick={() => { setCommunicationPreview(messageType); setCommunicationNotice(""); }}>{messageType === "followup" ? "Post-event" : messageType[0].toUpperCase() + messageType.slice(1)}</button>)}</div><div className="message-preview" role="tabpanel"><span>Subject</span><strong>{messageSubject}</strong><p>{communicationPreview === "confirmation" ? `Your registration is confirmed. ${formatAnalyticsDate(draft.startDateTime.slice(0, 10))}${draft.mode === "Online async" ? "" : ` at ${formatDraftTime(draft.startDateTime)} HST`}.` : communicationPreview === "reminder" ? `This is your 24-hour reminder. Current access details will appear securely in My RSVPs.` : communicationPreview === "update" ? `The event team updated a critical detail. The message will show the old and new value side by side.` : `Thank you for participating. The event team can add resources, presenter recognition, and a short feedback link.`}</p></div><button className="secondary-button" type="button" onClick={() => setCommunicationNotice("Preview checked. Production test email requires the transactional email integration.")}>Mark preview checked</button>{communicationNotice && <p className="communication-notice" role="status">{communicationNotice}</p>}</section>
          </aside>
        </div>
      )}
    </>
  );
}

function EventManagement({ events, registrations, authorizedUnits, onNewEvent, onEditEvent, onUpsertEvent }: { events: EventItem[]; registrations: RegistrationRecord[]; authorizedUnits: string[]; onNewEvent: () => void; onEditEvent: (event: EventItem) => void; onUpsertEvent: (event: EventItem) => void }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [ownerSelections, setOwnerSelections] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState("");
  const [versionHistory, setVersionHistory] = useState<Array<{ id: string; action: string; savedAt: string; snapshot: EventItem }>>([]);
  const authorizedEvents = events.filter((event) => authorizedUnits.includes(event.department));
  const managedEvents = authorizedEvents.slice().sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  const activeCount = authorizedEvents.filter((event) => event.status !== "Canceled").length;
  const lowCapacityCount = authorizedEvents.filter((event) => event.status !== "Canceled" && getCapacityDetails(event).low).length;
  const authorizedEventIds = new Set(authorizedEvents.map((event) => event.id));
  const upcomingRegistrationCount = registrations.filter((registration) => authorizedEventIds.has(registration.eventId) && !registration.waitlisted).length;

  function cloneEvent(event: EventItem) {
    onEditEvent({ ...event, id: Date.now(), title: `${event.title} (Copy)`, status: "Published", updatedAt: undefined });
  }

  function changeStatus(event: EventItem) {
    const canceling = event.status !== "Canceled";
    if (canceling && !window.confirm(`Cancel “${event.title}”? The record and registrations will be retained, and registered participants should receive a cancellation notice.`)) return;
    setVersionHistory((current) => [{ id: `${event.id}-${Date.now()}`, action: canceling ? "Before cancellation" : "Before restoration", savedAt: new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu", timeZoneName: "short" }), snapshot: { ...event } }, ...current].slice(0, 6));
    onUpsertEvent({ ...event, status: canceling ? "Canceled" : "Published", updatedAt: new Date().toISOString() });
    setNotice(canceling ? `${event.title} was canceled; its record was retained.` : `${event.title} was restored to the public feed.`);
  }

  return (
    <>
      <PortalHeading eyebrow="Department-owned records" title="Manage events" description="Edit, duplicate, reassign, cancel, restore, and audit opportunities without breaking their registrations or institutional history." />
      {notice && <div className="management-notice" role="status"><span aria-hidden="true">✓</span><p>{notice}</p><button type="button" aria-label="Dismiss status message" onClick={() => setNotice("")}>×</button></div>}
      <div className="metric-row compact"><article><span>Active events</span><strong>{activeCount}</strong><small>Across approved owner units</small></article><article><span>Upcoming registrations</span><strong>{upcomingRegistrationCount}</strong><small>Saved on this device</small></article><article><span>Needs attention</span><strong className="orange">{lowCapacityCount}</strong><small>Low capacity or waitlist</small></article></div>
      <section className="data-card" aria-labelledby="owned-events-title">
        <div className="data-card-header"><div><h2 id="owned-events-title">Owned event records</h2><p>Records continue even when contributor assignments change. Actions keep a visible audit trail.</p></div><button type="button" onClick={onNewEvent}>+ New event</button></div>
        <div className="table-wrap"><table><caption className="sr-only">Events owned by authorized University of Hawaiʻi units</caption><thead><tr><th scope="col">Event</th><th scope="col">Owner unit</th><th scope="col">Date</th><th scope="col">Availability</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>
          {managedEvents.map((event) => {
            const capacity = getCapacityDetails(event);
            const selectedOwner = ownerSelections[event.id] ?? event.department;
            const ownerOptions = authorizedUnits;
            return <Fragment key={event.id}><tr className={event.status === "Canceled" ? "canceled-row" : ""}><td><strong>{event.title}</strong><small>{formatModeLabel(event.mode)} · {event.location}</small></td><td>{event.department}</td><td>{formatEventDateRange(event)}</td><td><b>{capacity.primary}</b><small>{capacity.secondary}</small></td><td><span className={`table-status ${event.status === "Canceled" ? "flag" : event.status === "Updated" ? "draft" : "live"}`}>{event.status ?? "Published"}</span></td><td><div className="row-actions"><button type="button" className="table-action" aria-label={`Edit ${event.title}`} onClick={() => onEditEvent(event)}>Edit</button><button type="button" className="table-action" aria-expanded={expandedId === event.id} aria-controls={`manage-event-${event.id}`} onClick={() => setExpandedId((current) => current === event.id ? null : event.id)}>More</button></div></td></tr>{expandedId === event.id && <tr className="event-management-detail"><td colSpan={6}><div id={`manage-event-${event.id}`}><section><strong>Record actions</strong><p>Duplicate for a related session, or cancel while retaining registration history.</p><div><button type="button" onClick={() => cloneEvent(event)}>Duplicate as draft</button><button type="button" className={event.status === "Canceled" ? "" : "danger-action"} onClick={() => changeStatus(event)}>{event.status === "Canceled" ? "Restore event" : "Cancel event"}</button></div></section><section><strong>Institutional owner</strong><label><span className="sr-only">Owner unit for {event.title}</span><select value={selectedOwner} onChange={(changeEvent) => setOwnerSelections((current) => ({ ...current, [event.id]: changeEvent.target.value }))}>{Array.from(new Set([...ownerOptions, event.department])).map((unit) => <option key={unit}>{unit}</option>)}</select></label><button type="button" disabled={selectedOwner === event.department} onClick={() => { onUpsertEvent({ ...event, department: selectedOwner, status: "Updated", updatedAt: new Date().toISOString() }); setNotice(`${event.title} was reassigned to ${selectedOwner}.`); }}>Reassign</button><small>Cross-unit reassignment requires a Super Admin; contributors cannot grant themselves another unit’s access.</small></section><section className="audit-summary"><strong>Access &amp; audit snapshot</strong><dl><div><dt>Record ID</dt><dd>UH-PD-{event.id}</dd></div><div><dt>Listing</dt><dd>{event.listingVisibility ?? "Public"}</dd></div><div><dt>Named roster</dt><dd>{event.rosterVisibility ?? "Owner & collaborators"}</dd></div><div><dt>Provider</dt><dd>{event.provider ?? "Not connected"} · {event.providerStatus ?? "Not connected"}</dd></div><div><dt>Last change</dt><dd>{event.updatedAt ? new Date(event.updatedAt).toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }) : "Initial publication"}</dd></div><div><dt>Permalink</dt><dd><a href={eventPermalink(event)}>{event.title}</a></dd></div></dl></section></div></td></tr>}</Fragment>;
          })}
        </tbody></table></div>
      </section>
      <section className="version-history-card" aria-labelledby="version-history-title"><div className="data-card-header"><div><h2 id="version-history-title">Version history &amp; undo</h2><p>Before a destructive status change, the previous event record is saved here for recovery.</p></div><span className="admin-note">Device draft history</span></div>{versionHistory.length > 0 ? <ol>{versionHistory.map((version) => <li key={version.id}><div><strong>{version.action}: {version.snapshot.title}</strong><small>{version.savedAt} · {version.snapshot.status ?? "Published"}</small></div><button type="button" onClick={() => { onUpsertEvent({ ...version.snapshot, updatedAt: new Date().toISOString() }); setNotice(`Restored the saved version of ${version.snapshot.title}.`); }}>Restore this version</button></li>)}</ol> : <div className="version-empty"><span aria-hidden="true">↶</span><p>No restorable versions yet. Editing an event keeps its institutional audit snapshot; canceling or restoring creates an undo point here.</p></div>}</section>
      <section className="series-card" aria-labelledby="series-title"><div className="series-icon" aria-hidden="true">↻</div><div><h2 id="series-title">Parent–child series integrity</h2><p>The Assessment for Learning Institute has one parent registration and four child reminders/calendar entries.</p></div><ol><li><span>Session 1</span><b>Sep 11</b></li><li><span>Session 2</span><b>Sep 18</b></li><li><span>Session 3</span><b>Sep 25</b></li><li><span>Session 4</span><b>Oct 2</b></li></ol></section>
      <section className="automation-card" aria-labelledby="automation-title"><div><p className="eyebrow dark">Lifecycle automation</p><h2 id="automation-title">Communication readiness</h2><p>The interface is ready for reminder and change-notification jobs when the production email service and registration database are connected.</p></div><ul><li><span className="auto-icon">24h</span><div><strong>Event reminder</strong><small>Includes calendar file and access details</small></div><b>Integration ready</b></li><li><span className="auto-icon">Δ</span><div><strong>Critical detail updates</strong><small>Time, room, and access link</small></div><b>Integration ready</b></li><li><span className="auto-icon">M</span><div><strong>Post-event digest</strong><small>1–2 hours after the event</small></div><b>Integration ready</b></li></ul><aside><strong>Phase 2 variance protocol reserved</strong><p>Scraper conflicts will surface a 12-hour resolution timer and an “Unconfirmed Location Change” badge.</p></aside></section>
    </>
  );
}

type SourceWorkspaceView = "registry" | "review" | "history";

function sourceStatusClass(status: SourceStatus) {
  if (status === "Healthy") return "live";
  if (status === "Review needed" || status === "Connection issue") return "flag";
  return "draft";
}

function sourcePolicyCopy(relationship: SourceRelationship) {
  if (relationship === "Shared listing") return "Discovery evidence only. Never infer the host from this page; verify the organizer on the event detail or flyer.";
  if (relationship === "Organizer page") return "The source may propose its named unit as host, but host changes still require human review.";
  if (relationship === "Campus calendar") return "The campus is a discovery boundary, not necessarily the organizer. Verify the responsible unit for every event.";
  return "Use explicit organizer fields when available. New or changed owner units always require review.";
}

function EventSources({ plannerAccount }: { plannerAccount: PlannerProfile }) {
  const [sources, setSources] = useState<EventSourceRecord[]>(initialEventSources);
  const [reviews, setReviews] = useState<SourceReviewRecord[]>(initialSourceReviews);
  const [audits, setAudits] = useState<SourceAuditRecord[]>(initialSourceAudits);
  const [view, setView] = useState<SourceWorkspaceView>("registry");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All statuses" | SourceStatus>("All statuses");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkFrequency, setBulkFrequency] = useState<ScanFrequency>("Daily");
  const [sourceDraft, setSourceDraft] = useState<EventSourceRecord | null>(null);
  const [testedUrl, setTestedUrl] = useState("");
  const [testResult, setTestResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(sourceRegistryStorageKey) || "null") as { sources?: EventSourceRecord[]; reviews?: SourceReviewRecord[]; audits?: SourceAuditRecord[] } | null;
      if (saved?.sources?.length) setSources(saved.sources);
      if (saved?.reviews?.length) setReviews(saved.reviews);
      if (saved?.audits?.length) setAudits(saved.audits);
    } catch { /* The prototype remains usable when device storage is unavailable. */ }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try { window.localStorage.setItem(sourceRegistryStorageKey, JSON.stringify({ sources, reviews, audits })); } catch { /* Production uses a protected shared source registry. */ }
  }, [sources, reviews, audits, storageReady]);

  useEffect(() => {
    setSelectedIds(new Set());
    setSourceDraft(null);
    setNotice("");
  }, [plannerAccount.id]);

  const canManage = (source: EventSourceRecord) => plannerAccount.role === "Super Admin" || plannerAccount.units.includes(source.ownerUnit);
  const scopedSources = sources.filter(canManage);
  const filteredSources = scopedSources.filter((source) => {
    const searchable = normalizeFilterText(`${source.name} ${source.url} ${source.relationship} ${source.ownerCampus} ${source.ownerUnit}`);
    return (!query || searchable.includes(normalizeFilterText(query))) && (statusFilter === "All statuses" || source.status === statusFilter);
  });
  const scopedSourceIds = new Set(scopedSources.map((source) => source.id));
  const scopedReviews = reviews.filter((review) => scopedSourceIds.has(review.sourceId)).sort((a, b) => Number(a.resolution !== "Pending") - Number(b.resolution !== "Pending"));
  const pendingReviews = scopedReviews.filter((review) => review.resolution === "Pending");
  const scopedAudits = audits.filter((audit) => scopedSourceIds.has(audit.sourceId));
  const selectedSources = scopedSources.filter((source) => selectedIds.has(source.id));
  const sourceName = (id: string) => sources.find((source) => source.id === id)?.name ?? "Archived source";

  function currentAuditTime() {
    return new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function addAudit(sourceId: string, action: string) {
    setAudits((current) => [{ id: `audit-${Date.now()}-${Math.random()}`, sourceId, action, actor: plannerAccount.name, timestamp: currentAuditTime() }, ...current]);
  }

  function startNewSource() {
    setSourceDraft({ id: `source-${Date.now()}`, name: "", url: "", relationship: "Organizer page", ownerCampus: plannerAccount.campus, ownerUnit: plannerAccount.units[0], frequency: "Daily", approvalPolicy: "Review all changes", status: "Paused", lastChecked: "Not checked", nextScan: "After activation", importedEvents: 0, pendingChanges: 0, notes: "" });
    setTestedUrl("");
    setTestResult(null);
    setNotice("");
  }

  function editSource(source: EventSourceRecord) {
    setSourceDraft({ ...source });
    setTestedUrl(source.url);
    setTestResult(null);
    setNotice("");
  }

  function updateSourceDraft<K extends keyof EventSourceRecord>(key: K, value: EventSourceRecord[K]) {
    if (!sourceDraft) return;
    setSourceDraft({ ...sourceDraft, [key]: value });
    if (key === "url") { setTestResult(null); setTestedUrl(""); }
  }

  function testSource() {
    if (!sourceDraft) return;
    try {
      const parsedUrl = new URL(sourceDraft.url);
      if (parsedUrl.protocol !== "https:") throw new Error("Secure URL required");
      setTestedUrl(sourceDraft.url);
      setTestResult({ kind: "success", message: `Prototype source test passed for ${parsedUrl.hostname}. Title, date, organizer evidence, format, location, capacity, and public links are ready for field mapping.` });
    } catch {
      setTestedUrl("");
      setTestResult({ kind: "error", message: "Enter a complete, secure https:// source URL before testing." });
    }
  }

  function saveSource() {
    if (!sourceDraft || !sourceDraft.name.trim() || testedUrl !== sourceDraft.url) return;
    const existed = sources.some((source) => source.id === sourceDraft.id);
    const nextSource: EventSourceRecord = { ...sourceDraft, name: sourceDraft.name.trim(), url: sourceDraft.url.trim(), status: sourceDraft.status === "Archived" ? "Archived" : sourceDraft.status === "Paused" ? "Paused" : "Healthy", nextScan: sourceDraft.frequency === "Manual" ? "Manual" : sourceDraft.status === "Paused" ? "After activation" : sourceDraft.nextScan };
    setSources((current) => existed ? current.map((source) => source.id === nextSource.id ? nextSource : source) : [...current, nextSource]);
    addAudit(nextSource.id, existed ? "Source settings updated" : "Source added to the unit registry");
    setSourceDraft(null);
    setNotice(`${nextSource.name} was ${existed ? "updated" : "added"}. ${nextSource.status === "Paused" ? "Activate it when review is complete." : "It is ready for its next scheduled scan."}`);
  }

  function runScans(ids: string[]) {
    const now = currentAuditTime();
    setSources((current) => current.map((source) => ids.includes(source.id) && source.status !== "Archived" ? { ...source, lastChecked: now, nextScan: source.frequency === "Manual" ? "Manual" : source.frequency === "Daily" ? "Tomorrow · 6:00 AM" : "In 7 days · 6:00 AM", status: source.pendingChanges > 0 ? "Review needed" : source.status === "Paused" ? "Paused" : "Healthy" } : source));
    ids.forEach((id) => addAudit(id, "On-demand source scan completed"));
    setNotice(`${ids.length} source${ids.length === 1 ? "" : "s"} checked. Critical differences remain in the review queue.`);
  }

  function bulkStatus(status: SourceStatus) {
    if (selectedSources.length === 0) return;
    if (status === "Archived" && !window.confirm(`Archive ${selectedSources.length} selected source${selectedSources.length === 1 ? "" : "s"}? Imported events and audit history will be retained.`)) return;
    setSources((current) => current.map((source) => selectedIds.has(source.id) ? { ...source, status, nextScan: status === "Paused" || status === "Archived" ? status : source.frequency === "Manual" ? "Manual" : "Next scheduled window" } : source));
    selectedSources.forEach((source) => addAudit(source.id, status === "Archived" ? "Source archived; event history retained" : `Source status changed to ${status}`));
    setSelectedIds(new Set());
    setNotice(`${selectedSources.length} source${selectedSources.length === 1 ? "" : "s"} ${status === "Archived" ? "archived" : status === "Paused" ? "paused" : "resumed"}.`);
  }

  function applyBulkFrequency() {
    if (selectedSources.length === 0) return;
    setSources((current) => current.map((source) => selectedIds.has(source.id) ? { ...source, frequency: bulkFrequency, nextScan: bulkFrequency === "Manual" ? "Manual" : source.status === "Paused" ? "After activation" : "Next scheduled window" } : source));
    selectedSources.forEach((source) => addAudit(source.id, `Scan frequency changed to ${bulkFrequency}`));
    setNotice(`${bulkFrequency} scanning applied to ${selectedSources.length} source${selectedSources.length === 1 ? "" : "s"}.`);
  }

  function resolveReview(review: SourceReviewRecord, resolution: "Accepted" | "Kept manual") {
    setReviews((current) => current.map((item) => item.id === review.id ? { ...item, resolution } : item));
    setSources((current) => current.map((source) => source.id === review.sourceId ? { ...source, pendingChanges: Math.max(0, source.pendingChanges - 1), status: source.pendingChanges <= 1 ? "Healthy" : source.status } : source));
    addAudit(review.sourceId, `${review.field} variance ${resolution === "Accepted" ? "accepted" : "kept as manual value"} for ${review.eventTitle}`);
    setNotice(`${review.field} decision saved. ${review.severity === "Critical" ? "Attendee notification rules will apply if the accepted value affects a published event." : ""}`);
  }

  return (
    <>
      <div className="source-page-heading"><PortalHeading eyebrow="Governed discovery sources" title="Event Sources" description="Manage where opportunities are discovered, preserve organizer provenance, and review changes before they reach faculty." /><button type="button" onClick={startNewSource}>+ Add event source</button></div>
      <div className="source-safety-banner"><span aria-hidden="true">▣</span><div><strong>Unit-scoped source management</strong><p>You can manage sources assigned to {plannerAccount.units.join(", ")}. Shared listings never establish event ownership, and host, time, location, or access-link changes never auto-publish.</p></div><b>Review first</b></div>
      <div className="metric-row compact source-metrics"><article><span>Sources in scope</span><strong>{scopedSources.filter((source) => source.status !== "Archived").length}</strong><small>{plannerAccount.campus} · approved unit</small></article><article><span>Healthy</span><strong>{scopedSources.filter((source) => source.status === "Healthy").length}</strong><small>Ready for scheduled monitoring</small></article><article><span>Pending reviews</span><strong className="orange">{pendingReviews.length}</strong><small>Field-level decisions required</small></article></div>
      <div className="source-view-tabs" aria-label="Event source views">{(["registry", "review", "history"] as SourceWorkspaceView[]).map((item) => <button key={item} type="button" className={view === item ? "active" : ""} aria-pressed={view === item} onClick={() => setView(item)}>{item === "registry" ? "Source Registry" : item === "review" ? <>Review Queue {pendingReviews.length > 0 && <b>{pendingReviews.length}</b>}</> : "Import History"}</button>)}</div>
      {notice && <div className="management-notice" role="status"><span aria-hidden="true">✓</span><p>{notice}</p><button type="button" aria-label="Dismiss source status message" onClick={() => setNotice("")}>×</button></div>}

      {sourceDraft && <section className="source-editor" aria-labelledby="source-editor-title">
        <div className="source-editor-heading"><div><span aria-hidden="true">⌁</span><div><p>{sources.some((source) => source.id === sourceDraft.id) ? "Edit governed source" : "Add governed source"}</p><h2 id="source-editor-title">Source setup and test</h2></div></div><button type="button" onClick={() => setSourceDraft(null)}>Close</button></div>
        <div className="source-editor-grid">
          <label><span>Source name</span><input value={sourceDraft.name} onChange={(event) => updateSourceDraft("name", event.target.value)} placeholder="Campus or unit event source" /></label>
          <label className="wide"><span>Secure source URL</span><input type="url" inputMode="url" value={sourceDraft.url} onChange={(event) => updateSourceDraft("url", event.target.value)} placeholder="https://unit.hawaii.edu/events/" /></label>
          <label><span>Source relationship</span><select value={sourceDraft.relationship} onChange={(event) => updateSourceDraft("relationship", event.target.value as SourceRelationship)}><option>Organizer page</option><option>Shared listing</option><option>Campus calendar</option><option>RSS/API feed</option></select></label>
          <label><span>Responsible campus</span><select value={sourceDraft.ownerCampus} onChange={(event) => updateSourceDraft("ownerCampus", event.target.value)}>{plannerAccount.campuses.map((campus) => <option key={campus}>{campus}</option>)}</select></label>
          <label><span>Responsible unit</span><select value={sourceDraft.ownerUnit} onChange={(event) => updateSourceDraft("ownerUnit", event.target.value)}>{plannerAccount.units.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
          <label><span>Scan frequency</span><select value={sourceDraft.frequency} onChange={(event) => updateSourceDraft("frequency", event.target.value as ScanFrequency)}><option>Manual</option><option>Daily</option><option>Weekly</option></select></label>
          <label><span>Review policy</span><select value={sourceDraft.approvalPolicy} onChange={(event) => updateSourceDraft("approvalPolicy", event.target.value as SourceApprovalPolicy)}><option>Review all changes</option><option>Review critical fields</option><option>Manual review only</option></select></label>
          <label className="wide"><span>Source notes</span><textarea rows={3} value={sourceDraft.notes} onChange={(event) => updateSourceDraft("notes", event.target.value)} placeholder="Provenance, scope, or known limitations" /></label>
        </div>
        <div className="source-attribution-policy"><span aria-hidden="true">!</span><div><strong>Host-attribution policy</strong><p>{sourcePolicyCopy(sourceDraft.relationship)}</p></div></div>
        {testResult && <div className={`source-test-result ${testResult.kind}`} role="status"><span aria-hidden="true">{testResult.kind === "success" ? "✓" : "!"}</span><p>{testResult.message}</p></div>}
        <div className="source-editor-actions"><p>Source testing validates the URL and mapping policy in this prototype. Production crawling still requires an approved service, rate limits, and monitoring.</p><div><button type="button" className="secondary-button" onClick={testSource}>Test source</button><button type="button" disabled={!sourceDraft.name.trim() || testedUrl !== sourceDraft.url} onClick={saveSource}>Save source</button></div></div>
      </section>}

      {view === "registry" && <>
        <section className="source-registry-controls" aria-label="Filter and manage event sources"><label><span>Find a source</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, URL, campus, or unit" /></label><label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "All statuses" | SourceStatus)}><option>All statuses</option><option>Healthy</option><option>Review needed</option><option>Paused</option><option>Connection issue</option><option>Archived</option></select></label><button type="button" onClick={() => { setQuery(""); setStatusFilter("All statuses"); }}>Clear filters</button></section>
        <section className="source-quality-strip" aria-label="Source monitoring quality"><article><span>Field completeness</span><strong>{scopedSources.some((source) => source.status === "Connection issue") ? "Needs review" : "92% sample"}</strong><small>Representative mapping of title, dates, host, format, location, and public link</small></article><article><span>Parser version</span><strong>2.1 draft</strong><small>Will be saved with every proposed production import</small></article><article><span>Connection checks</span><strong>{scopedSources.filter((source) => source.status === "Healthy" || source.status === "Review needed").length}/{scopedSources.filter((source) => source.status !== "Archived").length}</strong><small>Prototype registry status; live HTTP monitoring still requires the crawler service</small></article><article><span>Failure policy</span><strong>3 retries</strong><small>Proposed production rule, then pause and alert the unit owner</small></article></section>
        {selectedSources.length > 0 && <section className="source-bulk-bar" aria-label="Bulk source actions"><div><strong>{selectedSources.length} selected</strong><button type="button" onClick={() => setSelectedIds(new Set())}>Clear selection</button></div><div><button type="button" onClick={() => runScans(selectedSources.map((source) => source.id))}>Run scan</button><button type="button" onClick={() => bulkStatus("Paused")}>Pause</button><button type="button" onClick={() => bulkStatus("Healthy")}>Resume</button><label><span className="sr-only">Bulk scan frequency</span><select value={bulkFrequency} onChange={(event) => setBulkFrequency(event.target.value as ScanFrequency)}><option>Manual</option><option>Daily</option><option>Weekly</option></select></label><button type="button" onClick={applyBulkFrequency}>Apply frequency</button><button className="archive-source-button" type="button" onClick={() => bulkStatus("Archived")}>Archive</button></div></section>}
        <section className="data-card source-registry-card" aria-labelledby="source-registry-title"><div className="data-card-header"><div><h2 id="source-registry-title">Source Registry</h2><p>{filteredSources.length} source{filteredSources.length === 1 ? "" : "s"} in this authorized view. Archive replaces permanent deletion so provenance remains available.</p></div><span className="admin-note">Unit-scoped</span></div><div className="table-wrap"><table><caption className="sr-only">Event sources assigned to this planner unit</caption><thead><tr><th scope="col"><input type="checkbox" aria-label="Select all visible sources" checked={filteredSources.length > 0 && filteredSources.every((source) => selectedIds.has(source.id))} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); filteredSources.forEach((source) => { if (event.target.checked) next.add(source.id); else next.delete(source.id); }); return next; })} /></th><th scope="col">Source</th><th scope="col">Relationship</th><th scope="col">Schedule</th><th scope="col">Imported</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead><tbody>{filteredSources.map((source) => <tr key={source.id}><td><input type="checkbox" aria-label={`Select ${source.name}`} checked={selectedIds.has(source.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(source.id); else next.delete(source.id); return next; })} /></td><td><strong>{source.name}</strong><a href={source.url} target="_blank" rel="noreferrer">{source.url}<span className="sr-only"> (opens in a new tab)</span></a><small>{source.ownerCampus} · {source.ownerUnit}</small></td><td><b>{source.relationship}</b><small>{source.approvalPolicy}</small></td><td><b>{source.frequency}</b><small>Last: {source.lastChecked}<br />Next: {source.nextScan}</small></td><td><b>{source.importedEvents}</b><small>{source.pendingChanges} pending change{source.pendingChanges === 1 ? "" : "s"}</small></td><td><span className={`table-status ${sourceStatusClass(source.status)}`}>{source.status}</span></td><td><div className="source-row-actions"><button type="button" onClick={() => editSource(source)}>Edit</button><button type="button" disabled={source.status === "Archived"} onClick={() => runScans([source.id])}>Scan now</button></div></td></tr>)}</tbody></table></div>{filteredSources.length === 0 && <div className="analytics-empty"><strong>No sources match these filters.</strong><p>Clear the filters or add a source assigned to this unit.</p></div>}</section>
        <section className="source-provenance-note"><span aria-hidden="true">↗</span><div><strong>Discovery source ≠ event host</strong><p>Every imported event stores both “Hosted by” and “Discovered through.” A shared listing may surface an event, but it can never assign itself as the organizer.</p></div></section>
      </>}

      {view === "review" && <section className="source-review-workspace" aria-labelledby="source-review-title"><div className="data-card-header"><div><h2 id="source-review-title">Field-level Review Queue</h2><p>Compare stored and detected values. Decisions apply to one field at a time and are added to the audit history.</p></div><span className="admin-note">{pendingReviews.length} pending</span></div>{scopedReviews.length > 0 ? <div className="source-review-list">{scopedReviews.map((review) => <article key={review.id} className={review.resolution === "Pending" ? "" : "resolved"}><div className="source-review-summary"><div><span className={`table-status ${review.severity === "Critical" ? "flag" : "draft"}`}>{review.severity}</span><small>{sourceName(review.sourceId)} · {review.detectedAt}</small></div><span className={`table-status ${review.resolution === "Pending" ? "flag" : "live"}`}>{review.resolution}</span></div><h3>{review.eventTitle}</h3><p className="source-review-field">Changed field: <strong>{review.field}</strong></p><div className="source-value-compare"><div><span>Stored value</span><strong>{review.storedValue}</strong></div><span aria-hidden="true">→</span><div><span>Detected value</span><strong>{review.detectedValue}</strong></div></div>{review.resolution === "Pending" ? <div className="source-review-actions"><button type="button" className="secondary-button" onClick={() => resolveReview(review, "Kept manual")}>Keep manual value</button><button type="button" onClick={() => resolveReview(review, "Accepted")}>Accept source update</button></div> : <p className="source-resolution-note">Decision recorded. The source monitor will use this result without changing organizer evidence rules.</p>}</article>)}</div> : <div className="analytics-empty"><strong>No source changes to review.</strong><p>Critical differences will appear here after a scheduled or on-demand scan.</p></div>}</section>}

      {view === "history" && <section className="data-card source-history-card" aria-labelledby="source-history-title"><div className="data-card-header"><div><h2 id="source-history-title">Import and decision history</h2><p>Source scans, configuration changes, and field-level decisions remain attributable.</p></div><span className="admin-note">Audit retained</span></div><div className="table-wrap"><table><caption className="sr-only">Event source audit history</caption><thead><tr><th scope="col">Source</th><th scope="col">Action</th><th scope="col">Actor</th><th scope="col">Time</th></tr></thead><tbody>{scopedAudits.map((audit) => <tr key={audit.id}><td><strong>{sourceName(audit.sourceId)}</strong></td><td>{audit.action}</td><td>{audit.actor}</td><td>{audit.timestamp}</td></tr>)}</tbody></table></div></section>}
    </>
  );
}

function AttendanceSync({ events, registrations, onUpdateEvent }: { events: EventItem[]; registrations: RegistrationRecord[]; onUpdateEvent: (event: EventItem) => void }) {
  const firstEvent = events[0];
  const [selectedEventId, setSelectedEventId] = useState(firstEvent?.id ?? 0);
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? firstEvent;
  const [provider, setProvider] = useState<SyncProvider>(firstEvent?.provider ?? "Zoom");
  const [meetingId, setMeetingId] = useState(firstEvent?.externalMeetingId ?? "");
  const [threshold, setThreshold] = useState(50);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [syncNotice, setSyncNotice] = useState("");
  const [lastSynced, setLastSynced] = useState("");
  const [manualSelections, setManualSelections] = useState<Record<string, string>>({});
  const registeredForEvent = selectedEvent ? registrations.filter((registration) => registration.eventId === selectedEvent.id && !registration.waitlisted) : [];
  const sessionMinutes = selectedEvent ? eventDurationMinutes(selectedEvent) : 90;

  const normalizedRecords = records.map((record) => record.status === "Unmatched" ? record : { ...record, status: record.minutes === 0 ? "No show" as const : record.percentage >= threshold ? "Attended" as const : "Partial" as const });
  const matched = normalizedRecords.filter((record) => record.matchMethod !== "No safe match").length;
  const attended = normalizedRecords.filter((record) => record.status === "Attended").length;
  const exceptions = normalizedRecords.filter((record) => record.status === "Unmatched" || record.status === "Partial").length;

  function chooseEvent(id: number) {
    const nextEvent = events.find((event) => event.id === id);
    setSelectedEventId(id);
    setProvider(nextEvent?.provider ?? "Zoom");
    setMeetingId(nextEvent?.externalMeetingId ?? "");
    setRecords([]);
    setSyncNotice("");
    setLastSynced("");
    setManualSelections({});
  }

  function finishImport(nextRecords: AttendanceRecord[], source: string) {
    if (!selectedEvent) return;
    const hasUnmatched = nextRecords.some((record) => record.matchMethod === "No safe match");
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu", dateStyle: "medium", timeStyle: "short" });
    setRecords(nextRecords);
    setLastSynced(timestamp);
    setSyncNotice(`${source} loaded. ${nextRecords.length} rows normalized; ${nextRecords.filter((record) => record.matchMethod === "No safe match").length} need review.`);
    onUpdateEvent({ ...selectedEvent, provider, externalMeetingId: meetingId, providerStatus: hasUnmatched ? "Needs review" : "Synced", updatedAt: new Date().toISOString() });
  }

  function loadSampleReport() {
    const sampleMinutes = [Math.round(sessionMinutes * .91), Math.round(sessionMinutes * .6), Math.round(sessionMinutes * .34), 0];
    const safeRows: AttendanceRecord[] = registeredForEvent.slice(0, 4).map((registration, index) => {
      const minutes = sampleMinutes[index];
      const percentage = Math.min(100, Math.round((minutes / sessionMinutes) * 100));
      return { id: `sample-${index + 1}`, name: registration.name, email: registration.email, minutes, percentage, status: minutes === 0 ? "No show" : percentage >= threshold ? "Attended" : "Partial", matchMethod: "Registrant ID", campus: registration.campus ?? "Not provided" };
    });
    const unmatchedRows: AttendanceRecord[] = [
      { id: "sample-unmatched-1", name: "Unmatched provider guest", email: "guest@hawaii.edu", minutes: Math.round(sessionMinutes * .52), percentage: 52, status: "Unmatched", matchMethod: "No safe match", campus: "Unknown" },
      { id: "sample-unmatched-2", name: "Guest 483", email: "", minutes: Math.round(sessionMinutes * .25), percentage: 25, status: "Unmatched", matchMethod: "No safe match", campus: "Unknown" },
    ];
    finishImport([...safeRows, ...unmatchedRows], `${provider} representative sample report`);
  }

  async function importCsv(inputEvent: FormEvent<HTMLInputElement>) {
    const file = inputEvent.currentTarget.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const headings = parseCsvLine(lines.shift() ?? "").map((heading) => normalizeFilterText(heading));
    const column = (...names: string[]) => names.map((name) => headings.indexOf(normalizeFilterText(name))).find((index) => index >= 0) ?? -1;
    const get = (cells: string[], ...names: string[]) => cells[column(...names)]?.trim() ?? "";
    const nextRecords = lines.map((line, index) => {
      const cells = parseCsvLine(line);
      const email = get(cells, "email", "user email", "participant email").toLowerCase();
      const minutes = Math.max(0, Number(get(cells, "minutes", "duration minutes", "total duration minutes")) || 0);
      const percentage = Math.min(100, Math.round((minutes / sessionMinutes) * 100));
      const matchedRegistration = registeredForEvent.find((registration) => registration.email.toLowerCase() === email);
      const safelyMatched = Boolean(matchedRegistration);
      return { id: `csv-${index}`, name: matchedRegistration?.name ?? (get(cells, "name", "participant name", "user name", "name original name") || `Participant ${index + 1}`), email, minutes, percentage, status: safelyMatched ? minutes === 0 ? "No show" as const : percentage >= threshold ? "Attended" as const : "Partial" as const : "Unmatched" as const, matchMethod: safelyMatched ? "Verified email" as const : "No safe match" as const, campus: matchedRegistration?.campus ?? (get(cells, "campus", "campus affiliation") || "Unknown") };
    });
    finishImport(nextRecords, file.name);
    inputEvent.currentTarget.value = "";
  }

  function confirmManualMatch(id: string) {
    const selectedEmail = manualSelections[id];
    const registration = registeredForEvent.find((item) => item.email === selectedEmail);
    if (!registration) {
      setSyncNotice("Select an active registrant before confirming the match.");
      return;
    }
    setRecords((current) => current.map((record) => record.id === id ? { ...record, name: registration.name, email: registration.email, matchMethod: "Manual review", status: record.minutes === 0 ? "No show" : record.percentage >= threshold ? "Attended" : "Partial", campus: registration.campus ?? "Not provided" } : record));
    setSyncNotice("Manual match confirmed and added to the audit trail.");
  }

  function exportNormalizedCsv() {
    const rows = ["Name,Email,Campus,Minutes,Attendance percent,Match method,Decision", ...normalizedRecords.map((record) => [record.name, record.email, record.campus, record.minutes, record.percentage, record.matchMethod, record.status].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "normalized-attendance.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  if (!selectedEvent) return <><PortalHeading eyebrow="Authorized event data" title="Attendance sync" description="Link a live-session provider or import a report, then review matches before attendance becomes analytics." /><div className="analytics-empty-state"><span aria-hidden="true">⌁</span><h2>No eligible events</h2><p>Your authorized unit has no online live or hybrid events to sync.</p></div></>;

  return <>
    <PortalHeading eyebrow="Authorized event data" title="Attendance sync" description="Link a Zoom, Teams, or Meet session; normalize its report; and review uncertain matches before publishing attendance analytics." />
    <div className="integration-status attendance-prototype"><span aria-hidden="true">↗</span><div><strong>Safe prototype mode</strong><p>No provider API is called. Use the sample or a local CSV while UH credentials, administrator consent, encrypted token storage, and retention rules are configured.</p></div><b>API disabled</b></div>
    <section className="provider-grid" aria-label="Meeting provider readiness">{(["Zoom", "Microsoft Teams", "Google Meet"] as SyncProvider[]).map((item) => <button type="button" key={item} className={provider === item ? "provider-card active" : "provider-card"} onClick={() => setProvider(item)}><span aria-hidden="true">{item === "Zoom" ? "Z" : item === "Microsoft Teams" ? "T" : "M"}</span><strong>{item}</strong><small>{item === "Zoom" ? "Prototype connection ready" : "UH admin consent required"}</small></button>)}</section>
    <section className="attendance-workspace" aria-labelledby="sync-event-title">
      <div className="sync-config"><h2 id="sync-event-title">1. Link the event and report</h2><label><span>Authorized event</span><select value={selectedEvent.id} onChange={(event) => chooseEvent(Number(event.target.value))}>{events.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label><div className="sync-fields"><label><span>Provider</span><select value={provider} onChange={(event) => setProvider(event.target.value as SyncProvider)}><option>Zoom</option><option>Microsoft Teams</option><option>Google Meet</option></select></label><label><span>Meeting ID / UUID</span><input value={meetingId} placeholder="Private provider identifier" onChange={(event) => setMeetingId(event.target.value)} /></label><label><span>Attendance threshold</span><span className="threshold-control"><input type="number" min="1" max="100" value={threshold} onChange={(event) => setThreshold(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} /><b>%</b></span><small>Participants at or above this percentage of the {sessionMinutes}-minute event count as attended.</small></label></div><div className="sync-actions"><button type="button" onClick={loadSampleReport}>Load representative sample</button><label className="file-import-button"><span>Import provider CSV</span><input type="file" accept=".csv,text/csv" onInput={importCsv} /><small>Recognizes common Zoom/Teams name, email, and duration headings</small></label></div><p className="registration-match-note"><strong>{registeredForEvent.length} active registrant{registeredForEvent.length === 1 ? "" : "s"}</strong> available for safe email or manual matching.</p></div>
      <aside className="privacy-access-banner"><span aria-hidden="true">▣</span><div><strong>Named rows: {selectedEvent.rosterVisibility ?? "Owner & collaborators"}</strong><p>Other planners receive only the aggregate level selected for this event. Raw provider data is not exposed on the public page.</p><dl><div><dt>Owner unit</dt><dd>{selectedEvent.department}</dd></div><div><dt>Collaborators</dt><dd>{selectedEvent.collaborators?.length ?? 0}</dd></div><div><dt>Analytics</dt><dd>{selectedEvent.analyticsVisibility ?? "Owner unit"}</dd></div></dl></div></aside>
    </section>
    {syncNotice && <div className="management-notice" role="status"><span aria-hidden="true">✓</span><p>{syncNotice}</p><button type="button" aria-label="Dismiss sync status" onClick={() => setSyncNotice("")}>×</button></div>}
    {normalizedRecords.length > 0 && <><div className="metric-row compact attendance-metrics"><article><span>Report rows</span><strong>{normalizedRecords.length}</strong><small>{lastSynced ? `Imported ${lastSynced}` : "Ready for review"}</small></article><article><span>Safely matched</span><strong>{matched}</strong><small>Registrant ID, registered email, or review</small></article><article><span>Attended</span><strong>{attended}</strong><small>At least {threshold}% of session</small></article><article><span>Needs review</span><strong className="orange">{exceptions}</strong><small>Partial or unmatched records</small></article></div><section className="data-card attendance-table" aria-labelledby="attendance-review-title"><div className="data-card-header"><div><h2 id="attendance-review-title">2. Review normalized attendance</h2><p>Provider rows are matched conservatively against this event’s active registration roster; display names alone never create an automatic match.</p></div><button type="button" className="secondary-button" onClick={exportNormalizedCsv}>Export reviewed CSV</button></div><div className="table-wrap"><table><caption className="sr-only">Normalized and matched attendance records</caption><thead><tr><th scope="col">Participant</th><th scope="col">Campus</th><th scope="col">Time</th><th scope="col">Match</th><th scope="col">Decision</th><th scope="col">Action</th></tr></thead><tbody>{normalizedRecords.map((record) => <tr key={record.id}><td><strong>{record.name}</strong><small>{record.email || "No verified email"}</small></td><td>{record.campus}</td><td><b>{record.minutes} min</b><small>{record.percentage}% of session</small></td><td><span className={`table-status ${record.matchMethod === "No safe match" ? "flag" : "live"}`}>{record.matchMethod}</span></td><td><span className={`table-status ${record.status === "Attended" ? "live" : record.status === "No show" ? "draft" : "flag"}`}>{record.status}</span></td><td>{record.matchMethod === "No safe match" ? registeredForEvent.length > 0 ? <div className="manual-match-controls"><select aria-label={`Match ${record.name} to a registrant`} value={manualSelections[record.id] ?? ""} onChange={(event) => setManualSelections((current) => ({ ...current, [record.id]: event.target.value }))}><option value="">Select registrant</option>{registeredForEvent.map((registration) => <option key={registration.email} value={registration.email}>{registration.name} · {registration.email}</option>)}</select><button type="button" className="table-action" disabled={!manualSelections[record.id]} onClick={() => confirmManualMatch(record.id)}>Confirm</button></div> : <small>No registrants available</small> : <small>Audited</small>}</td></tr>)}</tbody></table></div></section><section className="sync-log" aria-labelledby="sync-log-title"><div><span aria-hidden="true">✓</span><div><strong id="sync-log-title">Audit record ready</strong><p>{provider} · meeting ID {meetingId ? `••••${meetingId.slice(-4)}` : "not stored"} · {matched} matched · {normalizedRecords.length - matched} unresolved.</p></div></div><small>Production syncs should retain source ID, timestamps, match reason, reviewer, and any override history.</small></section></>}
  </>;
}

function Analytics({ authorizedUnit, events, registrations }: { authorizedUnit: string; events: EventItem[]; registrations: RegistrationRecord[] }) {
  const [showRecommendation, setShowRecommendation] = useState(false);
  const [dataScope, setDataScope] = useState<"unit" | "system" | "campus">("unit");
  const [scopeCampus, setScopeCampus] = useState("UH Mānoa");
  const [eventStatus, setEventStatus] = useState<"All" | "Upcoming" | "Past">("All");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const analyticsSource = useMemo<AnalyticsEventRecord[]>(() => {
    const liveRecords = events.filter((event) => event.status !== "Canceled").map((event) => {
      const eventRegistrations = registrations.filter((registration) => registration.eventId === event.id);
      const activeRegistrations = eventRegistrations.filter((registration) => !registration.waitlisted);
      const campusCounts = activeRegistrations.reduce<Record<string, number>>((counts, registration) => {
        const registrationCampus = registration.campus ?? "Not provided";
        counts[registrationCampus] = (counts[registrationCampus] ?? 0) + 1;
        return counts;
      }, {});
      const hasLimitedCapacity = event.capacityModel !== "Unlimited" && event.capacityModel !== "Not applicable" && event.mode !== "Online async";
      return {
        id: `live-${event.id}`,
        eventId: event.id,
        title: event.title,
        date: event.date,
        campus: event.campus,
        department: event.department,
        mode: event.mode,
        status: (event.endDate ?? event.sessionDates?.at(-1) ?? event.date) >= presentDateKey ? "Upcoming" as const : "Past" as const,
        capacity: hasLimitedCapacity ? nonnegativeCapacity(event.capacity) + nonnegativeCapacity(event.virtualCapacity) : 0,
        registered: activeRegistrations.length,
        waitlist: eventRegistrations.filter((registration) => registration.waitlisted).length,
        campusCounts,
      };
    });
    return [...liveRecords, ...analyticsEvents.filter((event) => event.status === "Past")];
  }, [events, registrations]);
  const availableEvents = useMemo(() => analyticsSource.filter((event) => (dataScope === "system" || (dataScope === "unit" ? event.department === authorizedUnit : event.campus === scopeCampus)) && (eventStatus === "All" || event.status === eventStatus)), [analyticsSource, authorizedUnit, dataScope, scopeCampus, eventStatus]);
  const selectedEvents = useMemo(() => availableEvents.filter((event) => selectedIds.has(event.id)), [availableEvents, selectedIds]);

  useEffect(() => {
    setSelectedIds(new Set(availableEvents.map((event) => event.id)));
  }, [availableEvents]);

  const registered = selectedEvents.reduce((total, event) => total + event.registered, 0);
  const capacity = selectedEvents.reduce((total, event) => total + Math.max(0, event.capacity), 0);
  const capacityEligibleRegistrations = selectedEvents.reduce((total, event) => total + (event.capacity > 0 ? event.registered : 0), 0);
  const waitlist = selectedEvents.reduce((total, event) => total + event.waitlist, 0);
  const completedEvents = selectedEvents.filter((event) => event.status === "Past" && event.attended !== undefined);
  const attended = completedEvents.reduce((total, event) => total + (event.attended ?? 0), 0);
  const completedRegistrations = completedEvents.reduce((total, event) => total + event.registered, 0);
  const utilization = capacity ? Math.round((capacityEligibleRegistrations / capacity) * 100) : 0;
  const attendanceRate = completedRegistrations ? Math.round((attended / completedRegistrations) * 100) : null;
  const campusTotals = Object.entries(selectedEvents.reduce<Record<string, number>>((totals, event) => {
    Object.entries(event.campusCounts).forEach(([campus, count]) => { totals[campus] = (totals[campus] ?? 0) + count; });
    return totals;
  }, {})).sort((a, b) => b[1] - a[1]);
  const maxCampusTotal = Math.max(1, ...campusTotals.map(([, count]) => count));
  const hostComparableEvents = selectedEvents.filter((event) => event.campus !== "UH System");
  const hostComparableRegistrations = hostComparableEvents.reduce((total, event) => total + event.registered, 0);
  const hostRegistrations = hostComparableEvents.reduce((total, event) => total + (event.campusCounts[event.campus] ?? 0), 0);
  const crossCampusRegistrations = Math.max(0, hostComparableRegistrations - hostRegistrations);
  const crossCampusReach = hostComparableRegistrations ? Math.round((crossCampusRegistrations / hostComparableRegistrations) * 100) : 0;
  const eventMax = Math.max(1, ...selectedEvents.map((event) => event.registered));
  const rosterEvent = selectedEvents.length === 1 ? selectedEvents[0] : null;
  const rosterCampuses = rosterEvent ? Object.keys(rosterEvent.campusCounts) : [];
  const liveRosterRows = rosterEvent?.eventId ? registrations.filter((registration) => registration.eventId === rosterEvent.eventId).map((registration) => ({
    name: registration.name,
    campus: registration.campus ?? "Not provided",
    attendanceOption: registration.attendance,
    status: registration.waitlisted ? "Waitlisted" : "Registered",
  })) : [];
  const rosterRows = rosterEvent ? rosterEvent.eventId ? liveRosterRows : rosterNames.map((name, index) => ({
    name,
    campus: rosterCampuses[index % Math.max(1, rosterCampuses.length)] ?? "Not provided",
    attendanceOption: rosterEvent.mode === "Hybrid" ? index % 2 === 0 ? "Virtual" : "In person" : rosterEvent.mode === "In person" ? "In person" : "Virtual",
    status: rosterEvent.status === "Past" ? index === 4 ? "No show" : "Attended" : index === 4 && rosterEvent.waitlist > 0 ? "Waitlisted" : "Registered",
  })) : [];
  const highestDemandEvent = selectedEvents.reduce<AnalyticsEventRecord | null>((highest, event) => !highest || event.registered > highest.registered ? event : highest, null);
  const hasComparableHostEvents = hostComparableEvents.length > 0;
  const planningSignal = selectedEvents.length === 1
    ? selectedEvents[0].status === "Upcoming"
      ? selectedEvents[0].registered === 0
        ? "No registrations have been recorded yet. Share the event link with the intended campus and topic audiences."
        : selectedEvents[0].capacity > 0
          ? `${selectedEvents[0].registered} of ${selectedEvents[0].capacity} places are filled with ${selectedEvents[0].waitlist} people waiting.`
          : `${selectedEvents[0].registered} registrations are saved; this event has no limited seat cap.`
      : selectedEvents[0].attended === undefined
        ? "Attendance is awaiting a verified provider sync or reviewed import."
        : `${selectedEvents[0].attended} of ${selectedEvents[0].registered} registrants attended (${selectedEvents[0].registered > 0 ? Math.round((selectedEvents[0].attended / selectedEvents[0].registered) * 100) : 0}%).`
    : registered === 0
      ? "No registrations have been recorded for the selected events yet."
      : `${highestDemandEvent?.title} currently has the highest selected demand at ${highestDemandEvent?.registered} registrations.`;
  const planningRecommendation = registered === 0
    ? "Promote the descriptive event link through the authorized campus and unit channels, then return here to monitor registrations."
    : waitlist > 0
      ? `Review the ${waitlist} waitlisted registrations and consider a second virtual session or capacity increase.`
      : "Capacity is currently sufficient. Use the campus-affiliation mix to target outreach where participation is lowest.";

  function toggleEvent(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function exportCsv() {
    const escapeCsv = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const rows = ["Event,Date,Status,Host campus,Registered,Attended,Capacity,Waitlist", ...selectedEvents.map((event) => [event.title, event.date, event.status, event.campus, event.registered, event.attended ?? "", event.capacity, event.waitlist].map(escapeCsv).join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "uh-pd-event-analytics.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  function exportRosterCsv() {
    if (!rosterEvent) return;
    const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = ["Registrant,Campus affiliation,Attendance option,Status", ...rosterRows.map((row) => [row.name, row.campus, row.attendanceOption, row.status].map(escapeCsv).join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type:"text/csv" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${rosterEvent.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-roster.csv`; anchor.click(); URL.revokeObjectURL(url);
  }
  return (
    <>
      <div className="analytics-heading"><PortalHeading eyebrow={`${eventStatus} events · ${dataScope === "system" ? "UH System view" : dataScope === "unit" ? `${authorizedUnit} view` : `${scopeCampus} view`}`} title="Analytics & ROI" description="Move from authorized unit results to event-level registration, attendance, campus reach, and permitted registrant details." /><button type="button" disabled={selectedEvents.length === 0} onClick={exportCsv}>↓ Export selected data</button></div>

      <section className="analytics-control-panel" aria-labelledby="analytics-scope-title">
        <div className="access-banner"><span aria-hidden="true">▣</span><div><strong id="analytics-scope-title">Role-aware data access</strong><p>This contributor view is limited to {authorizedUnit}. Campus stewardship and UH System administration require separately assigned roles; production RLS enforces the same boundary.</p></div><b>Unit-scoped</b></div>
        <div className="analytics-filter-grid">
          <fieldset className="scope-toggle"><legend>Authorized data scope</legend><label className={dataScope === "unit" ? "active" : ""}><input type="radio" name="data-scope" checked={dataScope === "unit"} onChange={() => setDataScope("unit")} />My unit</label><label aria-disabled="true"><input type="radio" name="data-scope" disabled />Campus steward <small>Role required</small></label><label aria-disabled="true"><input type="radio" name="data-scope" disabled />UH System admin <small>Role required</small></label></fieldset>
          {dataScope === "campus" && <label className="analytics-select"><span>Authorized campus</span><select value={scopeCampus} onChange={(event) => setScopeCampus(event.target.value)}>{analyticsCampuses.map((campus) => <option key={campus}>{campus}</option>)}</select></label>}
          <label className="analytics-select"><span>Event status</span><select value={eventStatus} onChange={(event) => setEventStatus(event.target.value as "All" | "Upcoming" | "Past")}><option>All</option><option>Upcoming</option><option>Past</option></select></label>
        </div>
        <details className="event-picker" open><summary><span>Choose event(s)</span><strong>{selectedEvents.length} of {availableEvents.length} selected</strong></summary><div className="event-picker-tools"><button type="button" onClick={() => setSelectedIds(new Set(availableEvents.map((event) => event.id)))}>Select all</button><button type="button" onClick={() => setSelectedIds(new Set())}>Clear</button></div>{availableEvents.length > 0 ? <div className="event-check-list">{availableEvents.map((event) => <label key={event.id}><input type="checkbox" checked={selectedIds.has(event.id)} onChange={() => toggleEvent(event.id)} /><span><strong>{event.title}</strong><small>{formatAnalyticsDate(event.date)} · {event.campus} · {event.status}</small></span></label>)}</div> : <p className="analytics-empty">No events match this access scope and status.</p>}</details>
      </section>

      <section className="analytics-guidance" aria-label="Analytics definitions and system readiness">
        <details><summary>How these measures are calculated</summary><div className="definition-grid"><article><strong>Registrations</strong><p>One active registration per event and verified UH email. A series registration is counted once at the parent level.</p></article><article><strong>Attendance</strong><p>Verified check-in divided by registered participants for completed events; waitlisted and canceled records are excluded.</p></article><article><strong>Campus reach</strong><p>Uses each registrant’s campus affiliation. Multi-affiliated people can be reported by affiliation without being double-counted in the registration total.</p></article><article><strong>Capacity</strong><p>Limited hybrid events combine separate in-person and virtual caps. Unlimited and self-paced events are excluded from utilization.</p></article></div></details>
        <div className="integration-status"><span aria-hidden="true">↗</span><div><strong>Live draft registrations + historical samples</strong><p>Upcoming event counts and rosters come from registrations made on this device. Historical attendance remains representative until Supabase RLS, verified attendance, and provider integrations are connected.</p></div><b>Draft linked</b></div>
      </section>

      <section className="analytics-data-quality" aria-labelledby="data-quality-title"><div><span aria-hidden="true">✓</span><div><strong id="data-quality-title">Data quality at a glance</strong><p>Counts identify their source so planners can distinguish verified records from prototype samples.</p></div></div><ul><li><b>Device-live</b><span>Upcoming registrations</span></li><li><b>Verified import</b><span>Attendance after reviewed provider sync</span></li><li><b>Representative</b><span>Historical sample records only</span></li></ul></section>
      <nav className="analytics-section-switch" aria-label="Analytics sections"><span>Jump to</span><button type="button" onClick={() => document.getElementById("analytics-operations")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Operational monitoring</button><button type="button" onClick={() => document.getElementById("analytics-outcomes")?.scrollIntoView({ behavior: "smooth", block: "start" })}>ROI &amp; participation</button></nav>

      <section id="analytics-operations" className="analytics-section-heading" tabIndex={-1}><p className="eyebrow dark">Operational monitoring</p><h2>Registration, capacity &amp; follow-up</h2><span>What planners need to act on before and immediately after an event.</span></section>
      <div className="metric-row analytics-metrics" aria-live="polite"><article><span>Registrations</span><strong>{registered}</strong><small>Across {selectedEvents.length} selected event{selectedEvents.length === 1 ? "" : "s"}</small></article><article><span>Verified attendance</span><strong>{attendanceRate === null ? "—" : attended}</strong><small>{attendanceRate === null ? "Available after a selected event ends" : `${attendanceRate}% of past-event registrants`}</small></article><article><span>Capacity utilized</span><strong>{capacity > 0 ? `${utilization}%` : "—"}</strong><small>{capacity > 0 ? `${capacityEligibleRegistrations} registrations · ${capacity} limited places` : "Unlimited/self-paced events excluded"}</small></article><article><span>Current waitlist</span><strong>{waitlist}</strong><small>{waitlist === 0 ? "No one currently waiting" : "Across selected events"}</small></article></div>

      {selectedEvents.length > 0 ? <>
        <section id="analytics-outcomes" className="analytics-section-heading" tabIndex={-1}><p className="eyebrow dark">ROI &amp; participation</p><h2>Demand, attendance &amp; cross-campus reach</h2><span>Use outcomes to improve future scheduling, format, and outreach.</span></section>
        <div className="analytics-grid">
          <section className="chart-card" aria-labelledby="event-performance-title"><div className="chart-title"><div><h2 id="event-performance-title">Registration by event</h2><p>Compare demand for the selected opportunities</p></div><span>{registered} total</span></div><div className="bar-chart event-bars" role="img" aria-label={`${selectedEvents.length} selected events with ${registered} total registrations.`}>{selectedEvents.map((event, index) => <div className="bar-row" key={event.id}><span title={event.title}>{event.title}</span><div><i className={["teal","blue","gold","coral","navy"][index % 5]} style={{ width:event.registered === 0 ? "0%" : `${Math.max(4, Math.round((event.registered / eventMax) * 100))}%` }}></i></div><b>{event.registered}</b></div>)}</div></section>
          <section className="chart-card" aria-labelledby="reach-title"><div className="chart-title"><div><h2 id="reach-title">Cross-campus reach</h2><p>Host versus non-host affiliation</p></div></div>{hostComparableRegistrations > 0 ? <div className="donut-wrap"><div className="donut" style={{ background:`conic-gradient(var(--teal) 0 ${crossCampusReach}%,var(--navy) ${crossCampusReach}% 100%)` }} role="img" aria-label={`${crossCampusReach} percent of registrations came from outside the host campus`}><span><strong>{crossCampusReach}%</strong><small>cross-campus</small></span></div><div className="legend"><p><i className="teal"></i><span>Non-host campus</span><b>{crossCampusRegistrations}</b></p><p><i className="navy"></i><span>Host campus</span><b>{hostRegistrations}</b></p><small>UH System events are excluded because they have no single host campus.</small></div></div> : <div className="chart-empty"><strong>{hasComparableHostEvents ? "No data yet" : "Not applicable"}</strong><p>{hasComparableHostEvents ? "No registrations have been recorded yet for the selected campus-hosted events." : "The selected events are UH System events and do not have a single host campus."}</p></div>}</section>
          <section className="chart-card full" aria-labelledby="campus-title"><div className="chart-title"><div><h2 id="campus-title">Registrant campus affiliations</h2><p>Where registered participants are based</p></div><span>Multi-affiliation aware</span></div>{campusTotals.length > 0 ? <div className="campus-grid">{campusTotals.map(([campus, count]) => <div key={campus}><span>{campus}</span><strong>{count}</strong><div><i style={{ width:`${Math.round((count / maxCampusTotal) * 100)}%` }}></i></div></div>)}</div> : <div className="chart-empty"><strong>No affiliation data yet</strong><p>Campus participation will appear after registrations are recorded.</p></div>}</section>
        </div>

        <section className="data-card analytics-table" aria-labelledby="event-results-title"><div className="data-card-header"><div><h2 id="event-results-title">Event performance</h2><p>Upcoming events show device-live registration; completed historical samples add attendance.</p></div><span className="admin-note">{selectedEvents.length} selected</span></div><div className="table-wrap"><table><caption className="sr-only">Registration and attendance performance for selected professional development events</caption><thead><tr><th scope="col">Event</th><th scope="col">Status</th><th scope="col">Registered</th><th scope="col">Attended</th><th scope="col">Capacity</th><th scope="col">Waitlist</th><th scope="col">Registrant details</th></tr></thead><tbody>{selectedEvents.map((event) => <tr key={event.id}><td><strong>{event.title}</strong><small>{formatAnalyticsDate(event.date)} · {event.campus}</small></td><td><span className={`table-status ${event.status === "Past" ? "draft" : "live"}`}>{event.status}</span></td><td><b>{event.registered}</b></td><td>{event.status === "Past" ? event.attended === undefined ? <small>Awaiting verified sync</small> : <><b>{event.attended}</b><small>{event.registered > 0 ? Math.round((event.attended / event.registered) * 100) : 0}% attendance</small></> : <small>Available after event</small>}</td><td>{event.capacity > 0 ? <><b>{Math.round((event.registered / event.capacity) * 100)}%</b><small>{event.registered} / {event.capacity}</small></> : <small>Unlimited / not applicable</small>}</td><td>{event.waitlist}</td><td><button className="table-action" type="button" onClick={() => setSelectedIds(new Set([event.id]))}>View roster</button></td></tr>)}</tbody></table></div></section>

        {rosterEvent ? <section className="data-card roster-card" aria-labelledby="roster-title"><div className="data-card-header"><div><h2 id="roster-title">Registrant roster</h2><p>{rosterEvent.title} · {rosterEvent.eventId ? `${rosterRows.length} device-live registration${rosterRows.length === 1 ? "" : "s"}` : `Showing ${rosterRows.length} representative historical records of ${rosterEvent.registered}`}</p></div><div className="roster-actions"><span className="table-status live">Authorized view</span><button type="button" className="secondary-button" disabled={rosterRows.length === 0} onClick={exportRosterCsv}>Export roster CSV</button></div></div><div className="roster-access-note"><span aria-hidden="true">▣</span><p>Names and contact details are available only to the event’s authorized campus/unit owners and Super Admins.</p></div>{rosterRows.length > 0 ? <div className="table-wrap"><table><caption className="sr-only">Authorized registrant roster for {rosterEvent.title}</caption><thead><tr><th scope="col">Registrant</th><th scope="col">Campus affiliation</th><th scope="col">Attendance option</th><th scope="col">Status</th></tr></thead><tbody>{rosterRows.map((row) => <tr key={`${row.name}-${row.attendanceOption}`}><td><strong>{row.name}</strong><small>UH faculty/staff</small></td><td>{row.campus}</td><td>{row.attendanceOption}</td><td><span className={`table-status ${row.status === "Waitlisted" || row.status === "No show" ? "flag" : "live"}`}>{row.status}</span></td></tr>)}</tbody></table></div> : <p className="analytics-empty">No registrations have been saved for this event on this device.</p>}</section> : <div className="roster-prompt"><span aria-hidden="true">↳</span><div><strong>Need the registrant roster?</strong><p>Select exactly one event—or use “View roster” in the event table—to see authorized participant details.</p></div></div>}

        <div className="insight-strip"><span aria-hidden="true">✦</span><div><strong>Planning signal</strong><p>{planningSignal}</p></div><button type="button" aria-expanded={showRecommendation} aria-controls="planning-recommendation" onClick={() => setShowRecommendation((current) => !current)}>{showRecommendation ? "Hide recommendation" : "View recommendation"}</button></div>
        {showRecommendation && <section className="recommendation-detail" id="planning-recommendation"><strong>Recommended next step</strong><p>{planningRecommendation}</p></section>}
      </> : <div className="analytics-empty-state"><span aria-hidden="true">⌁</span><h2>No events selected</h2><p>Select one or more events above to calculate registration, attendance, campus, and ROI results.</p><button type="button" onClick={() => setSelectedIds(new Set(availableEvents.map((event) => event.id)))}>Select all available events</button></div>}
    </>
  );
}

function Contributors({ approved, setApproved }: { approved: boolean; setApproved: (value: boolean) => void }) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [selectedContributor, setSelectedContributor] = useState<string | null>(null);
  return (
    <>
      <PortalHeading eyebrow="Super Admin" title="Contributor access" description="Approve UH event planners, review their unit affiliation, and protect write access to institutional event records." />
      <section className="approval-card" aria-labelledby="pending-title"><div className="approval-header"><div><h2 id="pending-title">Pending approval</h2><p>{approved ? "No accounts awaiting review" : "1 account awaiting manual review"}</p></div><span>Domain verified</span></div><article className="person-row"><span className="avatar" aria-hidden="true">KL</span><div className="person-info"><strong>Kai Lee</strong><small>kai.lee@hawaii.edu</small></div><div><span className="field-label">Requested unit</span><strong>UH Hilo · Kilohana</strong></div><div><span className="field-label">Requested role</span><strong>Contributor</strong></div>{approved ? <span className="approved-state">✓ Approved</span> : <div className="approval-actions"><button type="button" className="secondary-button" aria-expanded={reviewOpen} aria-controls="contributor-review" onClick={() => setReviewOpen((current) => !current)}>{reviewOpen ? "Hide review" : "Review"}</button><button type="button" className="publish-button" onClick={() => { setApproved(true); setReviewOpen(false); }}>Approve</button></div>}</article>{reviewOpen && <div className="contributor-review" id="contributor-review"><strong>Verification checklist</strong><p>hawaii.edu domain confirmed · Requested unit matches UH Hilo · Contributor access will be scoped to Kilohana-owned records.</p></div>}</section>
      <section className="data-card"><div className="data-card-header"><div><h2>Approved contributors</h2><p>Write access is scoped by department or campus unit.</p></div><span className="admin-note">RLS policy model</span></div><div className="contributor-list">{[{initials:"MD",name:"M. Designer",unit:`${uhoicName} · System office`,events:"6 active",role:"Super Admin"},{initials:"JN",name:"Jordan Nakamura",unit:"UH Mānoa CTE",events:"3 active",role:"Contributor"},{initials:"AP",name:"A. Pacheco",unit:"Leeward CC Faculty PD",events:"3 active",role:"Contributor"}].map((person) => <article key={person.name}><span className="avatar">{person.initials}</span><div><strong>{person.name}</strong><small>{person.unit}</small></div><span>{person.events}</span><b>{person.role}</b><button type="button" aria-expanded={selectedContributor === person.name} aria-label={`Show access details for ${person.name}`} onClick={() => setSelectedContributor((current) => current === person.name ? null : person.name)}>•••</button>{selectedContributor === person.name && <div className="contributor-detail"><strong>Access details</strong><span>{person.role} · {person.unit} · {person.events}</span><small>Account changes require Super Admin confirmation.</small></div>}</article>)}</div></section>
      <div className="guardrail-grid"><article><span aria-hidden="true">@</span><div><strong>hawaii.edu only</strong><p>Non-UH signups are rejected before account creation.</p></div></article><article><span aria-hidden="true">▣</span><div><strong>Approval before write</strong><p>Pending accounts remain read-only until reviewed.</p></div></article><article><span aria-hidden="true">↗</span><div><strong>Continuity by design</strong><p>Reassign staff without changing event or RSVP records.</p></div></article></div>
    </>
  );
}
