/* app.js — Akasha Board UI logic
   v4: per-project custom columns, people/assignees, registry list view, search */
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const PROJECT_COLORS = ["#e8a33d", "#c96f3f", "#7ba05b", "#5b8fa0", "#a05b8f", "#8f7bd8"];
  const COL_COLORS = ["#8a7f6b", "#c9912f", "#b3352c", "#6b7040", "#2b4361", "#a05b8f", "#5b8fa0", "#c96f3f"];
  const PERSON_COLORS = ["#b3352c", "#2b4361", "#6b7040", "#c9912f", "#a05b8f", "#5b8fa0", "#c96f3f", "#8f7bd8"];

  const state = {
    projects: [], columns: [], people: [], tasks: [], updates: [], chat: [],
    activeProject: "all", view: "board", modalTask: null,
    search: "", hideDone: false, hideUnscheduled: false, todayWho: "all", todayScope: "due",
  };

  /* ---------- helpers ---------- */
  // local-timezone date helpers (never UTC — a Berlin evening is still 'today' for the user)
  const localISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = () => localISODate(new Date());
  const addDays = (ds, n) => { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return localISODate(d); };
  const dayDiff = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
  const fmtDate = (ds) => ds ? new Date(ds + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
  const escAttr = esc;
  const byId = (arr, id) => arr.find((x) => x.id === id);
  const initials = (name) => name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const projOf = (t) => byId(state.projects, t.project_id);
  const peopleOf = (t) => {
    let ids = t.assignees;
    if ((!ids || !ids.length) && t.assignee_id) ids = [t.assignee_id]; // legacy backfill
    return (ids || []).map((id) => byId(state.people, id)).filter(Boolean);
  };

  /* ---------- columns model ---------- */
  // columns for one project, ordered
  function colsForProject(pid) {
    return state.columns.filter((c) => c.project_id === pid).sort((a, b) => a.position - b.position);
  }
  // stages to display for current filter. "all" = union of stage names in canonical order.
  function visibleStages() {
    if (state.activeProject !== "all") return colsForProject(state.activeProject);
    // union by lowercased name, first occurrence order (seeded projects give classic four first)
    const seen = new Map();
    const projs = state.projects.map((p) => p.id);
    const sorted = [...state.columns].sort((a, b) =>
      projs.indexOf(a.project_id) - projs.indexOf(b.project_id) || a.position - b.position);
    for (const c of sorted) {
      const key = c.name.toLowerCase();
      if (!seen.has(key)) seen.set(key, c);
    }
    return [...seen.values()];
  }
  function stageColor(name, pid) {
    const key = String(name).toLowerCase();
    let c;
    if (pid && pid !== "all") c = colsForProject(pid).find((x) => x.name.toLowerCase() === key);
    if (!c) c = visibleStages().find((x) => x.name.toLowerCase() === key);
    return c ? c.color : "#8a7f6b";
  }
  function isDoneStage(name) {
    const key = String(name).toLowerCase();
    return key === "done" || key.startsWith("done") || key.includes("complete") || key.includes("publish") || key.includes("shipped");
  }
  function firstStage(pid) {
    const cols = colsForProject(pid);
    return cols.length ? cols[0].name : "To do";
  }

  /* ---------- task filtering ---------- */
  function filteredTasks() {
    let ts = state.tasks;
    if (state.activeProject !== "all") ts = ts.filter((t) => t.project_id === state.activeProject);
    if (state.search) {
      const q = state.search.toLowerCase();
      ts = ts.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.notes || "").toLowerCase().includes(q) ||
        (projOf(t)?.name || "").toLowerCase().includes(q));
    }
    return ts;
  }

  /* ---------- render dispatch ---------- */
  function render() {
    renderChips();
    $("#view-board").classList.toggle("active", state.view === "board");
    $("#view-timeline").classList.toggle("active", state.view === "timeline");
    $("#view-charts").classList.toggle("active", state.view === "charts");
    $("#view-updates").classList.toggle("active", state.view === "updates");
    $("#view-today").classList.toggle("active", state.view === "today");
    $("#view-list").classList.toggle("active", state.view === "list");
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === state.view));
    if (state.view === "board") renderBoard();
    else if (state.view === "timeline") renderTimeline();
    else if (state.view === "charts") renderCharts();
    else if (state.view === "updates") renderChat();
    else if (state.view === "list") renderList();
    else if (state.view === "today") renderToday();
  }

  function renderChips() {
    const wrap = $("#project-chips");
    wrap.innerHTML = "";
    const mk = (id, label, color) => {
      const b = document.createElement("button");
      b.className = "chip" + (state.activeProject === id ? " active" : "");
      b.textContent = label;
      if (color) b.style.setProperty("--chip-color", color);
      b.onclick = () => { state.activeProject = id; render(); };
      if (id !== "all") {
        let pressTimer = null;
        const start = (e) => { const x = e.clientX, y = e.clientY; pressTimer = setTimeout(() => openProjectMenu(id, label, x, y), 700); };
        const cancel = () => clearTimeout(pressTimer);
        b.addEventListener("pointerdown", start);
        b.addEventListener("pointerup", cancel);
        b.addEventListener("pointerleave", cancel);
        b.addEventListener("contextmenu", (e) => { e.preventDefault(); clearTimeout(pressTimer); openProjectMenu(id, label, e.clientX, e.clientY); });
      }
      wrap.appendChild(b);
    };
    mk("all", "All projects");
    state.projects.forEach((p) => mk(p.id, p.name, p.color));
  }

  /* ---------- BOARD ---------- */
  function renderBoard() {
    const board = $("#board");
    board.innerHTML = "";
    const stages = visibleStages();
    const tasks = filteredTasks();

    stages.forEach((stage) => {
      const key = stage.name.toLowerCase();
      const colTasks = tasks.filter((t) => String(t.status).toLowerCase() === key)
        .sort((a, b) => a.position - b.position);
      const col = document.createElement("div");
      col.className = "col";
      col.dataset.stage = stage.name;
      col.style.borderTopColor = stage.color;
      col.innerHTML = `
        <div class="col-head">
          <span class="col-dot" style="background:${stage.color}"></span>
          <span class="col-name">${esc(stage.name)}</span>
          <span class="col-count">${colTasks.length}</span>
          ${state.activeProject !== "all" ? `<button class="col-arrow" data-dir="left" title="Move left">←</button><button class="col-arrow" data-dir="right" title="Move right">→</button><button class="col-edit" title="Edit column">✎</button>` : ""}
        </div>
        <div class="col-body"></div>
        <button class="add-task">+ Add task</button>`;
      const body = $(".col-body", col);

      colTasks.forEach((t) => body.appendChild(taskCard(t)));

      // events
      $(".add-task", col).onclick = () => openTaskModal(null, { status: stage.name });
      const editBtn = $(".col-edit", col);
      if (editBtn) editBtn.onclick = () => openColumnModal(stage);

      // task dnd (drop task onto column)
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drag-over"); });
      col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
      col.addEventListener("drop", (e) => {
        e.preventDefault(); col.classList.remove("drag-over");
        const id = e.dataTransfer.getData("text/plain");
        const t = byId(state.tasks, id);
        if (!t) return;
        moveTaskToStage(t, stage.name, body);
      });

      // column arrows: move left/right
      $$(".col-arrow", col).forEach((btn) => btn.addEventListener("click", () => {
        moveColumn(stage.id, btn.dataset.dir);
      }));

      // touch dnd (pointer events)
      enableTouchDnD(col, body, stage.name);
      board.appendChild(col);
    });

    // add-column button (only when a project is selected)
    if (state.activeProject !== "all") {
      const add = document.createElement("button");
      add.className = "add-col";
      add.innerHTML = `<span class="add-col-plus">+</span><span>Add column</span>`;
      add.onclick = () => openColumnModal(null);
      board.appendChild(add);
    } else if (!stages.length) {
      board.innerHTML = `<div class="empty-hint">No columns yet. Select a project to create its stages, or add a project with the + button.</div>`;
    }
  }

  function taskCard(t) {
    const card = document.createElement("div");
    card.className = "card";
    card.draggable = true;
    card.dataset.id = t.id;
    const p = projOf(t);
    const people = peopleOf(t);
    const done = isDoneStage(t.status);
    let badges = "";
    if (t.due) {
      const diff = dayDiff(todayStr(), t.due);
      const cls = !done && diff < 0 ? "over" : !done && diff <= 3 ? "soon" : "";
      const label = diff === 0 ? "today" : fmtDate(t.due);
      badges += `<span class="badge badge-due ${cls}">${label}</span>`;
    }
    if (t.priority === 3) badges += `<span class="badge badge-pri3">!!!</span>`;
    else if (t.priority === 1) badges += `<span class="badge badge-pri1">low</span>`;
    if (t.recur) badges += `<span class="badge badge-recur" title="Repeats ${t.recur}">↻</span>`;
    const avatars = people.map((pe) => `<span class="avatar" style="background:${pe.color}" title="${escAttr(pe.name)}">${initials(pe.name)}</span>`).join("");
    card.innerHTML = `
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-meta">
        ${badges}
        ${avatars}
        ${state.activeProject === "all" && p ? `<span class="card-proj">${esc(p.name)}</span>` : ""}
      </div>`;
    card.onclick = () => { if (state._suppressClick) { state._suppressClick = false; return; } openTaskModal(t); };
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", t.id);
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => card.classList.add("dragging"), 0);
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    return card;
  }

  /* guard: wraps async handlers so a second tap during a slow save can't double-submit */
  function guard(fn) {
    return async (e) => {
      if (state._busy) return;
      state._busy = true;
      try { await fn(e); } catch (err) { console.error(err); }
      finally { state._busy = false; }
    };
  }

  const RECUR_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, yearly: 365 };

  /* Central status change: handles recurrence spawn when a recurring task enters a done column. */
  async function setTaskStatus(task, stageName, bodyEl) {
    const siblings = state.tasks
      .filter((x) => String(x.status).toLowerCase() === stageName.toLowerCase() && x.id !== task.id)
      .sort((a, b) => a.position - b.position);
    const pos = siblings.length ? siblings[siblings.length - 1].position + 1 : Date.now();
    const wasDone = isDoneStage(task.status);
    task.status = stageName; task.position = pos;
    await DB.updateTask(task.id, { status: stageName, position: pos });
    // recurrence: entering a done stage spawns the next occurrence
    if (!wasDone && isDoneStage(stageName) && task.recur && RECUR_DAYS[task.recur]) {
      const step = RECUR_DAYS[task.recur];
      const base = task.due || todayStr();
      let next = addDays(base, step);
      // never schedule in the past — roll forward until future
      while (next <= todayStr()) next = addDays(next, step);
      const firstCol = colsForProject(task.project_id).sort((a, b) => a.position - b.position)[0];
      const clone = {
        project_id: task.project_id,
        title: task.title,
        status: firstCol ? firstCol.name : task.status,
        priority: task.priority,
        start: null,
        due: next,
        position: Date.now(),
        assignees: task.assignees || [],
        assignee_id: (task.assignees || [])[0] || null,
        recur: task.recur,
        notes: task.notes || null,
      };
      const created = await DB.addTask(clone);
      if (created && !state.tasks.some((x) => x.id === created.id)) state.tasks.push(created);
    }
  }

  async function moveColumn(colId, dir) {
    const cols = colsForProject(state.activeProject).sort((a, b) => a.position - b.position);
    const i = cols.findIndex((c) => c.id === colId);
    if (i < 0) return;
    const j = dir === "left" ? i - 1 : i + 1;
    if (j < 0 || j >= cols.length) return;
    [cols[i], cols[j]] = [cols[j], cols[i]];
    cols.forEach((c, k) => { c.position = k + 1; });
    state.columns = state.columns.map((c) => cols.find((x) => x.id === c.id) || c);
    await DB.updateColumn(cols[i].id, { position: cols[i].position });
    await DB.updateColumn(cols[j].id, { position: cols[j].position });
    renderBoard();
  }

  async function moveTaskToStage(task, stageName, bodyEl) {
    await setTaskStatus(task, stageName, bodyEl);
    render();
  }

  /* touch drag: long-press then move */
  function enableTouchDnD(col, body, stageName) {
    // handled per-card below in bindTouch
    $$(".card", body).forEach((card) => bindTouch(card, body, stageName));
  }
  let touchDrag = null;
  function bindTouch(card, body, stageName) {
    card.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch") return;
      const id = card.dataset.id;
      const startX = e.clientX, startY = e.clientY;
      let timer = setTimeout(() => {
        touchDrag = { id, card };
        card.classList.add("dragging");
        navigator.vibrate && navigator.vibrate(20);
      }, 350);
      const cancel = () => { clearTimeout(timer); };
      const move = (ev) => {
        if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) cancel();
        if (!touchDrag) return;
        ev.preventDefault();
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetCol = el && el.closest ? el.closest(".col") : null;
        $$(".col").forEach((c) => c.classList.toggle("drag-over", c === targetCol));
      };
      const up = async (ev) => {
        cancel();
        card.removeEventListener("pointermove", move);
        card.removeEventListener("pointerup", up);
        card.removeEventListener("pointercancel", up);
        if (!touchDrag) return;
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const targetCol = el && el.closest ? el.closest(".col") : null;
        $$(".col").forEach((c) => c.classList.remove("drag-over"));
        card.classList.remove("dragging");
        const t = byId(state.tasks, touchDrag.id);
        touchDrag = null;
        if (t && targetCol && targetCol.dataset.stage) {
          state._suppressClick = true;
          await moveTaskToStage(t, targetCol.dataset.stage, $(".col-body", targetCol));
        } else {
          state._suppressClick = true;
          render();
        }
      };
      card.addEventListener("pointermove", move, { passive: false });
      card.addEventListener("pointerup", up);
      card.addEventListener("pointercancel", up);
    });
  }

  /* ---------- LIST (Registry) ---------- */
  function renderList() {
    const wrap = $("#list-wrap");
    const tasks = filteredTasks();
    const stages = visibleStages();
    const visible = state.hideDone ? tasks.filter((t) => !isDoneStage(t.status)) : tasks;
    const sorted = [...visible].sort((a, b) => {
      const pa = projOf(a)?.name || "", pb = projOf(b)?.name || "";
      if (pa !== pb) return pa.localeCompare(pb);
      const sa = stages.findIndex((s) => s.name.toLowerCase() === String(a.status).toLowerCase());
      const sb = stages.findIndex((s) => s.name.toLowerCase() === String(b.status).toLowerCase());
      if (sa !== sb) return sa - sb;
      return (a.due || "9999") < (b.due || "9999") ? -1 : 1;
    });

    let html = `
      <div class="list-toolbar">
        <input id="list-search" type="search" placeholder="Search tasks…" value="${escAttr(state.search)}">
        <label class="hide-done"><input type="checkbox" id="hide-done" ${state.hideDone ? "checked" : ""}> hide done</label>
      </div>
      <div class="list-table">
        <div class="list-row list-head">
          <span class="lc-title">Task</span>
          ${state.activeProject === "all" ? `<span class="lc-proj">Project</span>` : ""}
          <span class="lc-status">Status</span>
          <span class="lc-assignee">Who</span>
          <span class="lc-due">Due</span>
          <span class="lc-pri">Pri</span>
        </div>`;

    if (!sorted.length) {
      html += `<div class="empty-hint">Nothing here. ${state.search ? "Try a different search." : "Add a task with the + button."}</div>`;
    }

    sorted.forEach((t) => {
      const p = projOf(t);
      const people = peopleOf(t);
      const done = isDoneStage(t.status);
      const projCols = colsForProject(t.project_id);
      const stageOpts = (projCols.length ? projCols : stages)
        .map((s) => `<option value="${escAttr(s.name)}" ${String(t.status).toLowerCase() === s.name.toLowerCase() ? "selected" : ""}>${esc(s.name)}</option>`).join("");
      const peopleOpts = state.people
        .map((pe) => `<option value="${pe.id}" ${people.some((x) => x.id === pe.id) ? "selected" : ""}>${esc(pe.name)}</option>`).join("");
      let dueCls = "";
      if (t.due && !done) {
        const diff = dayDiff(todayStr(), t.due);
        dueCls = diff < 0 ? "over" : diff <= 3 ? "soon" : "";
      }
      html += `
        <div class="list-row ${done ? "is-done" : ""}" data-id="${t.id}">
          <span class="lc-title" data-act="edit">${esc(t.title)}</span>
          ${state.activeProject === "all" ? `<span class="lc-proj">${p ? `<i style="background:${p.color}"></i>${esc(p.name)}` : ""}</span>` : ""}
          <span class="lc-status">
            <select class="cell-select status-select" data-id="${t.id}" style="border-color:${stageColor(t.status, t.project_id)}">${stageOpts}</select>
          </span>
          <span class="lc-assignee">
            <select class="cell-select assignee-select" data-id="${t.id}" multiple size="1" title="Hold Ctrl/Cmd to pick several">${peopleOpts}</select>
          </span>
          <span class="lc-due ${dueCls}">${t.due ? fmtDate(t.due) : "—"}</span>
          <span class="lc-pri">${"!".repeat(t.priority)}</span>
        </div>`;
    });
    html += `</div>`;
    wrap.innerHTML = html;

    $("#list-search").addEventListener("input", (e) => {
      state.search = e.target.value;
      clearTimeout(state._st);
      state._st = setTimeout(() => {
        const el = $("#list-search");
        renderList();
        const el2 = $("#list-search");
        el2.focus(); el2.setSelectionRange(el2.value.length, el2.value.length);
      }, 250);
    });
    $("#hide-done").addEventListener("change", (e) => { state.hideDone = e.target.checked; renderList(); });
    $$(".status-select", wrap).forEach((sel) => sel.addEventListener("change", async (e) => {
      const t = byId(state.tasks, sel.dataset.id);
      if (!t) return;
      await setTaskStatus(t, sel.value);
      renderList();
    }));
    $$(".assignee-select", wrap).forEach((sel) => sel.addEventListener("change", async (e) => {
      const t = byId(state.tasks, sel.dataset.id);
      if (!t) return;
      t.assignees = [...sel.selectedOptions].map((o) => o.value);
      t.assignee_id = t.assignees[0] || null; // keep legacy col in sync
      await DB.updateTask(t.id, { assignees: t.assignees, assignee_id: t.assignee_id });
    }));
    $$('[data-act="edit"]', wrap).forEach((el) => el.addEventListener("click", () => {
      const t = byId(state.tasks, el.closest(".list-row").dataset.id);
      if (t) openTaskModal(t);
    }));
  }

  /* ---------- TIMELINE ---------- */
  function renderTimeline() {
    const wrap = $("#timeline-wrap");
    wrap.innerHTML = "";
    const tasks = filteredTasks().filter((t) => t.start || t.due);
    const uns = state.hideUnscheduled ? [] : filteredTasks().filter((t) => !t.start && !t.due);

    // hide-unscheduled toggle
    const toggle = $("#tl-hide-uns");
    if (toggle) {
      toggle.checked = state.hideUnscheduled;
      toggle.onchange = (e) => { state.hideUnscheduled = e.target.checked; renderTimeline(); };
    }

    if (!tasks.length && !uns.length) {
      wrap.innerHTML = `<div class="empty-hint">No tasks yet.</div>`;
      $("#uns-wrap").innerHTML = "";
      return;
    }

    let min = todayStr(), max = todayStr();
    tasks.forEach((t) => {
      const s = t.start || t.due, e = t.due || t.start;
      if (s < min) min = s; if (e > max) max = e;
    });
    min = addDays(min, -3); max = addDays(max, 5);
    const days = dayDiff(min, max) + 1;
    const dayW = 38;

    const tl = document.createElement("div");
    tl.className = "timeline";
    tl.style.width = `${190 + days * dayW}px`;

    // header
    const head = document.createElement("div");
    head.className = "tl-header";
    head.style.paddingLeft = "190px";
    for (let i = 0; i < days; i++) {
      const ds = addDays(min, i);
      const d = new Date(ds + "T00:00:00");
      const wknd = d.getDay() === 0 || d.getDay() === 6;
      head.innerHTML += `<div class="tl-day ${wknd ? "wknd" : ""} ${ds === todayStr() ? "today" : ""}" style="width:${dayW}px">${d.getDate()}<br>${d.toLocaleDateString("en", { weekday: "narrow" })}</div>`;
    }
    tl.appendChild(head);

    // group by project
    const groups = new Map();
    tasks.forEach((t) => {
      const k = t.project_id || "none";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    });

    groups.forEach((ts, pid) => {
      const p = byId(state.projects, pid);
      const g = document.createElement("div");
      g.className = "tl-group";
      g.innerHTML = `<span class="gdot" style="background:${p ? p.color : "#8a7f6b"}"></span>${p ? esc(p.name) : "No project"}`;
      tl.appendChild(g);

      ts.sort((a, b) => ((a.start || a.due) < (b.start || b.due) ? -1 : 1)).forEach((t) => {
        const row = document.createElement("div");
        row.className = "tl-row";
        const label = document.createElement("div");
        label.className = "tl-label";
        label.textContent = t.title;
        label.title = t.title;
        row.appendChild(label);
        const track = document.createElement("div");
        track.className = "tl-track";
        track.style.width = `${days * dayW}px`;

        for (let i = 0; i < days; i++) {
          const ds = addDays(min, i);
          const d = new Date(ds + "T00:00:00");
          const gl = document.createElement("div");
          gl.className = "tl-gridline" + (d.getDay() === 0 || d.getDay() === 6 ? " wknd" : "");
          gl.style.left = `${i * dayW}px`;
          track.appendChild(gl);
        }
        const todayOff = dayDiff(min, todayStr());
        if (todayOff >= 0 && todayOff < days) {
          const td = document.createElement("div");
          td.className = "tl-today";
          td.style.left = `${todayOff * dayW + dayW / 2}px`;
          track.appendChild(td);
        }

        const s = t.start || t.due, e = t.due || t.start;
        const off = dayDiff(min, s), len = dayDiff(s, e) + 1;
        const bar = document.createElement("div");
        bar.className = "tl-bar" + (isDoneStage(t.status) ? " done" : "") + (!isDoneStage(t.status) && t.due && t.due < todayStr() ? " overdue" : "");
        bar.style.left = `${off * dayW + 2}px`;
        bar.style.width = `${len * dayW - 4}px`;
        bar.style.background = stageColor(t.status, t.project_id);
        bar.textContent = t.title;
        bar.onclick = () => openTaskModal(t);
        track.appendChild(bar);
        row.appendChild(track);
        tl.appendChild(row);
      });
    });

    wrap.appendChild(tl);

    // unscheduled
    const uw = $("#uns-wrap");
    uw.innerHTML = "";
    if (uns.length) {
      const box = document.createElement("div");
      box.className = "unscheduled";
      box.innerHTML = `<h4>Unscheduled</h4>`;      uns.forEach((t) => {
        const el = document.createElement("div");
        el.className = "uns-item";
        const p = projOf(t);
        el.innerHTML = `<span>${esc(t.title)}</span><span class="muted">${p ? esc(p.name) : ""}</span>`;
        const btn = document.createElement("button");
        btn.className = "btn-ghost";
        btn.textContent = "Schedule";
        btn.onclick = () => openTaskModal(t);
        el.appendChild(btn);
        box.appendChild(el);
      });
      uw.appendChild(box);
    }
  }

  /* ---------- CHARTS ---------- */
  function renderCharts() {
    const tasks = filteredTasks();
    const stages = visibleStages();

    // donut by stage
    const counts = stages.map((s) => ({
      name: s.name, color: s.color,
      n: tasks.filter((t) => String(t.status).toLowerCase() === s.name.toLowerCase()).length,
    })).filter((x) => x.n > 0);
    const total = tasks.length;
    const donutEl = $("#chart-status");
    if (!total) {
      donutEl.innerHTML = `<div class="empty-hint">No tasks yet.</div>`;
    } else {
      const R = 60, CIRC = 2 * Math.PI * R;
      let acc = 0;
      const segs = counts.map((c) => {
        const frac = c.n / total;
        const seg = `<circle r="${R}" cx="80" cy="80" fill="none" stroke="${c.color}" stroke-width="26"
          stroke-dasharray="${frac * CIRC} ${CIRC}" stroke-dashoffset="${-acc * CIRC}" transform="rotate(-90 80 80)"/>`;
        acc += frac;
        return seg;
      }).join("");
      donutEl.innerHTML = `
        <div class="donut-wrap">
          <svg width="160" height="160" viewBox="0 0 160 160">
            <circle r="${R}" cx="80" cy="80" fill="none" stroke="#efe9d6" stroke-width="26"/>
            ${segs}
            <text x="80" y="76" text-anchor="middle" class="donut-center">${total}</text>
            <text x="80" y="94" text-anchor="middle" class="donut-center-sub">TASKS</text>
          </svg>
          <div class="donut-legend">
            ${counts.map((c) => `<div class="li"><span class="sw" style="background:${c.color}"></span>${esc(c.name)}<span class="n">${c.n}</span></div>`).join("")}
          </div>
        </div>`;
    }

    // activity (updates) 14 days
    const act = $("#chart-activity");
    const daysArr = [];
    for (let i = 13; i >= 0; i--) daysArr.push(addDays(todayStr(), -i));
    const countsByDay = daysArr.map((ds) => state.updates.filter((u) => (u.created_at || "").slice(0, 10) === ds).length);
    const maxA = Math.max(1, ...countsByDay);
    act.innerHTML = `<div class="bars">` + daysArr.map((ds, i) => `
      <div class="bar-col">
        <div class="bar" style="height:${(countsByDay[i] / maxA) * 100}%" title="${countsByDay[i]} updates"></div>
        <div class="bar-lab">${new Date(ds + "T00:00:00").getDate()}</div>
      </div>`).join("") + `</div>`;

    // per-project progress
    const pp = $("#chart-projects");
    const projs = state.activeProject === "all" ? state.projects : state.projects.filter((p) => p.id === state.activeProject);
    pp.innerHTML = projs.map((p) => {
      const ts = state.tasks.filter((t) => t.project_id === p.id);
      const done = ts.filter((t) => isDoneStage(t.status)).length;
      const pct = ts.length ? Math.round((done / ts.length) * 100) : 0;
      return `<div class="proj-row">
        <div class="pr-head"><span>${esc(p.name)}</span><span class="pct">${done}/${ts.length} · ${pct}%</span></div>
        <div class="progress"><i style="width:${pct}%;background:${p.color}"></i></div>
      </div>`;
    }).join("") || `<div class="empty-hint">No projects yet.</div>`;

    // overdue
    const ov = $("#chart-overdue");
    const over = tasks.filter((t) => t.due && t.due < todayStr() && !isDoneStage(t.status))
      .sort((a, b) => (a.due < b.due ? -1 : 1));
    ov.innerHTML = over.length ? over.map((t) => {
      const p = projOf(t);
      return `<div class="over-item">
        <span class="sw" style="width:9px;height:9px;border-radius:50%;background:${p ? p.color : "#8a7f6b"}"></span>
        <span>${esc(t.title)}</span>
        <span class="over-days">${dayDiff(t.due, todayStr())}d over</span>
      </div>`;
    }).join("") : `<div class="empty-hint">Nothing overdue. Jai ho. 🙏</div>`;
  }

  /* ---------- UPDATES ---------- */
  function renderToday() {
    const wrap = $("#today-wrap");
    const today = todayStr();
    // assignee filter chips: Everyone + each person + Unassigned
    const chip = (id, label, color) => `<button class="who-chip ${state.todayWho === id ? "active" : ""}" data-who="${id}">${color ? `<span class="avatar" style="background:${color}">${initials(label)}</span>` : ""}${esc(label)}</button>`;
    const chips = chip("all", "All people") +
      state.people.map((p) => chip(p.id, p.name, p.color)).join("") +
      chip("none", "Unassigned");

    let tasks = filteredTasks().filter((t) => !isDoneStage(t.status));
    if (state.todayWho === "none") tasks = tasks.filter((t) => !peopleOf(t).length);
    else if (state.todayWho !== "all") tasks = tasks.filter((t) => peopleOf(t).some((p) => p.id === state.todayWho));
    const week = addDays(today, 7);
    const dated = tasks.filter((t) => t.due);
    const overdue = dated.filter((t) => t.due < today).sort((a, b) => a.due < b.due ? -1 : 1);
    const dueToday = dated.filter((t) => t.due === today);
    const upcoming = dated.filter((t) => t.due > today && t.due <= week).sort((a, b) => a.due < b.due ? -1 : 1);
    // "All" scope also shows everything else
    const later = dated.filter((t) => t.due > week).sort((a, b) => a.due < b.due ? -1 : 1);
    const noDate = tasks.filter((t) => !t.due).sort((a, b) => (b.priority - a.priority) || (a.position - b.position));

    const section = (title, cls, items, empty) => `
      <div class="today-sec">
        <h3 class="today-sec-title ${cls}">${title} <span class="col-count">${items.length}</span></h3>
        ${items.length ? items.map((t) => {
          const p = projOf(t);
          const people = peopleOf(t);
          const avatars = people.map((pe) => `<span class="avatar" style="background:${pe.color}" title="${escAttr(pe.name)}">${initials(pe.name)}</span>`).join("");
          return `<div class="today-row" data-id="${t.id}">
            <span class="today-due ${cls}">${t.due ? (t.due === today ? "today" : fmtDate(t.due)) : "—"}</span>
            <span class="today-title">${esc(t.title)}${t.recur ? ` <span class="badge badge-recur">↻</span>` : ""}</span>
            <span class="today-proj">${p ? `<i style="background:${p.color}"></i>${esc(p.name)}` : ""}</span>
            <span class="today-stage" style="border-color:${stageColor(t.status, t.project_id)}">${esc(t.status)}</span>
            <span class="today-who">${avatars}</span>
          </div>`;
        }).join("") : `<div class="empty-hint">${empty}</div>`}
      </div>`;

    const scopeBtn = (id, label) => `<button class="who-chip scope-chip ${state.todayScope === id ? "active" : ""}" data-scope="${id}">${label}</button>`;
    wrap.innerHTML =
      `<div class="who-bar">${chips}<span class="who-sep"></span>${scopeBtn("due", "Due soon")}${scopeBtn("all", "All tasks")}</div>` +
      section("Overdue", "over", overdue, "Nothing overdue. Steady.") +
      section("Due today", "soon", dueToday, "Nothing due today.") +
      section("Next 7 days", "", upcoming, "Clear week ahead.") +
      (state.todayScope === "all"
        ? section("Later", "", later, "Nothing further out.") +
          section("No date", "", noDate, "Everything has a date.")
        : "");

    $$(".who-chip[data-who]", wrap).forEach((b) => b.addEventListener("click", () => {
      state.todayWho = b.dataset.who;
      renderToday();
    }));
    $$(".scope-chip", wrap).forEach((b) => b.addEventListener("click", () => {
      state.todayScope = b.dataset.scope;
      renderToday();
    }));

    $$(".today-row", wrap).forEach((row) => row.addEventListener("click", () => {
      const t = byId(state.tasks, row.dataset.id);
      if (t) openTaskModal(t);
    }));
  }

  function renderChat() {
    const wrap = $("#chat-wrap");
    if (!wrap) return;
    const msgs = state.chat;
    if (!msgs.length) {
      wrap.innerHTML = `<div class="empty-hint">No messages yet. Say hello — this is the same thread as Telegram @fluso_pm_bot.</div>`;
      return;
    }
    wrap.innerHTML = msgs.map((m) => {
      const dt = new Date(m.created_at);
      const when = dt.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " · " +
        dt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const mine = m.role === "fluso";
      return `<div class="chat-msg ${mine ? "fluso" : "akash"}">
        <div class="chat-bubble">${esc(m.text)}</div>
        <div class="chat-meta">${mine ? "Fluso" : "Akash"} · ${when}</div>
      </div>`;
    }).join("");
    wrap.scrollTop = wrap.scrollHeight;
  }

  async function sendChat() {
    const inp = $("#chat-input");
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    const c = await DB.addChat("user", text);   // app-side message → chat table
    if (!state.chat.some((x) => x.id === c.id)) state.chat.push(c);
    renderChat();
  }

  /* ---------- project context menu (right-click / long-press on a chip) ---------- */
  let projMenuEl = null;
  function closeProjectMenu() { if (projMenuEl) { projMenuEl.remove(); projMenuEl = null; } }
  function openProjectMenu(id, label, x, y) {
    closeProjectMenu();
    const m = document.createElement("div");
    m.className = "ctx-menu";
    m.innerHTML = `
      <button class="ctx-item" data-act="rename">✎ Rename</button>
      <button class="ctx-item ctx-danger" data-act="delete">✕ Delete</button>`;
    document.body.appendChild(m);
    projMenuEl = m;
    // keep inside viewport
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
    m.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
    m.addEventListener("click", async (e) => {
      const act = e.target.closest(".ctx-item")?.dataset.act;
      closeProjectMenu();
      if (act === "rename") renameProject(id, label);
      else if (act === "delete") deleteProject(id, label);
    });
    setTimeout(() => {
      document.addEventListener("click", closeProjectMenu, { once: true });
      document.addEventListener("contextmenu", closeProjectMenu, { once: true });
    }, 0);
  }

  async function renameProject(id, oldName) {
    const name = prompt("Rename project:", oldName);
    if (!name || !name.trim() || name.trim() === oldName) return;
    const p = byId(state.projects, id);
    if (p) p.name = name.trim();
    await DB.updateProject(id, { name: name.trim() });
    render();
  }

  async function deleteProject(id, label) {
    const n = state.tasks.filter((t) => t.project_id === id).length;
    if (!confirm(`Delete project "${label}" and its ${n} task${n !== 1 ? "s" : ""}? This cannot be undone.`)) return;
    await DB.deleteProject(id);
    state.projects = state.projects.filter((x) => x.id !== id);
    state.columns = state.columns.filter((x) => x.project_id !== id);
    state.tasks = state.tasks.filter((x) => x.project_id !== id);
    state.updates = state.updates.filter((x) => x.project_id !== id);
    if (state.activeProject === id) state.activeProject = "all";
    render();
  }

  /* ---------- MODALS ---------- */
  let modalEl = null;
  function closeModal() {
    if (modalEl) {
      modalEl.remove(); modalEl = null; state.modalTask = null;
      if (state._reloadPending) { state._reloadPending = false; reload().then(render); }
    }
  }
  function modalShell(html) {
    closeModal();
    const back = document.createElement("div");
    back.className = "modal-backdrop";
    back.innerHTML = `<div class="modal">${html}</div>`;
    back.addEventListener("click", (e) => { if (e.target === back) closeModal(); });
    document.body.appendChild(back);
    modalEl = back;
    return back;
  }

  function openTaskModal(task, preset = {}) {
    const isNew = !task;
    const t = task || { title: "", project_id: state.activeProject !== "all" ? state.activeProject : (state.projects[0] || {}).id, status: preset.status || "To do", priority: 2, start: "", due: "", notes: "", assignees: [] };
    const projCols = colsForProject(t.project_id);
    const stageOpts = (projCols.length ? projCols : visibleStages())
      .map((s) => `<option value="${escAttr(s.name)}" ${String(t.status).toLowerCase() === s.name.toLowerCase() ? "selected" : ""}>${esc(s.name)}</option>`).join("");
    const projOpts = state.projects
      .map((p) => `<option value="${p.id}" ${t.project_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    const selPeople = peopleOf(t).map((x) => x.id);
    const peopleOpts = state.people
      .map((pe) => `<option value="${pe.id}" ${selPeople.includes(pe.id) ? "selected" : ""}>${esc(pe.name)}</option>`).join("");

    const back = modalShell(`
      <h3>${isNew ? "New task" : "Edit task"}</h3>
      <label>Title<input id="m-title" value="${escAttr(t.title)}" placeholder="What needs doing?"></label>
      <div class="modal-grid">
        <label>Project<select id="m-proj">${projOpts}</select></label>
        <label>Status<select id="m-status">${stageOpts}</select></label>
      </div>
      <div class="modal-grid">
        <label>Start<input id="m-start" type="date" value="${t.start || ""}"></label>
        <label>Due<input id="m-due" type="date" value="${t.due || ""}"></label>
      </div>
      <div class="modal-grid">
        <label>Priority<select id="m-pri">
          <option value="1" ${t.priority === 1 ? "selected" : ""}>Low</option>
          <option value="2" ${t.priority === 2 ? "selected" : ""}>Normal</option>
          <option value="3" ${t.priority === 3 ? "selected" : ""}>High</option>
        </select></label>
        <label>Assigned to<select id="m-assignee" multiple size="3">${peopleOpts}</select><span class="muted" style="font-size:11px">hold Ctrl/Cmd for several</span></label>
        <label>Repeats<select id="m-recur">
          <option value="" ${!t.recur ? "selected" : ""}>Never</option>
          <option value="daily" ${t.recur === "daily" ? "selected" : ""}>Daily</option>
          <option value="weekly" ${t.recur === "weekly" ? "selected" : ""}>Weekly</option>
          <option value="biweekly" ${t.recur === "biweekly" ? "selected" : ""}>Every 2 weeks</option>
          <option value="monthly" ${t.recur === "monthly" ? "selected" : ""}>Monthly</option>
        </select></label>
      </div>
      <label>Notes<textarea id="m-notes" rows="3">${esc(t.notes || "")}</textarea></label>
      <div class="modal-actions">
        ${isNew ? "" : `<button class="btn-danger" id="m-del">Delete</button>`}
        <span class="spacer"></span>
        <button class="btn-ghost" id="m-cancel">Cancel</button>
        <button class="btn-accent" id="m-save">${isNew ? "Add task" : "Save"}</button>
      </div>`);

    // when project changes, reload its stages into the status select (keep choice if it exists there)
    $("#m-proj", back).addEventListener("change", (e) => {
      const prev = $("#m-status", back).value;
      const cols = colsForProject(e.target.value);
      $("#m-status", back).innerHTML = cols
        .map((s) => `<option value="${escAttr(s.name)}">${esc(s.name)}</option>`).join("");
      if (cols.some((s) => s.name === prev)) $("#m-status", back).value = prev;
    });

    $("#m-cancel", back).onclick = closeModal;
    if (!isNew) $("#m-del", back).onclick = guard(async () => {
      if (!confirm(`Delete "${t.title}"?`)) return;
      await DB.deleteTask(t.id);
      state.tasks = state.tasks.filter((x) => x.id !== t.id);
      closeModal(); render();
    });
    $("#m-save", back).onclick = guard(async () => {
      const patch = {
        title: $("#m-title", back).value.trim(),
        project_id: $("#m-proj", back).value,
        status: $("#m-status", back).value,
        start: $("#m-start", back).value || null,
        due: $("#m-due", back).value || null,
        priority: parseInt($("#m-pri", back).value, 10),
        assignees: [...$("#m-assignee", back).selectedOptions].map((o) => o.value),
        recur: $("#m-recur", back).value || null,
        notes: $("#m-notes", back).value.trim(),
      };
      patch.assignee_id = patch.assignees[0] || null; // keep legacy col in sync
      if (!patch.title) { $("#m-title", back).focus(); return; }
      if (isNew) {
        const created = await DB.addTask(patch);
        if (!state.tasks.some((x) => x.id === created.id)) state.tasks.push(created);
      } else {
        Object.assign(t, patch);
        await DB.updateTask(t.id, patch);
      }
      closeModal(); render();
    });
    setTimeout(() => $("#m-title", back).focus(), 50);
  }

  function openColumnModal(col) {
    const isNew = !col;
    const c = col || { name: "", color: COL_COLORS[colsForProject(state.activeProject).length % COL_COLORS.length] };
    const swatches = COL_COLORS.map((hex) =>
      `<button type="button" class="swatch ${c.color === hex ? "sel" : ""}" data-color="${hex}" style="background:${hex}"></button>`).join("");
    const back = modalShell(`
      <h3>${isNew ? "New column" : "Edit column"}</h3>
      <label>Name<input id="c-name" value="${escAttr(c.name)}" placeholder="e.g. Review"></label>
      <label>Color<div class="swatches">${swatches}</div></label>
      <div class="modal-actions">
        ${isNew ? "" : `<button class="btn-danger" id="c-del">Delete</button>`}
        <span class="spacer"></span>
        <button class="btn-ghost" id="c-cancel">Cancel</button>
        <button class="btn-accent" id="c-save">${isNew ? "Add column" : "Save"}</button>
      </div>`);

    let picked = c.color;
    $$(".swatch", back).forEach((b) => b.onclick = () => {
      picked = b.dataset.color;
      $$(".swatch", back).forEach((x) => x.classList.toggle("sel", x === b));
    });
    $("#c-cancel", back).onclick = closeModal;
    if (!isNew) $("#c-del", back).onclick = guard(async () => {
      const inUse = state.tasks.filter((t) => t.project_id === state.activeProject &&
        String(t.status).toLowerCase() === c.name.toLowerCase()).length;
      if (inUse) { alert(`"${c.name}" still has ${inUse} task${inUse > 1 ? "s" : ""}. Move them first.`); return; }
      const remaining = colsForProject(state.activeProject).filter((x) => x.id !== c.id);
      if (!remaining.length) { alert("A project needs at least one column."); return; }
      await DB.deleteColumn(c.id);
      state.columns = state.columns.filter((x) => x.id !== c.id);
      closeModal(); render();
    });
    $("#c-save", back).onclick = guard(async () => {
      const name = $("#c-name", back).value.trim();
      if (!name) { $("#c-name", back).focus(); return; }
      if (isNew) {
        const pos = Math.max(0, ...colsForProject(state.activeProject).map((x) => x.position)) + 1;
        const created = await DB.addColumn(state.activeProject, name, picked, pos);
        if (!state.columns.some((x) => x.id === created.id)) state.columns.push(created);
      } else {
        const oldName = c.name;
        Object.assign(c, { name, color: picked });
        await DB.updateColumn(c.id, { name, color: picked });
        // keep tasks pointing at renamed stage
        if (oldName.toLowerCase() !== name.toLowerCase()) {
          const affected = state.tasks.filter((t) => t.project_id === c.project_id &&
            String(t.status).toLowerCase() === oldName.toLowerCase());
          for (const t of affected) { t.status = name; await DB.updateTask(t.id, { status: name }); }
        }
      }
      closeModal(); render();
    });
    setTimeout(() => $("#c-name", back).focus(), 50);
  }

  function openPersonModal() {
    const list = state.people.map((p) => {
      const n = state.tasks.filter((t) => (t.assignees || []).includes(p.id) && !isDoneStage(t.status)).length;
      return `<div class="person-row" data-id="${p.id}">
        <span class="avatar" style="background:${p.color}">${initials(p.name)}</span>
        <span class="person-name">${esc(p.name)}</span>
        <span class="muted">${n} active</span>
        <button class="btn-danger person-del" data-id="${p.id}">Remove</button>
      </div>`;
    }).join("") || `<div class="empty-hint">No people yet.</div>`;
    const back = modalShell(`
      <h3>People</h3>
      <div class="people-list">${list}</div>
      <label style="margin-top:16px">Add person<input id="p-name" placeholder="Name"></label>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button class="btn-ghost" id="p-close">Close</button>
        <button class="btn-accent" id="p-add">Add</button>
      </div>`);
    $("#p-close", back).onclick = closeModal;
    $("#p-add", back).onclick = guard(async () => {
      const name = $("#p-name", back).value.trim();
      if (!name) return;
      if (state.people.some((p) => p.name.toLowerCase() === name.toLowerCase())) { alert("Already in the list."); return; }
      const color = PERSON_COLORS[state.people.length % PERSON_COLORS.length];
      const created = await DB.addPerson(name, color);
      state.people.push(created);
      closeModal(); openPersonModal(); render();
    });
    $$(".person-del", back).forEach((b) => b.onclick = guard(async () => {
      const p = byId(state.people, b.dataset.id);
      if (!confirm(`Remove ${p.name}? Their tasks become unassigned.`)) return;
      await DB.deletePerson(p.id);
      state.people = state.people.filter((x) => x.id !== p.id);
      state.tasks.forEach((t) => { t.assignees = (t.assignees || []).filter((x) => x !== p.id); t.assignee_id = t.assignees[0] || null; });
      closeModal(); openPersonModal(); render();
    }));
    setTimeout(() => $("#p-name", back).focus(), 50);
  }

  function openProjectModal() {
    const back = modalShell(`
      <h3>New project</h3>
      <label>Name<input id="np-name" placeholder="Project name"></label>
      <div class="modal-actions">
        <span class="spacer"></span>
        <button class="btn-ghost" id="np-cancel">Cancel</button>
        <button class="btn-accent" id="np-save">Create</button>
      </div>`);
    $("#np-cancel", back).onclick = closeModal;
    $("#np-save", back).onclick = guard(async () => {
      const name = $("#np-name", back).value.trim();
      if (!name) return;
      const p = await DB.addProject(name);
      p.color = PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length];
      if (!state.projects.some((x) => x.id === p.id)) state.projects.push(p);
      if (p._columns) p._columns.forEach((c) => { if (!state.columns.some((x) => x.id === c.id)) state.columns.push(c); });
      state.activeProject = p.id;
      closeModal(); render();
    });
    setTimeout(() => $("#np-name", back).focus(), 50);
  }

  /* ---------- boot ---------- */
  async function reload() {
    const data = await DB.loadAll();
    // defensive: never let the same row appear twice in state
    const dedupe = (arr) => {
      const seen = new Set();
      return (arr || []).filter((x) => {
        if (!x || !x.id || seen.has(x.id)) return false;
        seen.add(x.id); return true;
      });
    };
    state.projects = dedupe(data.projects);
    state.columns = dedupe(data.columns);
    state.people = dedupe(data.people);
    state.tasks = dedupe(data.tasks);
    state.updates = dedupe(data.updates);
    state.chat = dedupe(await DB.loadChat(150));
  }

  function bind() {
    $$(".tab").forEach((t) => t.onclick = () => { state.view = t.dataset.view; render(); });
    $("#btn-refresh").onclick = async (e) => {
      e.currentTarget.classList.add("spin");
      await reload(); render();
      setTimeout(() => $("#btn-refresh").classList.remove("spin"), 600);
    };
    $("#fab").onclick = () => openTaskModal(null);
    $("#btn-people").onclick = openPersonModal;
    $("#btn-add-project").onclick = openProjectModal;
    $("#chat-send").onclick = guard(sendChat);
    $("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
  }

  function subscribe() {
    if (DB.demo) return;
    try {
      const client = DB.client; // reuse the db.js client — one auth context only
      if (!client) return;
      const reloadDeb = () => {
        clearTimeout(state._rt);
        state._rt = setTimeout(async () => {
          // don't clobber an open modal or an in-flight drag — run after instead
          if (modalEl || touchDrag || state._busy) { state._reloadPending = true; return; }
          await reload(); render();
        }, 400);
      };
      client.channel("board-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, reloadDeb)
        .on("postgres_changes", { event: "*", schema: "public", table: "updates" }, reloadDeb)
        .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, reloadDeb)
        .on("postgres_changes", { event: "*", schema: "public", table: "columns" }, reloadDeb)
        .on("postgres_changes", { event: "*", schema: "public", table: "people" }, reloadDeb)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat" }, (payload) => {
          const row = payload.new;
          if (row && !state.chat.some((x) => x.id === row.id)) {
            state.chat.push(row);
            if (state.view === "updates") renderChat();
          }
        })
        .subscribe();
    } catch (e) { /* realtime optional */ }
  }

  async function boot() {
    bind();
    const session = await DB.session();
    if (!session && !DB.demo) {
      $("#login").classList.remove("hidden");
      $("#login-btn").onclick = async () => {
        $("#login-err").textContent = "";
        try {
          await DB.signIn($("#login-email").value.trim(), $("#login-pass").value);
          $("#login").classList.add("hidden");
          await reload(); switchView("board"); subscribe();
        } catch (e) {
          $("#login-err").textContent = "Login failed — continuing in demo mode.";
          setTimeout(async () => {
            $("#login").classList.add("hidden");
            window.DB.demo = true;
            await reload(); switchView("board");
          }, 900);
        }
      };
      return;
    }
    await reload();
    switchView("board");
    subscribe();
  }

  function switchView(v) { state.view = v; render(); }

  window.addEventListener("DOMContentLoaded", boot);
})();
