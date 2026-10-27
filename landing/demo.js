(() => {
  "use strict";

  const agents = { atlas: "Atlas", echo: "Echo", ghost: "Ghost" };
  const files = [
    { path: "src/auth.ts", owners: ["atlas", "ghost"] },
    { path: "app/page.tsx", owners: ["echo"] },
    { path: "tests/auth.ts", owners: ["atlas"] },
    { path: "ui/button.tsx", owners: ["echo"] },
    { path: "src/session.ts", owners: ["atlas"] },
    { path: "lib/config.ts", owners: ["ghost"] },
  ];
  const initialEvents = [
    { agent: "ghost", action: "overlap", file: "src/auth.ts", time: "09:41:08" },
    { agent: "echo", action: "modified", file: "app/page.tsx", time: "09:41:06" },
    { agent: "atlas", action: "created", file: "tests/auth.ts", time: "09:41:04" },
    { agent: "atlas", action: "modified", file: "src/auth.ts", time: "09:41:02" },
    { agent: "echo", action: "modified", file: "ui/button.tsx", time: "09:41:00" },
  ];
  const sequence = [
    { agent: "atlas", action: "modified", file: "src/session.ts" },
    { agent: "echo", action: "modified", file: "ui/button.tsx" },
    { agent: "ghost", action: "reviewed", file: "lib/config.ts" },
    { agent: "atlas", action: "tested", file: "tests/auth.ts" },
    { agent: "echo", action: "reviewed", file: "app/page.tsx" },
    { agent: "ghost", action: "reviewed", file: "src/auth.ts" },
  ];
  const state = { agent: "all", tab: "activity", paused: false, acknowledged: false, events: [...initialEvents], tick: 0 };
  const $ = (selector) => document.querySelector(selector);
  const agentButtons = [...document.querySelectorAll("[data-agent]")];
  const tabButtons = [...document.querySelectorAll("[data-tab]")];
  const announcement = $("#announcement");
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let visualsPaused = motionPreference.matches;
  let consoleVisible = false;

  function announce(message) {
    announcement.textContent = message;
  }

  function selectedFiles() {
    return files.filter((file) => state.agent === "all" || file.owners.includes(state.agent));
  }

  function hasAttention() {
    return !state.acknowledged && state.agent !== "echo";
  }

  function renderActivity() {
    const visibleEvents = state.events.filter((event) => state.agent === "all" || event.agent === state.agent).slice(0, 5);
    // All interpolated content comes from the fixed simulation data above.
    $("#activity-list").innerHTML = visibleEvents.map((event) => `<div class="event-row"><span class="event-agent"><span class="event-mark" aria-hidden="true">${event.action === "overlap" ? "!" : "↳"}</span>${agents[event.agent]}<span class="event-action ${event.action === "overlap" ? "overlap" : ""}">${event.action}</span></span><code>${event.file}</code><time>${event.time}</time></div>`).join("");
  }

  function renderFiles() {
    $("#file-list").innerHTML = selectedFiles().map((file) => {
      const overlap = file.owners.length > 1 && !state.acknowledged;
      const status = overlap ? "Overlap" : file.owners.length > 1 ? "Reviewed" : "Tracked";
      return `<div class="file-row"><code>${file.path}</code><span class="file-owner">${file.owners.map((agent) => agents[agent]).join(" + ")}</span><span class="file-status ${overlap ? "warning" : ""}">${status}</span></div>`;
    }).join("");
  }

  function renderAttention() {
    if (hasAttention()) {
      $("#attention-content").innerHTML = '<div class="attention-box"><p class="eyebrow red">[ ! ] FILE OVERLAP DETECTED</p><h4>Two agents. One line of fire.</h4><p>Atlas and Ghost both touched <code>src/auth.ts</code>. Review their work before combining changes. This is a simulated advisory; acknowledging it marks it reviewed.</p><button class="small-button" id="acknowledge">Mark as reviewed <span aria-hidden="true">✓</span></button></div>';
      $("#acknowledge").addEventListener("click", () => {
        state.acknowledged = true;
        render();
        $("#panel-attention").focus({ preventScroll: true });
        announce("File overlap marked as reviewed. No outstanding advisories.");
      });
    } else {
      $("#attention-content").innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">⊕</span><h4>${state.acknowledged ? "Back under control." : "Nothing in the crosshairs."}</h4><p>${state.acknowledged ? "You reviewed the file overlap. The activity trail is still there." : "Echo has no file overlaps. Select All agents to inspect the workspace advisory."}<br />Keep watching. We’ll keep the view clear.</p></div>`;
    }
  }

  function render() {
    agentButtons.forEach((button) => {
      const selected = button.dataset.agent === state.agent;
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
    tabButtons.forEach((button) => {
      const selected = button.dataset.tab === state.tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      $(`#panel-${button.dataset.tab}`).hidden = !selected;
    });
    $("#monitor-title").textContent = state.agent === "all" ? "All eyes on your code." : `${agents[state.agent]} is in your sights.`;
    $("#agent-total").innerHTML = `${state.agent === "all" ? "03" : "01"} <small>connected</small>`;
    $("#file-total").innerHTML = `${String(selectedFiles().length).padStart(2, "0")} <small>this session</small>`;
    $("#attention-total").innerHTML = `${hasAttention() ? "01" : "00"} <small>${hasAttention() ? "file overlap" : "all clear"}</small>`;
    $("#attention-badge").textContent = hasAttention() ? "1" : "0";
    $("#view-description").textContent = { activity: "Every action leaves a trace.", files: "Know who touched what.", attention: "A little paranoia pays off." }[state.tab];
    renderActivity();
    renderFiles();
    renderAttention();
  }

  function selectTab(tab, focus = false) {
    state.tab = tab;
    render();
    if (focus) $(`#tab-${tab}`).focus();
  }

  agentButtons.forEach((button) => button.addEventListener("click", () => {
    state.agent = button.dataset.agent;
    render();
    announce(state.agent === "all" ? "Showing all agents." : `Showing activity for ${agents[state.agent]}.`);
  }));
  tabButtons.forEach((button, index) => {
    button.addEventListener("click", () => selectTab(button.dataset.tab));
    button.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabButtons.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabButtons.length) % tabButtons.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabButtons.length - 1;
      else return;
      event.preventDefault();
      selectTab(tabButtons[nextIndex].dataset.tab, true);
    });
  });

  function renderFeedState() {
    $("#feed-toggle").innerHTML = state.paused ? 'Resume feed <span aria-hidden="true">▷</span>' : 'Pause feed <span aria-hidden="true">Ⅱ</span>';
    $("#feed-toggle").setAttribute("aria-pressed", String(state.paused));
    $("#feed-state").textContent = state.paused ? "FEED PAUSED" : "FEED ACTIVE";
    document.body.classList.toggle("feed-paused", state.paused);
  }

  $("#feed-toggle").addEventListener("click", () => {
    state.paused = !state.paused;
    renderFeedState();
    announce(state.paused ? "Simulated activity paused." : "Simulated activity resumed.");
  });
  $("#reset-demo").addEventListener("click", () => {
    Object.assign(state, { agent: "all", tab: "activity", paused: false, acknowledged: false, events: [...initialEvents], tick: 0 });
    renderFeedState();
    render();
    announce("Simulation reset. Three agents and one file overlap ready to explore.");
  });

  function renderMotionState() {
    document.documentElement.classList.toggle("visuals-paused", visualsPaused);
    $("#motion-toggle").setAttribute("aria-pressed", String(visualsPaused));
    $("#motion-toggle").innerHTML = visualsPaused ? 'Resume visuals <span aria-hidden="true">▷</span>' : 'Pause visuals <span aria-hidden="true">Ⅱ</span>';
    document.dispatchEvent(new CustomEvent("overwatch:motion", { detail: { paused: visualsPaused } }));
  }
  $("#motion-toggle").addEventListener("click", () => {
    visualsPaused = !visualsPaused;
    renderMotionState();
  });
  motionPreference.addEventListener("change", () => {
    visualsPaused = motionPreference.matches;
    renderMotionState();
  });

  new IntersectionObserver(([entry]) => { consoleVisible = entry.isIntersecting; }).observe($(".console"));
  window.setInterval(() => {
    if (state.paused || document.hidden || !consoleVisible) return;
    const next = sequence[state.tick % sequence.length];
    state.tick += 1;
    const totalSeconds = 9 * 3600 + 41 * 60 + 8 + state.tick * 4;
    const time = [Math.floor(totalSeconds / 3600) % 24, Math.floor(totalSeconds / 60) % 60, totalSeconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
    state.events = [{ ...next, time }, ...state.events].slice(0, 60);
    renderActivity();
  }, 4000);

  $("#year").textContent = String(new Date().getFullYear());
  render();
  renderMotionState();
})();
