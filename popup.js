const HN_SITE = "https://news.ycombinator.com";
const HN_API = "https://hacker-news.firebaseio.com/v0";
const MAX_COMMENTS = 110;
const MAX_READ_STORIES = 1200;
const INITIAL_STORIES = 20;
const STORIES_PAGE_SIZE = 20;
const MAX_PREVIEW_HTML_BYTES = 300000;

const FEEDS = [
  { key: "topstories", label: "Top" },
  { key: "askstories", label: "Ask HN" },
  { key: "showstories", label: "Show HN" },
  { key: "beststories", label: "Best" },
  { key: "newstories", label: "New" },
  { key: "jobstories", label: "Jobs" }
];

const ACCENT_OPTIONS = [
  { key: "orange", label: "Orange", color: "#f97316" },
  { key: "blue", label: "Blue", color: "#3b82f6" },
  { key: "sky", label: "Sky", color: "#0ea5e9" },
  { key: "purple", label: "Purple", color: "#a855f7" },
  { key: "magenta", label: "Magenta", color: "#d946ef" },
  { key: "fuchsia", label: "Fuchsia", color: "#d946ef" },
  { key: "rose", label: "Rose", color: "#f43f5e" },
  { key: "red", label: "Red", color: "#ef4444" },
  { key: "pink", label: "Pink", color: "#ec4899" },
  { key: "violet", label: "Violet", color: "#8b5cf6" },
  { key: "indigo", label: "Indigo", color: "#6366f1" },
  { key: "cyan", label: "Cyan", color: "#06b6d4" },
  { key: "emerald", label: "Emerald", color: "#10b981" }
];
const DEFAULT_ACCENT_KEY = "blue";

const state = {
  activeFeed: FEEDS[0].key,
  feedCache: new Map(),
  feedIdsCache: new Map(),
  feedCursorByFeed: new Map(),
  loadingFeed: false,
  loadingMoreStories: false,
  feedRequestId: 0,
  commentsRequestId: 0,
  auth: {
    checked: false,
    isLoggedIn: false,
    username: null
  },
  currentStoryForComments: null,
  toastTimer: null,
  voteLinkCache: new Map(),
  previewSourceCache: new Map(),
  previewPromiseCache: new Map(),
  accentKey: DEFAULT_ACCENT_KEY,
  readStoryIds: new Set()
};

const ui = {
  todayLabel: document.getElementById("todayLabel"),
  feedTabs: document.getElementById("feedTabs"),
  statusBar: document.getElementById("statusBar"),
  statusText: document.getElementById("statusText"),
  storyList: document.getElementById("storyList"),
  feedScroll: document.querySelector("main"),
  authButton: document.getElementById("authButton"),
  themeToggle: document.getElementById("themeToggle"),
  themeIcon: document.getElementById("themeIcon"),
  themeIconMoon: document.getElementById("themeIconMoon"),
  themeIconSun: document.getElementById("themeIconSun"),
  newPostButton: document.getElementById("newPostButton"),
  settingsButton: document.getElementById("settingsButton"),
  toast: document.getElementById("toast"),

  commentsModal: document.getElementById("commentsModal"),
  commentsStoryLink: document.getElementById("commentsStoryLink"),
  commentsStoryDomain: document.getElementById("commentsStoryDomain"),
  commentsStoryMeta: document.getElementById("commentsStoryMeta"),
  commentsStoryThumbWrap: document.getElementById("commentsStoryThumbWrap"),
  commentsStoryThumb: document.getElementById("commentsStoryThumb"),
  commentsStoryThumbFallback: document.getElementById("commentsStoryThumbFallback"),
  storyCommentForm: document.getElementById("storyCommentForm"),
  storyCommentInput: document.getElementById("storyCommentInput"),
  submitStoryComment: document.getElementById("submitStoryComment"),
  commentsAuthHint: document.getElementById("commentsAuthHint"),
  commentsList: document.getElementById("commentsList"),

  postModal: document.getElementById("postModal"),
  postForm: document.getElementById("postForm"),
  submitPost: document.getElementById("submitPost"),
  settingsModal: document.getElementById("settingsModal"),
  accentPalette: document.getElementById("accentPalette")
};

initialize().catch((error) => {
  console.error(error);
  setStatus("Failed to initialize extension popup");
});

async function initialize() {
  renderToday();
  renderAccentPalette();
  attachEventListeners();
  renderFeedTabs();

  await applyStoredTheme();
  await applyStoredAccent();
  await loadStoredReadStories();
  await checkAuthState();
  await loadFeed(state.activeFeed);
}

function attachEventListeners() {
  ui.feedTabs.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-feed]");
    if (!button || state.loadingFeed) {
      return;
    }

    const feed = button.dataset.feed;
    if (!feed || feed === state.activeFeed) {
      return;
    }

    state.activeFeed = feed;
    renderFeedTabs();
    loadFeed(feed).catch((error) => {
      console.error(error);
      setStatus("Could not load this feed");
    });
  });

  ui.feedScroll?.addEventListener("scroll", () => {
    if (state.loadingFeed || state.loadingMoreStories) {
      return;
    }
    const remaining = ui.feedScroll.scrollHeight - (ui.feedScroll.scrollTop + ui.feedScroll.clientHeight);
    if (remaining <= 220) {
      loadMoreForActiveFeed().catch((error) => {
        console.error(error);
      });
    }
  });

  ui.storyList.addEventListener("click", (event) => {
    const voteButton = event.target.closest("button.vote-trigger[data-id]");
    if (voteButton) {
      const itemId = Number(voteButton.dataset.id);
      const cachedStories = state.feedCache.get(state.activeFeed) || [];
      const story = cachedStories.find((entry) => entry.id === itemId);

      if (story) {
        voteStory(story, voteButton).catch((error) => {
          console.error(error);
          showToast("Could not upvote");
        });
      }
      return;
    }

    const commentsButton = event.target.closest("button.comments-trigger[data-id]");
    if (commentsButton) {
      const itemId = Number(commentsButton.dataset.id);
      markStoryRead(itemId);
      const cachedStories = state.feedCache.get(state.activeFeed) || [];
      const story = cachedStories.find((entry) => entry.id === itemId);
      if (story) {
        openCommentsModal(story).catch((error) => {
          console.error(error);
          showToast("Could not open comments");
        });
      }
      return;
    }

    const storyLink = event.target.closest("a.story-title, a.story-media");
    if (storyLink) {
      const storyCard = storyLink.closest(".story-card");
      const itemId = Number(storyCard?.dataset.id || storyLink.dataset.id);
      markStoryRead(itemId);
    }
  });

  ui.authButton.addEventListener("click", async () => {
    if (state.auth.isLoggedIn) {
      window.open(`${HN_SITE}/user?id=${encodeURIComponent(state.auth.username)}`, "_blank", "noopener,noreferrer");
      return;
    }

    window.open(`${HN_SITE}/login?goto=news`, "_blank", "noopener,noreferrer");
    showToast("HN login opened in a new tab");
    await new Promise((resolve) => setTimeout(resolve, 600));
    checkAuthState().catch(() => {
      // no-op
    });
  });

  ui.themeToggle.addEventListener("click", () => {
    const isDark = document.body.dataset.theme !== "light";
    const nextTheme = isDark ? "light" : "dark";
    applyTheme(nextTheme);
    setStoredValue("theme", nextTheme).catch(() => {
      // non-fatal: popup still works without persisted theme
    });
  });

  ui.newPostButton.addEventListener("click", () => {
    if (!state.auth.isLoggedIn) {
      showToast("Sign in to create a post");
      return;
    }
    openModal(ui.postModal);
  });

  ui.settingsButton.addEventListener("click", () => {
    openModal(ui.settingsModal);
  });

  ui.accentPalette.addEventListener("click", (event) => {
    const option = event.target.closest("button.accent-option[data-accent]");
    if (!option) {
      return;
    }

    const accentKey = option.dataset.accent;
    if (!accentKey) {
      return;
    }

    applyAccent(accentKey);
    setStoredValue("accent", accentKey).catch(() => {
      // non-fatal: popup still works without persisted accent color
    });
  });

  ui.storyCommentForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = ui.storyCommentInput.value.trim();
    if (!text) {
      showToast("Comment cannot be empty");
      return;
    }

    postCommentOnStory(text).catch((error) => {
      console.error(error);
      setCommentHint("Unable to post comment", true);
    });
  });

  ui.postForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitNewPost().catch((error) => {
      console.error(error);
      showToast("Failed to submit post");
    });
  });

  document.body.addEventListener("click", (event) => {
    const closeTarget = event.target.closest("[data-close]");
    if (!closeTarget) {
      return;
    }

    const modalId = closeTarget.dataset.close;
    const modal = document.getElementById(modalId);
    if (modal) {
      closeModal(modal);
    }
  });

  document.body.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    closeModal(ui.commentsModal);
    closeModal(ui.postModal);
    closeModal(ui.settingsModal);
  });
}

function renderAccentPalette() {
  if (!ui.accentPalette) {
    return;
  }

  ui.accentPalette.innerHTML = "";
  for (const option of ACCENT_OPTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "accent-option";
    button.dataset.accent = option.key;
    button.setAttribute("role", "option");
    button.setAttribute("aria-label", option.label);

    const swatch = document.createElement("span");
    swatch.className = "accent-swatch";
    swatch.style.backgroundColor = option.color;

    const label = document.createElement("span");
    label.className = "accent-label";
    label.textContent = option.label;

    button.appendChild(swatch);
    button.appendChild(label);
    ui.accentPalette.appendChild(button);
  }

  renderAccentSelection();
}

function renderAccentSelection() {
  if (!ui.accentPalette) {
    return;
  }

  const buttons = ui.accentPalette.querySelectorAll("button.accent-option[data-accent]");
  for (const button of buttons) {
    const selected = button.dataset.accent === state.accentKey;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  }
}

function applyAccent(accentKey) {
  const fallback = ACCENT_OPTIONS.find((option) => option.key === DEFAULT_ACCENT_KEY) || ACCENT_OPTIONS[0];
  const option = ACCENT_OPTIONS.find((entry) => entry.key === accentKey) || fallback;
  if (!option) {
    return;
  }

  state.accentKey = option.key;
  document.body.style.setProperty("--primary", option.color);
  renderAccentSelection();
}

async function loadStoredReadStories() {
  const fromStorage = await getStoredValue("readStoryIds");
  const normalized = normalizeReadStoryIds(fromStorage);
  state.readStoryIds = new Set(normalized);
}

function normalizeReadStoryIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids = [];
  const seen = new Set();
  for (const raw of value) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) {
      continue;
    }
    ids.push(id);
    seen.add(id);
    if (ids.length >= MAX_READ_STORIES) {
      break;
    }
  }
  return ids;
}

function markStoryRead(storyId) {
  const normalizedId = Number(storyId);
  if (!Number.isFinite(normalizedId) || normalizedId <= 0) {
    return;
  }

  if (state.readStoryIds.has(normalizedId)) {
    applyReadStateToVisibleStory(normalizedId);
    return;
  }

  state.readStoryIds.add(normalizedId);
  while (state.readStoryIds.size > MAX_READ_STORIES) {
    const oldest = state.readStoryIds.values().next().value;
    state.readStoryIds.delete(oldest);
  }

  applyReadStateToVisibleStory(normalizedId);
  setStoredValue("readStoryIds", Array.from(state.readStoryIds)).catch(() => {
    // non-fatal: read state still applies for current session
  });
}

function applyReadStateToVisibleStory(storyId) {
  const card = ui.storyList.querySelector(`.story-card[data-id='${storyId}']`);
  if (!card) {
    return;
  }

  card.classList.add("read");
  const title = card.querySelector(".story-title");
  if (title) {
    title.classList.add("read");
  }
}

function renderToday() {
  const now = new Date();
  const weekday = now.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
  const month = now.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
  const day = String(now.getDate()).padStart(2, "0");
  ui.todayLabel.textContent = `${weekday}, ${month} ${day}`;
}

function renderFeedTabs() {
  ui.feedTabs.innerHTML = "";
  for (const feed of FEEDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tab-pill ui-tabs-trigger ${feed.key === state.activeFeed ? "active" : ""}`;
    button.dataset.feed = feed.key;
    button.textContent = feed.label;
    button.disabled = state.loadingFeed;
    ui.feedTabs.appendChild(button);
  }
}

async function loadFeed(feedKey) {
  state.loadingFeed = true;
  state.feedRequestId += 1;
  const requestId = state.feedRequestId;

  renderFeedTabs();
  renderSkeletonStories();
  setStatus(`Loading ${labelForFeed(feedKey)}...`);

  try {
    await getFeedIds(feedKey);
    const cachedStories = state.feedCache.get(feedKey) || [];
    if (cachedStories.length && state.feedCursorByFeed.has(feedKey)) {
      if (requestId !== state.feedRequestId) {
        return;
      }
      renderStories(cachedStories, { append: false });
      await fillFeedViewport(feedKey, requestId);
      const loadedFromCache = state.feedCache.get(feedKey) || [];
      if (hasMoreStories(feedKey)) {
        setStatus(`Loaded ${loadedFromCache.length} stories in ${labelForFeed(feedKey)}`);
      } else {
        setStatus(`${loadedFromCache.length} stories in ${labelForFeed(feedKey)}`);
      }
      return;
    }

    state.feedCache.set(feedKey, []);
    state.feedCursorByFeed.set(feedKey, 0);

    if (requestId !== state.feedRequestId) {
      return;
    }

    const firstLoadProgressed = await loadMoreStories(feedKey, requestId, INITIAL_STORIES, { replace: true });
    if (!firstLoadProgressed && requestId === state.feedRequestId) {
      renderStories([], { append: false });
    }

    await fillFeedViewport(feedKey, requestId);

    if (requestId !== state.feedRequestId) {
      return;
    }

    const loadedStories = state.feedCache.get(feedKey) || [];
    if (hasMoreStories(feedKey)) {
      setStatus(`Loaded ${loadedStories.length} stories in ${labelForFeed(feedKey)}`);
    } else {
      setStatus(`${loadedStories.length} stories in ${labelForFeed(feedKey)}`);
    }
  } catch (error) {
    console.error(error);
    if (requestId !== state.feedRequestId) {
      return;
    }
    ui.storyList.innerHTML = "<article class='story-card'><p>Could not load feed. Try again.</p></article>";
    setStatus("Feed unavailable");
  } finally {
    if (requestId === state.feedRequestId) {
      state.loadingFeed = false;
      renderFeedTabs();
    }
  }
}

async function getFeedIds(feedKey) {
  if (state.feedIdsCache.has(feedKey)) {
    return state.feedIdsCache.get(feedKey);
  }

  const ids = await fetchJson(`${HN_API}/${feedKey}.json`).then((list) => (Array.isArray(list) ? list : []));
  state.feedIdsCache.set(feedKey, ids);
  return ids;
}

function hasMoreStories(feedKey) {
  const ids = state.feedIdsCache.get(feedKey) || [];
  const cursor = state.feedCursorByFeed.get(feedKey) || 0;
  return cursor < ids.length;
}

async function loadMoreForActiveFeed() {
  const feedKey = state.activeFeed;
  const requestId = state.feedRequestId;
  if (!hasMoreStories(feedKey)) {
    return;
  }

  const progressed = await loadMoreStories(feedKey, requestId, STORIES_PAGE_SIZE);
  if (!progressed || requestId !== state.feedRequestId) {
    return;
  }

  const loadedStories = state.feedCache.get(feedKey) || [];
  if (hasMoreStories(feedKey)) {
    setStatus(`Loaded ${loadedStories.length} stories in ${labelForFeed(feedKey)}`);
  } else {
    setStatus(`${loadedStories.length} stories in ${labelForFeed(feedKey)}`);
  }
}

async function fillFeedViewport(feedKey, requestId) {
  if (!ui.feedScroll) {
    return;
  }

  let guard = 0;
  while (
    requestId === state.feedRequestId &&
    feedKey === state.activeFeed &&
    hasMoreStories(feedKey) &&
    ui.feedScroll.scrollHeight <= ui.feedScroll.clientHeight + 24 &&
    guard < 10
  ) {
    const progressed = await loadMoreStories(feedKey, requestId, STORIES_PAGE_SIZE);
    if (!progressed) {
      break;
    }
    guard += 1;
  }
}

async function loadMoreStories(feedKey, requestId, desiredCount = STORIES_PAGE_SIZE, options = {}) {
  const { replace = false } = options;
  if (state.loadingMoreStories) {
    return false;
  }

  const ids = state.feedIdsCache.get(feedKey) || [];
  if (!ids.length) {
    if (replace && requestId === state.feedRequestId) {
      renderStories([], { append: false });
    }
    return false;
  }

  let cursor = state.feedCursorByFeed.get(feedKey) || 0;
  if (cursor >= ids.length) {
    return false;
  }

  state.loadingMoreStories = true;
  const startCursor = cursor;

  try {
    const allStories = replace ? [] : [...(state.feedCache.get(feedKey) || [])];
    const appendedStories = [];

    while (cursor < ids.length && appendedStories.length < desiredCount) {
      const remainingNeeded = desiredCount - appendedStories.length;
      const fetchWindow = Math.min(Math.max(remainingNeeded * 2, 8), 24, ids.length - cursor);
      const chunkIds = ids.slice(cursor, cursor + fetchWindow);
      cursor += chunkIds.length;

      const entries = await Promise.all(
        chunkIds.map((id) =>
          fetchItem(id).catch(() => {
            return null;
          })
        )
      );

      for (const item of entries) {
        if (!item || item.deleted || item.dead) {
          continue;
        }
        const story = { ...item, rank: allStories.length + 1 };
        allStories.push(story);
        appendedStories.push(story);
        if (appendedStories.length >= desiredCount) {
          break;
        }
      }

      if (requestId !== state.feedRequestId || feedKey !== state.activeFeed) {
        return false;
      }
    }

    state.feedCursorByFeed.set(feedKey, cursor);
    state.feedCache.set(feedKey, allStories);

    if (requestId !== state.feedRequestId || feedKey !== state.activeFeed) {
      return false;
    }

    if (replace) {
      renderStories(allStories, { append: false });
    } else if (appendedStories.length) {
      renderStories(appendedStories, { append: true });
    }

    return cursor > startCursor;
  } finally {
    state.loadingMoreStories = false;
  }
}

function renderSkeletonStories() {
  ui.storyList.innerHTML = "";
  for (let i = 0; i < 5; i += 1) {
    const card = document.createElement("article");
    card.className = "story-card ui-separator-item loading";
    ui.storyList.appendChild(card);
  }
}

function renderStories(stories, options = {}) {
  const { append = false } = options;
  if (!append) {
    ui.storyList.innerHTML = "";
  }

  if (!stories.length) {
    if (append) {
      return;
    }
    const empty = document.createElement("article");
    empty.className = "story-card ui-separator-item";
    empty.innerHTML = "<p>No stories found in this feed.</p>";
    ui.storyList.appendChild(empty);
    return;
  }

  const template = document.getElementById("storyTemplate");

  for (const story of stories) {
    const fragment = template.content.cloneNode(true);

    const safeStoryUrl = normalizeExternalStoryUrl(story.url);
    const domain = getDomain(safeStoryUrl || "");
    const rank = fragment.querySelector(".rank");
    const domainEl = fragment.querySelector(".domain");
    const title = fragment.querySelector(".story-title");
    const meta = fragment.querySelector(".story-meta");
    const score = fragment.querySelector(".score");
    const vote = fragment.querySelector(".vote-trigger");
    const comments = fragment.querySelector(".comments-trigger");
    const media = fragment.querySelector(".story-media");
    const thumb = fragment.querySelector(".story-thumb");
    const fallback = fragment.querySelector(".story-thumb-fallback");
    const card = fragment.querySelector(".story-card");
    const openUrl = safeStoryUrl || `${HN_SITE}/item?id=${story.id}`;
    const isRead = state.readStoryIds.has(story.id);

    rank.textContent = `${story.rank}.`;
    domainEl.textContent = domain;
    title.textContent = story.title || "Untitled";
    title.href = openUrl;
    title.title = story.title || "";
    title.dataset.id = String(story.id);
    title.classList.toggle("read", isRead);
    media.href = openUrl;
    media.dataset.id = String(story.id);
    if (card) {
      card.style.setProperty("--i", String((story.rank - 1) % 10));
      card.dataset.id = String(story.id);
      card.classList.toggle("read", isRead);
    }

    meta.textContent = `${story.by || "unknown"} • ${relativeTime(story.time)}`;

    const pointCount = typeof story.score === "number" ? story.score : 0;
    const commentCount = Array.isArray(story.kids) ? story.kids.length : 0;
    score.textContent = String(pointCount);
    vote.dataset.id = String(story.id);
    comments.textContent = `• ${commentCount} comments`;
    comments.dataset.id = String(story.id);

    if (feedIsJobs() || commentCount === 0) {
      comments.disabled = true;
      comments.textContent = "• no comments";
    }

    const mediaLabel = domain
      .replace(/\.[a-z]{2,}$/i, "")
      .slice(0, 3)
      .toUpperCase();
    fallback.textContent = mediaLabel || "HN";

    hydrateStoryPreview(safeStoryUrl, domain, thumb, fallback);

    ui.storyList.appendChild(fragment);
  }
}

async function openCommentsModal(story) {
  state.currentStoryForComments = story;
  state.commentsRequestId += 1;
  const requestId = state.commentsRequestId;

  const openStoryUrl = `${HN_SITE}/item?id=${story.id}`;
  const safeStoryUrl = normalizeExternalStoryUrl(story.url);
  const safeStoryDomain = getDomain(safeStoryUrl || "");
  ui.commentsStoryLink.href = openStoryUrl;
  ui.commentsStoryLink.textContent = story.title || "Open story";
  ui.commentsStoryDomain.textContent = safeStoryDomain;
  ui.commentsStoryMeta.textContent = `↑ ${story.score || 0} • ${story.by || "unknown"} • ${relativeTime(story.time)}`;
  ui.commentsStoryThumbWrap.href = safeStoryUrl || openStoryUrl;
  const mediaLabel = safeStoryDomain
    .replace(/\.[a-z]{2,}$/i, "")
    .slice(0, 3)
    .toUpperCase();
  ui.commentsStoryThumbFallback.textContent = mediaLabel || "HN";
  hydrateStoryPreview(safeStoryUrl, safeStoryDomain, ui.commentsStoryThumb, ui.commentsStoryThumbFallback);
  ui.commentsList.innerHTML = "";
  ui.commentsAuthHint.textContent = "";
  ui.commentsAuthHint.className = "hint";
  ui.storyCommentInput.value = "";

  openModal(ui.commentsModal);

  if (state.auth.isLoggedIn) {
    ui.storyCommentForm.classList.remove("hidden");
    setCommentHint("");
  } else {
    ui.storyCommentForm.classList.add("hidden");
    setCommentHint("Sign in to comment and reply");
  }

  const baseStory = await fetchItem(story.id);
  if (!baseStory) {
    ui.commentsList.innerHTML = "<p class='hint error'>Could not load comments.</p>";
    return;
  }

  const rootIds = Array.isArray(baseStory.kids) ? baseStory.kids : [];
  if (!rootIds.length) {
    ui.commentsList.innerHTML = "<p class='hint'>No comments yet.</p>";
    return;
  }

  ui.commentsList.innerHTML = "<p class='hint'>Loading thread...</p>";

  let seen = 0;
  const buildCommentNode = async (commentId, depth) => {
    if (seen >= MAX_COMMENTS) {
      return null;
    }

    const item = await fetchItem(commentId);
    if (!item || item.deleted || item.dead || !item.text) {
      return null;
    }

    seen += 1;
    const kids = Array.isArray(item.kids) ? item.kids : [];
    const childNodes = await Promise.all(kids.map((kidId) => buildCommentNode(kidId, depth + 1)));

    return {
      id: item.id,
      by: item.by,
      text: item.text,
      time: item.time,
      depth,
      children: childNodes.filter(Boolean)
    };
  };

  const threads = (await Promise.all(rootIds.map((id) => buildCommentNode(id, 0)))).filter(Boolean);

  if (requestId !== state.commentsRequestId) {
    return;
  }

  renderCommentTree(threads, baseStory.id);
}

function renderCommentTree(threads, storyId) {
  ui.commentsList.innerHTML = "";

  if (!threads.length) {
    ui.commentsList.innerHTML = "<p class='hint'>No readable comments found.</p>";
    return;
  }

  const insertComment = (node) => {
    const card = document.createElement("article");
    card.className = "comment-card ui-card ui-card-subtle";
    const depth = Math.min(node.depth, 5);
    card.style.setProperty("--depth", String(depth));

    const head = document.createElement("header");
    head.className = "comment-head";
    const author = document.createElement("span");
    author.className = "comment-author";
    author.textContent = node.by || "anon";

    const right = document.createElement("div");
    right.className = "comment-head-right";

    const age = document.createElement("span");
    age.textContent = relativeTime(node.time);

    const upvote = document.createElement("button");
    upvote.type = "button";
    upvote.className = "comment-upvote ui-button ui-button-ghost ui-button-icon ui-button-sm";
    upvote.title = "Upvote comment";
    upvote.setAttribute("aria-label", "Upvote comment");
    upvote.innerHTML = `
      <svg class="lucide-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="m18 15-6-6-6 6"></path>
      </svg>
    `;

    if (!state.auth.isLoggedIn) {
      upvote.disabled = true;
      upvote.title = "Sign in to upvote";
    }

    right.appendChild(age);
    right.appendChild(upvote);

    head.appendChild(author);
    head.appendChild(right);

    const text = document.createElement("div");
    text.className = "comment-text";
    text.appendChild(sanitizeCommentHtml(node.text || ""));

    card.appendChild(head);
    card.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "comment-actions";

    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "comment-reply ui-button ui-button-ghost ui-button-sm";
    replyButton.textContent = "Reply";

    if (!state.auth.isLoggedIn) {
      replyButton.disabled = true;
      replyButton.textContent = "Sign in to reply";
      replyButton.style.opacity = "0.65";
      replyButton.style.cursor = "not-allowed";
    }

    actions.appendChild(replyButton);

    const replyForm = document.createElement("form");
    replyForm.className = "reply-form";
    replyForm.innerHTML = `
      <textarea class="ui-textarea" rows="3" maxlength="5000" placeholder="Write a reply..."></textarea>
      <div class="reply-actions">
        <button type="button" class="cancel ui-button ui-button-outline ui-button-sm">Cancel</button>
        <button type="submit" class="send ui-button ui-button-primary ui-button-sm">Reply</button>
      </div>
    `;

    actions.appendChild(replyForm);
    card.appendChild(actions);

    replyButton.addEventListener("click", () => {
      replyForm.classList.add("visible");
      replyButton.style.display = "none";
      const textarea = replyForm.querySelector("textarea");
      if (textarea) {
        textarea.focus();
      }
    });

    const cancel = replyForm.querySelector("button.cancel");
    cancel?.addEventListener("click", () => {
      replyForm.classList.remove("visible");
      replyButton.style.display = "inline";
      const textarea = replyForm.querySelector("textarea");
      if (textarea) {
        textarea.value = "";
      }
    });

    replyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const textarea = replyForm.querySelector("textarea");
      const value = textarea?.value.trim() || "";

      if (!value) {
        showToast("Reply cannot be empty");
        return;
      }

      try {
        await postReply(node.id, storyId, value);
        showToast("Reply posted");
        await openCommentsModal(state.currentStoryForComments);
      } catch (error) {
        console.error(error);
        showToast("Failed to post reply");
      }
    });

    upvote.addEventListener("click", async () => {
      try {
        await voteItem(node.id, storyId);
        upvote.disabled = true;
        upvote.classList.add("done");
        showToast("Upvoted");
      } catch (error) {
        console.error(error);
        if (error.message.includes("No upvote link")) {
          showToast("Already voted or unavailable");
          return;
        }
        showToast(error.message || "Failed to upvote");
      }
    });

    ui.commentsList.appendChild(card);

    for (const child of node.children) {
      insertComment(child);
    }
  };

  for (const thread of threads) {
    insertComment(thread);
  }
}

async function postCommentOnStory(text) {
  if (!state.currentStoryForComments) {
    return;
  }

  ui.submitStoryComment.disabled = true;
  setCommentHint("Posting comment...");

  try {
    const form = await fetchForm(`${HN_SITE}/item?id=${state.currentStoryForComments.id}`, /comment/i, ["text"]);
    if (!form) {
      setCommentHint("Sign in required to post comments", true);
      return;
    }

    const payload = new URLSearchParams(form.hiddenInputs);
    payload.set(form.textareaName || "text", text);

    await postForm(form.actionUrl, payload);

    ui.storyCommentInput.value = "";
    setCommentHint("Comment posted", false, true);
    showToast("Comment posted");
    await openCommentsModal(state.currentStoryForComments);
  } finally {
    ui.submitStoryComment.disabled = false;
  }
}

async function postReply(commentId, storyId, text) {
  const replyUrl = `${HN_SITE}/reply?id=${encodeURIComponent(commentId)}&goto=${encodeURIComponent(`item?id=${storyId}`)}`;
  const form = await fetchForm(replyUrl, /comment/i, ["text"]);
  if (!form) {
    throw new Error("Reply form unavailable");
  }

  const payload = new URLSearchParams(form.hiddenInputs);
  payload.set(form.textareaName || "text", text);

  await postForm(form.actionUrl, payload);
}

async function voteStory(story, triggerElement) {
  try {
    await voteItem(story.id, story.id);
    triggerElement.disabled = true;
    triggerElement.classList.add("done");
    if (typeof story.score === "number") {
      story.score += 1;
      const scoreEl = triggerElement.parentElement?.querySelector(".score");
      if (scoreEl) {
        scoreEl.textContent = String(story.score);
      }
    }
    showToast("Upvoted");
  } catch (error) {
    console.error(error);
    if (error.message === "Not signed in") {
      showToast("Sign in required for upvote");
      return;
    }
    if (error.message.includes("No upvote link")) {
      showToast("Already voted or unavailable");
      return;
    }
    showToast(error.message || "Could not upvote");
  }
}

async function voteItem(itemId, storyId) {
  if (!state.auth.isLoggedIn) {
    await checkAuthState();
    if (!state.auth.isLoggedIn) {
      throw new Error("Not signed in");
    }
  }

  const voteUrl = await findVoteUrl(itemId, storyId);
  if (!voteUrl) {
    throw new Error("No upvote link (already voted or unavailable)");
  }

  const response = await fetch(voteUrl, {
    method: "GET",
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Vote failed (${response.status})`);
  }

  const bodyText = await response.text();
  if (response.url.includes("/login") || (/login/i.test(bodyText) && /password/i.test(bodyText))) {
    throw new Error("Not signed in");
  }

  if (/already voted/i.test(bodyText)) {
    throw new Error("Already upvoted");
  }
}

async function findVoteUrl(itemId, storyId) {
  const cacheKey = `${storyId}:${itemId}`;
  if (state.voteLinkCache.has(cacheKey)) {
    return state.voteLinkCache.get(cacheKey);
  }

  const html = await fetchText(`${HN_SITE}/item?id=${encodeURIComponent(storyId)}`);
  const doc = parseFetchedHtmlForQuery(html);

  const voteAnchors = Array.from(doc.querySelectorAll("a[href*='vote?id='][href*='how=up']"));
  for (const anchor of voteAnchors) {
    const href = anchor.getAttribute("href") || "";
    const absoluteUrl = new URL(href, HN_SITE);
    const idParam = Number(absoluteUrl.searchParams.get("id"));
    const howParam = absoluteUrl.searchParams.get("how");

    if (idParam === itemId && howParam === "up") {
      const finalUrl = absoluteUrl.toString();
      state.voteLinkCache.set(cacheKey, finalUrl);
      return finalUrl;
    }
  }

  return null;
}

async function submitNewPost() {
  const titleInput = document.getElementById("postTitleInput");
  const urlInput = document.getElementById("postUrlInput");
  const textInput = document.getElementById("postTextInput");

  const title = titleInput.value.trim();
  const url = urlInput.value.trim();
  const text = textInput.value.trim();

  if (!title) {
    showToast("Title is required");
    return;
  }

  if (!url && !text) {
    showToast("Provide a URL or some text");
    return;
  }

  ui.submitPost.disabled = true;
  try {
    const form = await fetchForm(`${HN_SITE}/submit`, null, ["title"]);

    if (!form) {
      showToast("Sign in required to submit");
      return;
    }

    const payload = new URLSearchParams(form.hiddenInputs);
    payload.set("title", title);
    payload.set("url", url);
    payload.set("text", text);

    await postForm(form.actionUrl, payload);

    titleInput.value = "";
    urlInput.value = "";
    textInput.value = "";
    closeModal(ui.postModal);

    showToast("Post submitted");
    state.feedCache.delete(state.activeFeed);
    loadFeed(state.activeFeed).catch(() => {
      // no-op
    });
  } finally {
    ui.submitPost.disabled = false;
  }
}

async function fetchForm(url, actionPattern, requiredFields = []) {
  const html = await fetchText(url);
  const doc = parseFetchedHtmlForQuery(html);

  let form = null;
  if (actionPattern) {
    for (const candidate of Array.from(doc.querySelectorAll("form"))) {
      const action = candidate.getAttribute("action") || "";
      if (actionPattern.test(action)) {
        form = candidate;
        break;
      }
    }
  }

  if (!form && requiredFields.length > 0) {
    for (const candidate of Array.from(doc.querySelectorAll("form"))) {
      const hasAllFields = requiredFields.every((fieldName) => candidate.querySelector(`[name='${fieldName}']`));
      if (hasAllFields) {
        form = candidate;
        break;
      }
    }
  }

  if (!form) {
    form = doc.querySelector("form");
  }

  if (!form) {
    return null;
  }

  const action = form.getAttribute("action") || url;
  const actionUrl = new URL(action, HN_SITE).toString();

  const hiddenInputs = [];
  for (const input of Array.from(form.querySelectorAll("input[type='hidden'][name]"))) {
    hiddenInputs.push([input.name, input.value || ""]);
  }

  const textarea = form.querySelector("textarea[name]");
  const textareaName = textarea?.getAttribute("name") || "text";

  return {
    actionUrl,
    hiddenInputs,
    textareaName
  };
}

async function postForm(actionUrl, bodyParams) {
  const response = await fetch(actionUrl, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: bodyParams.toString()
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  const redirectedToLogin = response.url.includes("/login");
  const bodyText = await response.text();
  const invalidSession = /login/i.test(bodyText) && /password/i.test(bodyText);
  const alreadySubmitted = /already submitted/i.test(bodyText);

  if (redirectedToLogin || invalidSession) {
    throw new Error("Not signed in");
  }

  if (alreadySubmitted) {
    throw new Error("HN rejected duplicate content");
  }

  return bodyText;
}

async function fetchItem(id) {
  return fetchJson(`${HN_API}/item/${id}.json`);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Network request failed (${response.status})`);
  }

  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    credentials: "include",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Page request failed (${response.status})`);
  }

  return response.text();
}

async function checkAuthState() {
  try {
    const html = await fetchText(`${HN_SITE}/news`);
    const doc = parseFetchedHtmlForQuery(html);

    const logoutLink = doc.querySelector("a[href^='logout?']");
    const me = doc.querySelector("#me") || doc.querySelector("a.hnuser");

    state.auth.checked = true;
    state.auth.isLoggedIn = Boolean(logoutLink);
    state.auth.username = state.auth.isLoggedIn ? (me?.textContent?.trim() || "account") : null;
  } catch (error) {
    console.warn("Could not determine auth status", error);
    state.auth.checked = true;
    state.auth.isLoggedIn = false;
    state.auth.username = null;
  }

  renderAuthButton();
}

function renderAuthButton() {
  if (!state.auth.checked) {
    ui.authButton.textContent = "";
    return;
  }

  if (state.auth.isLoggedIn && state.auth.username) {
    ui.authButton.textContent = `@${state.auth.username}`;
    return;
  }

  ui.authButton.textContent = "sign in";
}

function openModal(modal) {
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeModal(modal) {
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

function setCommentHint(text, isError = false, isOk = false) {
  ui.commentsAuthHint.textContent = text;
  ui.commentsAuthHint.className = "hint";

  if (!text) {
    ui.commentsAuthHint.classList.add("hidden");
    return;
  }

  if (isError) {
    ui.commentsAuthHint.classList.add("error");
  }

  if (isOk) {
    ui.commentsAuthHint.classList.add("ok");
  }
}

function setStatus(text) {
  if (ui.statusText) {
    ui.statusText.textContent = text;
    return;
  }
  ui.statusBar.textContent = text;
}

function showToast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.remove("hidden");

  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
  }

  state.toastTimer = setTimeout(() => {
    ui.toast.classList.add("hidden");
  }, 2200);
}

function labelForFeed(feedKey) {
  return FEEDS.find((entry) => entry.key === feedKey)?.label || "Feed";
}

function feedIsJobs() {
  return state.activeFeed === "jobstories";
}

function getDomain(url) {
  try {
    if (!url) {
      return "news.ycombinator.com";
    }

    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "news.ycombinator.com";
  }
}

function hydrateStoryPreview(storyUrl, domain, imageElement, fallbackElement) {
  const safeStoryUrl = normalizeExternalStoryUrl(storyUrl);
  const fallbackSources = buildStoryPreviewSources(safeStoryUrl, domain);
  setImageWithFallback(imageElement, fallbackElement, fallbackSources);

  if (!safeStoryUrl) {
    return;
  }

  resolvePrimaryStoryImage(safeStoryUrl)
    .then((primaryImageUrl) => {
      if (!primaryImageUrl) {
        return;
      }
      setImageWithFallback(imageElement, fallbackElement, [primaryImageUrl, ...fallbackSources], {
        preserveCurrent: true
      });
    })
    .catch(() => {
      // non-fatal; fallbacks already attempted
    });
}

async function resolvePrimaryStoryImage(storyUrl) {
  const normalizedStoryUrl = normalizeExternalStoryUrl(storyUrl);
  if (!normalizedStoryUrl) {
    return null;
  }

  if (state.previewSourceCache.has(normalizedStoryUrl)) {
    return state.previewSourceCache.get(normalizedStoryUrl);
  }

  if (state.previewPromiseCache.has(normalizedStoryUrl)) {
    return state.previewPromiseCache.get(normalizedStoryUrl);
  }

  const task = (async () => {
    let resolvedImage = null;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4200);
      const response = await fetch(normalizedStoryUrl, {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const responseUrl = normalizeExternalStoryUrl(response.url || normalizedStoryUrl);
        if (!responseUrl) {
          resolvedImage = null;
        } else {
          const contentType = (response.headers.get("content-type") || "").toLowerCase();
          if (contentType.startsWith("image/")) {
            resolvedImage = responseUrl;
          } else if (contentType.includes("text/html") || contentType.includes("application/xhtml+xml") || contentType === "") {
            const html = await readTextWithLimit(response, MAX_PREVIEW_HTML_BYTES);
            if (html) {
              resolvedImage = extractPrimaryImageFromHtml(html, responseUrl);
            }
          }
        }
      }
    } catch {
      resolvedImage = null;
    }

    state.previewSourceCache.set(normalizedStoryUrl, resolvedImage);
    return resolvedImage;
  })().finally(() => {
    state.previewPromiseCache.delete(normalizedStoryUrl);
  });

  state.previewPromiseCache.set(normalizedStoryUrl, task);
  return task;
}

async function readTextWithLimit(response, maxBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return null;
  }

  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    const maxChars = Math.floor(maxBytes * 1.5);
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // no-op
      }
      return null;
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function extractPrimaryImageFromHtml(html, baseUrl) {
  if (!html || !baseUrl) {
    return null;
  }

  // Avoid parsing full remote documents in extension context. We only need meta tags.
  const headMatch = html.match(/<head[\s\S]*?<\/head>/i);
  const source = headMatch ? headMatch[0] : html.slice(0, 22000);
  const metaTags = source.match(/<meta\b[^>]*>/gi) || [];
  const priorityKeys = ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"];

  const candidatesByKey = new Map();
  for (const tag of metaTags) {
    const property = (readHtmlAttribute(tag, "property") || readHtmlAttribute(tag, "name") || "").trim().toLowerCase();
    if (!property || !priorityKeys.includes(property)) {
      continue;
    }

    const value = decodeHtmlEntities(readHtmlAttribute(tag, "content") || "").trim();
    if (!value) {
      continue;
    }

    const normalized = resolveImageCandidateUrl(value, baseUrl);
    if (!normalized) {
      continue;
    }

    if (!candidatesByKey.has(property)) {
      candidatesByKey.set(property, normalized);
    }
  }

  for (const key of priorityKeys) {
    const candidate = candidatesByKey.get(key);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function readHtmlAttribute(tag, attribute) {
  if (!tag || !attribute) {
    return "";
  }
  const escapedAttribute = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escapedAttribute + "\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>`]+))", "i");
  const match = tag.match(pattern);
  if (!match) {
    return "";
  }
  return (match[1] || match[2] || match[3] || "").trim();
}

function decodeHtmlEntities(value) {
  if (!value || !value.includes("&")) {
    return value || "";
  }
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function resolveImageCandidateUrl(rawUrl, baseUrl) {
  try {
    const parsed = new URL(rawUrl, baseUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (isDisallowedHost(parsed.hostname)) {
      return null;
    }

    const pathname = parsed.pathname.toLowerCase();
    if (/\.(js|mjs|css|map|json|xml|txt|html?|php|asp|aspx)(\?|#|$)/i.test(pathname)) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeExternalStoryUrl(rawUrl) {
  if (!rawUrl) {
    return null;
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (isDisallowedHost(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function isDisallowedHost(hostname) {
  const host = String(hostname || "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  if (!host) {
    return true;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }

  if (isIpv4(host)) {
    const [a, b] = host.split(".").map((part) => Number(part));
    if (a === 10 || a === 127 || a === 0) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    return false;
  }

  if (host.includes(":")) {
    if (host === "::1" || host === "::") {
      return true;
    }
    if (host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) {
      return true;
    }
    if (host.startsWith("::ffff:")) {
      const mapped = host.slice(7);
      if (isIpv4(mapped)) {
        const [a, b] = mapped.split(".").map((part) => Number(part));
        return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
      }
    }
  }

  return false;
}

function isIpv4(host) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return false;
  }
  return host.split(".").every((part) => {
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255;
  });
}

function buildStoryPreviewSources(storyUrl, domain) {
  const sources = [];

  if (domain) {
    sources.push(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`);
    sources.push(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`);
    sources.push(`https://logo.clearbit.com/${encodeURIComponent(domain)}`);
    sources.push(`https://${domain}/favicon.ico`);
  }

  if (storyUrl) {
    const safeEncodedUrl = encodeURIComponent(storyUrl);
    const safeUriUrl = encodeURI(storyUrl);
    sources.push(`https://www.google.com/s2/favicons?domain_url=${safeEncodedUrl}&sz=128`);
    sources.push(`https://image.thum.io/get/width/320/crop/320/noanimate/${safeUriUrl}`);
    sources.push(`https://s.wordpress.com/mshots/v1/${safeEncodedUrl}?w=320&h=320`);
    try {
      const origin = new URL(storyUrl).origin;
      sources.push(`${origin}/favicon.ico`);
    } catch {
      // ignore invalid story URL
    }
  }

  return sources;
}

function setImageWithFallback(imageElement, fallbackElement, sources, options = {}) {
  const { preserveCurrent = false } = options;
  const uniqueSources = Array.from(new Set(sources.filter(Boolean)));
  const token = String(Date.now()) + String(Math.random());
  const hadVisibleImage = !imageElement.classList.contains("hidden") && Boolean(imageElement.src);
  const preservedSrc = hadVisibleImage ? imageElement.src : "";

  imageElement.dataset.loadToken = token;
  if (!preserveCurrent || !hadVisibleImage) {
    imageElement.classList.add("hidden");
    fallbackElement.classList.remove("hidden");
  }
  imageElement.onload = null;
  imageElement.onerror = null;

  const previousBlob = imageElement.dataset.blobUrl;
  if (previousBlob) {
    URL.revokeObjectURL(previousBlob);
    delete imageElement.dataset.blobUrl;
  }

  if (!uniqueSources.length) {
    return;
  }

  const timeoutForSource = (source) => {
    if (source.includes("thum.io") || source.includes("mshots")) {
      return 2600;
    }
    if (source.includes("favicon") || source.includes(".ico") || source.includes("logo.clearbit")) {
      return 1200;
    }
    return 1700;
  };

  const probeDirectSource = (source) =>
    new Promise((resolve, reject) => {
      const probe = new Image();
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error("timeout"));
      }, timeoutForSource(source));

      probe.onload = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        resolve(source);
      };
      probe.onerror = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutId);
        reject(new Error("load_error"));
      };
      probe.referrerPolicy = "no-referrer";
      probe.src = source;
    });

  const fetchImageBlobUrl = async (source) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutForSource(source) + 900);
      const response = await fetch(source, {
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const looksLikeImagePath = /\.(png|jpe?g|webp|gif|svg|ico)(\?|#|$)/i.test(source);
      if (!contentType.startsWith("image/") && !looksLikeImagePath) {
        return null;
      }

      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        return null;
      }

      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  };

  (async () => {
    const showResolvedSource = (resolvedSrc) => {
      if (imageElement.dataset.loadToken !== token) {
        return false;
      }
      imageElement.src = resolvedSrc;
      imageElement.classList.remove("hidden");
      fallbackElement.classList.add("hidden");
      return true;
    };

    try {
      const firstDirect = await Promise.any(uniqueSources.map((source) => probeDirectSource(source)));
      if (showResolvedSource(firstDirect)) {
        return;
      }
    } catch {
      // fall through
    }

    try {
      const firstBlobUrl = await Promise.any(
        uniqueSources.map(async (source) => {
          const blobUrl = await fetchImageBlobUrl(source);
          if (!blobUrl) {
            throw new Error("blob_unavailable");
          }
          return blobUrl;
        })
      );

      if (imageElement.dataset.loadToken !== token) {
        URL.revokeObjectURL(firstBlobUrl);
        return;
      }

      imageElement.dataset.blobUrl = firstBlobUrl;
      if (showResolvedSource(firstBlobUrl)) {
        return;
      }
    } catch {
      // no usable blob source
    }

    if (imageElement.dataset.loadToken === token) {
      if (preserveCurrent && preservedSrc) {
        imageElement.src = preservedSrc;
        imageElement.classList.remove("hidden");
        fallbackElement.classList.add("hidden");
        return;
      }
      imageElement.classList.add("hidden");
      fallbackElement.classList.remove("hidden");
    }
  })();
}

function relativeTime(unixTimestamp) {
  if (!unixTimestamp) {
    return "just now";
  }

  const elapsedSeconds = Math.max(0, Math.floor(Date.now() / 1000) - unixTimestamp);

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function sanitizeCommentHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = `<div>${stripPotentiallyExecutableTags(html)}</div>`;
  const root = template.content.firstElementChild;
  const allowed = new Set(["A", "P", "I", "EM", "B", "STRONG", "CODE", "PRE", "UL", "OL", "LI", "BLOCKQUOTE", "BR"]);

  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return document.createTextNode("");
    }

    const tagName = node.tagName.toUpperCase();

    if (!allowed.has(tagName)) {
      const fragment = document.createDocumentFragment();
      for (const child of Array.from(node.childNodes)) {
        fragment.appendChild(cleanNode(child));
      }
      return fragment;
    }

    const safe = document.createElement(tagName.toLowerCase());

    if (tagName === "A") {
      const href = node.getAttribute("href") || "";
      if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("item?id=") || href.startsWith("user?id=")) {
        safe.setAttribute("href", href.startsWith("http") ? href : `${HN_SITE}/${href}`);
        safe.setAttribute("target", "_blank");
        safe.setAttribute("rel", "noreferrer noopener");
      }
    }

    for (const child of Array.from(node.childNodes)) {
      safe.appendChild(cleanNode(child));
    }

    return safe;
  };

  const fragment = document.createDocumentFragment();
  if (!root) {
    return fragment;
  }

  for (const child of Array.from(root.childNodes)) {
    fragment.appendChild(cleanNode(child));
  }

  return fragment;
}

function parseFetchedHtmlForQuery(html) {
  const template = document.createElement("template");
  template.innerHTML = stripPotentiallyExecutableTags(html);
  return template.content;
}

function stripPotentiallyExecutableTags(html) {
  const source = String(html || "");
  return source
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/<link\b[^>]*>/gi, "");
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function applyStoredTheme() {
  const fromStorage = await getStoredValue("theme");
  if (fromStorage === "dark" || fromStorage === "light") {
    applyTheme(fromStorage);
    return;
  }

  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  applyTheme(prefersLight ? "light" : "dark");
}

async function applyStoredAccent() {
  const fromStorage = await getStoredValue("accent");
  const hasStoredOption = ACCENT_OPTIONS.some((option) => option.key === fromStorage);
  applyAccent(hasStoredOption ? fromStorage : DEFAULT_ACCENT_KEY);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  const toggledLabel = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
  if (ui.themeIconSun && ui.themeIconMoon) {
    const light = theme === "light";
    ui.themeIconSun.classList.toggle("hidden", !light);
    ui.themeIconMoon.classList.toggle("hidden", light);
  }
  ui.themeToggle.title = toggledLabel;
  ui.themeToggle.setAttribute("aria-label", toggledLabel);
}

function getStoredValue(key) {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
      return;
    }

    resolve(localStorage.getItem(key));
  });
}

function setStoredValue(key, value) {
  return new Promise((resolve) => {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ [key]: value }, () => resolve());
      return;
    }

    localStorage.setItem(key, value);
    resolve();
  });
}
