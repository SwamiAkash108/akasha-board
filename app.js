/* app.js — Akasha Board UI logic */
(function () {
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const STATUSES = [
    { id: "todo", name: "To do", color: "var(--grey)" },
    { id: "doing", name: "Doing", color: "var(--amber)" },
    { id: "blocked", name: "Blocked", color: "var(--red)" },
    { id: "done", name: "Done", color: "var(--green)" },
  ];
  const PROJECT_COLORS = ["#e8a33d", "#c96f3f", "#7ba05b", "#5b8fa0", "#a05b8f", "#8f7bd8"];

  const state = { projects: [], tasks: [], updates: [], activeProject: "all", view: "board", modalTask: null };

  /* ---------- helpers ---------- */
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const addDays = (ds, n) => { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const diffDays = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5);
  const fmtDate = (ds) => ds ? new Date(ds + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "";
  const relTime = (iso) => {
    const s = (Date.now() - new Date(iso).getTime()) / 1e3;
    if (s < 60) return "now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  };
  const projById = (id) => state.projects.find((p) => p.id === id);
  const projColor = (p, i) => p.color || PROJECT_COLORS[i % PROJECT_COLORS.length];
  const visibleTasks = () => state.tasks.filter((t) => state.activeProject === "all" || t.project_id === state.activeProject);
  const toast = (msg) => {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; t.style.cssText = "position:fixed;left:50%;bottom:150px;transform:translateX(-50%);background:#c94f3f;color:#fff;padding:10px 18px;border-radius:10px;z-index:200;font-size:13.5px;box-shadow:0 6px 20px rgba(0,0,0,.4)"; document.body.appendChild(t); }
    t.textContent = msg; t.style.opacity = "1";
    clearTimeout(t._tm); t._tm = setTimeout(() => (t.style.opacity = "0"), 3200);
  };

  /* ---------- data ---------- */
  async function reload() {
    try {
      const data = await DB.loadAll();
      state.projects = data.projects;
      state.tasks = data.tasks;
      state.updates = data.updates;
      renderChips(); render();
    } catch (e) { console.error(e); toast("Couldn't load data"); }
  }

  /* ---------- project chips ---------- */
  function renderChips() {
    const box = $("#project-chips");
    box.innerHTML = "";
    const all = document.createElement("button");
    all.className = "chip" + (state.activeProject === "all" ? " active" : "");
    all.textContent = "All projects";
    all.onclick = () => { state.activeProject = "all"; renderChips(); render(); };
    box.appendChild(all);
    state.projects.forEach((p, i) => {
      const c = document.createElement("button");
      c.className = "chip" + (state.activeProject === p.id ? " active" : "");
      c.textContent = p.name;
      if (state.activeProject !== p.id) c.style.borderLeft = `3px solid ${projColor(p, i)}`;
      c.onclick = () => { state.activeProject = p.id; renderChips(); render(); };
      box.appendChild(c);
    });
  }

  /* ---------- board ---------- */
  function renderBoard() {
    const board = $("#board");
    board.innerHTML = "";
    const tasks = visibleTasks();
    for (const st of STATUSES) {
      const col = document.createElement("div");
      col.className = "col"; col.dataset.status = st.id;
      const list = tasks.filter((t) => t.status === st.id)
        .sort((a, b) => (a.position - b.position) || String(a.created_at).localeCompare(String(b.created_at)));
      col.innerHTML = `<div class="col-head"><span class="col-dot" style="background:${st.color}"></span>
        <span class="col-name">${st.name}</span><span class="col-count">${list.length}</span></div>
        <div class="col-body"></div>`;
      const body = $(".col-body", col);
      for (const t of list) body.appendChild(cardEl(t));
      const add = document.createElement("button");
      add.className = "add-task"; add.textContent = "+ add task";
      add.onclick = () => openModal(null, st.id);
      col.appendChild(add);
      board.appendChild(col);
    }
  }

  function cardEl(t) {
    const el = document.createElement("div");
    el.className = "card"; el.dataset.id = t.id;
    const p = projById(t.project_id);
    const pi = state.projects.indexOf(p);
    let meta = "";
    if (t.due) {
      const left = diffDays(todayStr(), t.due);
      const cls = t.status === "done" ? "" : left < 0 ? " over" : left <= 2 ? " soon" : "";
      meta += `<span class="badge badge-due${cls}">${left < 0 && t.status !== "done" ? Math.abs(left) + "d over" : fmtDate(t.due)}</span>`;
    }
    if (t.priority === 3) meta += `<span class="badge badge-pri3">▲ high</span>`;
    if (t.priority === 1) meta += `<span class="badge badge-pri1">▽ low</span>`;
    if (state.activeProject === "all" && p) meta += `<span class="card-proj" style="color:${projColor(p, pi)}">${esc(p.name)}</span>`;
    el.innerHTML = `<div class="card-title">${esc(t.title)}</div>${meta ? `<div class="card-meta">${meta}</div>` : ""}`;
    attachDrag(el, t);
    return el;
  }

  /* pointer drag & drop (mouse + touch) */
  function attachDrag(el, task) {
    let dragging = false, moved = false, ghost = null, pressTimer = null, startX = 0, startY = 0, pid = null;

    const startDrag = (e) => {
      dragging = true;
      el.classList.add("dragging");
      ghost = document.createElement("div");
      ghost.className = "card-ghost";
      el.after(ghost);
      moveGhost(e.clientX, e.clientY);
    };
    const moveGhost = (x, y) => {
      const under = document.elementFromPoint(x, y);
      const col = under && under.closest(".col");
      if (!col) return;
      const body = $(".col-body", col);
      const after = [...body.querySelectorAll(".card:not(.dragging)")]
        .find((c) => { const r = c.getBoundingClientRect(); return y < r.top + r.height / 2; });
      if (after) body.insertBefore(ghost, after); else body.appendChild(ghost);
    };
    const onMove = (e) => {
      if (!dragging) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) > 6) {
          clearTimeout(pressTimer);
          if (e.pointerType === "mouse") startDrag(e); else pid = null;
        }
        return;
      }
      moved = true;
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
    };
    const onUp = async (e) => {
      clearTimeout(pressTimer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!dragging) { if (pid === e.pointerId && !moved) openModal(task); return; }
      el.classList.remove("dragging");
      if (!ghost) return;
      const col = ghost.closest(".col");
      const body = ghost.parentElement;
      const next = ghost.nextElementSibling;
      const prev = ghost.previousElementSibling;
      const status = col ? col.dataset.status : task.status;
      const posPrev = prev && prev.dataset ? (state.tasks.find((t) => t.id === prev.dataset.id) || {}).position : null;
      const posNext = next && next.dataset ? (state.tasks.find((t) => t.id === next.dataset.id) || {}).position : null;
      let position = Date.now();
      if (posPrev != null && posNext != null) position = (posPrev + posNext) / 2;
      else if (posPrev != null) position = posPrev + 1;
      else if (posNext != null) position = posNext - 1;
      ghost.remove(); ghost = null;
      task.status = status; task.position = position;
      renderBoard();
      try { await DB.updateTask(task.id, { status, position }); } catch (err) { toast("Save failed"); reload(); }
    };

    el.addEventListener("pointerdown", (e) => {
      if (e.button && e.button !== 0) return;
      pid = e.pointerId; moved = false; startX = e.clientX; startY = e.clientY;
      pressTimer = setTimeout(() => { if (pid != null) startDrag(e); }, e.pointerType === "mouse" ? 140 : 260);
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
  }

  /* ---------- modal ---------- */
  function openModal(task, presetStatus) {
    state.modalTask = task || null;
    $("#modal-title").textContent = task ? "Edit task" : "New task";
    $("#f-title").value = task ? task.title : "";
    $("#f-notes").value = task ? (task.notes || "") : "";
    $("#f-status").value = task ? task.status : (presetStatus || "todo");
    $("#f-priority").value = String(task ? task.priority : 2);
    $("#f-start").value = task && task.start ? task.start : "";
    $("#f-due").value = task && task.due ? task.due : "";
    $("#f-delete").style.visibility = task ? "visible" : "hidden";
    // project selector
    let sel = $("#f-project");
    if (!sel) {
      const lab = document.createElement("label");
      lab.textContent = "Project";
      sel = document.createElement("select"); sel.id = "f-project";
      lab.appendChild(sel);
      $("#modal .modal-grid").before(lab);
    }
    sel.innerHTML = state.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("");
    sel.value = task ? task.project_id : (state.activeProject !== "all" ? state.activeProject : (state.projects[0] || {}).id);
    $("#modal-backdrop").classList.remove("hidden");
    setTimeout(() => $("#f-title").focus(), 50);
  }
  function closeModal() { $("#modal-backdrop").classList.add("hidden"); state.modalTask = null; }

  async function saveModal() {
    const title = $("#f-title").value.trim();
    if (!title) { $("#f-title").focus(); return; }
    const row = {
      title,
      notes: $("#f-notes").value.trim(),
      status: $("#f-status").value,
      priority: parseInt($("#f-priority").value, 10),
      start: $("#f-start").value || null,
      due: $("#f-due").value || null,
      project_id: $("#f-project").value,
    };
    closeModal();
    try {
      if (state.modalTask) {
        Object.assign(state.modalTask, row);
        render();
        await DB.updateTask(state.modalTask.id, row);
      } else {
        const t = await DB.addTask(row);
        state.tasks.push(t);
        render();
      }
    } catch (e) { console.error(e); toast("Save failed"); reload(); }
  }

  /* ---------- timeline ---------- */
  function renderTimeline() {
    const tl = $("#timeline");
    const uns = $("#unscheduled");
    tl.innerHTML = ""; uns.innerHTML = "";
    const tasks = visibleTasks().filter((t) => t.status !== "done" || true);
    const sched = tasks.filter((t) => t.due || t.start);
    const unsTasks = tasks.filter((t) => !t.due && !t.start && t.status !== "done");

    if (!sched.length) {
      tl.innerHTML = `<p class="muted" style="padding:24px 4px">No scheduled tasks yet. Give tasks a start and due date and they appear here.</p>`;
    } else {
      let min = null, max = null;
      for (const t of sched) {
        const s = t.start || t.due, e2 = t.due || t.start;
        if (!min || s < min) min = s;
        if (!max || e2 > max) max = e2;
      }
      min = addDays(min, -2); max = addDays(max, 4);
      const t0 = todayStr();
      if (t0 < min) min = addDays(t0, -2);
      if (t0 > max) max = addDays(t0, 4);
      const span = diffDays(min, max) + 1;
      const DW = 40, LABEL_W = 190;

      // header
      const head = document.createElement("div");
      head.className = "tl-header";
      head.style.paddingLeft = LABEL_W + "px";
      for (let i = 0; i < span; i++) {
        const ds = addDays(min, i);
        const dow = new Date(ds + "T00:00:00").getDay();
        const cell = document.createElement("div");
        cell.className = "tl-day" + ((dow === 0 || dow === 6) ? " wknd" : "") + (ds === t0 ? " today" : "");
        cell.style.width = DW + "px";
        cell.textContent = new Date(ds + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", weekday: "narrow" });
        head.appendChild(cell);
      }
      tl.appendChild(head);
      tl.style.width = LABEL_W + span * DW + "px";

      const mkGrid = (track) => {
        for (let i = 0; i < span; i++) {
          const ds = addDays(min, i);
          const dow = new Date(ds + "T00:00:00").getDay();
          const g = document.createElement("div");
          g.className = "tl-gridline" + ((dow === 0 || dow === 6) ? " wknd" : "");
          g.style.left = i * DW + "px";
          track.appendChild(g);
        }
        if (t0 >= min && t0 <= max) {
          const td = document.createElement("div");
          td.className = "tl-today"; td.style.left = diffDays(min, t0) * DW + "px";
          track.appendChild(td);
        }
      };

      const groups = state.activeProject === "all"
        ? state.projects.map((p, i) => ({ p, i, tasks: sched.filter((t) => t.project_id === p.id) })).filter((g) => g.tasks.length)
        : [{ p: projById(state.activeProject), i: state.projects.indexOf(projById(state.activeProject)), tasks: sched }];

      for (const g of groups) {
        if (state.activeProject === "all") {
          const gh = document.createElement("div");
          gh.className = "tl-group";
          gh.innerHTML = `<span class="gdot" style="background:${projColor(g.p, g.i)}"></span>${esc(g.p.name)}`;
          tl.appendChild(gh);
        }
        for (const t of g.tasks.sort((a, b) => String(a.start || a.due).localeCompare(String(b.start || b.due)))) {
          const row = document.createElement("div");
          row.className = "tl-row";
          const lab = document.createElement("div");
          lab.className = "tl-label"; lab.style.width = LABEL_W + "px";
          lab.textContent = t.title; lab.title = t.title;
          const track = document.createElement("div");
          track.className = "tl-track"; track.style.width = span * DW + "px";
          mkGrid(track);
          const s = t.start || t.due, e2 = t.due || t.start;
          const bar = document.createElement("div");
          bar.className = "tl-bar" + (t.status === "done" ? " done" : (t.due && t.due < t0 ? " overdue" : ""));
          bar.style.left = diffDays(min, s) * DW + 2 + "px";
          bar.style.width = Math.max(diffDays(s, e2) + 1, 1) * DW - 5 + "px";
          const base = state.activeProject === "all" ? projColor(g.p, g.i) : "var(--amber)";
          bar.style.background = bar.classList.contains("overdue") ? "" : base;
          bar.textContent = t.title;
          bar.onclick = () => openModal(t);
          track.appendChild(bar);
          row.appendChild(lab); row.appendChild(track);
          tl.appendChild(row);
        }
      }
    }

    if (unsTasks.length) {
      uns.innerHTML = `<h4>Unscheduled</h4>`;
      for (const t of unsTasks) {
        const item = document.createElement("div");
        item.className = "uns-item";
        item.innerHTML = `<span>${esc(t.title)}</span>`;
        const b = document.createElement("button");
        b.className = "btn-ghost"; b.textContent = "Set dates";
        b.onclick = () => openModal(t);
        item.appendChild(b);
        uns.appendChild(item);
      }
    }
  }

  /* ---------- charts ---------- */
  function renderCharts() {
    const box = $("#charts");
    box.innerHTML = "";
    const tasks = visibleTasks();

    // donut: by status
    const byStatus = STATUSES.map((st) => ({ ...st, n: tasks.filter((t) => t.status === st.id).length }));
    const total = tasks.length || 1;
    const R = 52, C = 2 * Math.PI * R;
    let acc = 0;
    const colorMap = { todo: "#8a7f6b", doing: "#b3352c", blocked: "#2b4361", done: "#6b7040" };
    const arcs = byStatus.map((s) => {
      const frac = s.n / total;
      const seg = `<circle r="${R}" cx="70" cy="70" fill="none" stroke="${colorMap[s.id]}" stroke-width="17"
        stroke-dasharray="${Math.max(frac * C - 3, 0)} ${C}" stroke-dashoffset="${-acc * C}"
        transform="rotate(-90 70 70)" stroke-linecap="round" style="transition:stroke-dasharray .6s ease"/>`;
      acc += frac; return seg;
    }).join("");
    const donut = document.createElement("div");
    donut.className = "panel";
    donut.innerHTML = `<h3>By status</h3><div class="donut-wrap">
      <svg width="140" height="140" viewBox="0 0 140 140">${arcs}
        <text x="70" y="68" text-anchor="middle" class="donut-center" fill="var(--ink)" font-size="24">${tasks.length}</text>
        <text x="70" y="86" text-anchor="middle" class="donut-center-sub" fill="var(--faint)" font-size="9">TASKS</text></svg>
      <div class="donut-legend">${byStatus.map((s) => `<div class="li"><span class="sw" style="background:${colorMap[s.id]}"></span>${s.name}<span class="n">${s.n}</span></div>`).join("")}</div>
    </div>`;
    box.appendChild(donut);

    // activity: done in last 14 days
    const days = [...Array(14)].map((_, i) => addDays(todayStr(), i - 13));
    const donePerDay = days.map((ds) => state.tasks.filter((t) => t.status === "done" && String(t.updated_at || "").slice(0, 10) === ds).length
      + state.updates.filter((u) => String(u.created_at).slice(0, 10) === ds).length);
    const maxA = Math.max(...donePerDay, 1);
    const act = document.createElement("div");
    act.className = "panel";
    act.innerHTML = `<h3>Activity, last 14 days</h3><div class="bars">${
      days.map((ds, i) => `<div class="bar-col"><div class="bar" style="height:${Math.round((donePerDay[i] / maxA) * 100)}%" title="${ds}: ${donePerDay[i]}"></div><div class="bar-lab">${ds.slice(8)}</div></div>`).join("")
    }</div>`;
    box.appendChild(act);

    // per-project progress
    const prog = document.createElement("div");
    prog.className = "panel";
    const projs = state.activeProject === "all" ? state.projects : state.projects.filter((p) => p.id === state.activeProject);
    prog.innerHTML = `<h3>Progress per project</h3>` + (projs.length ? projs.map((p, i) => {
      const pt = state.tasks.filter((t) => t.project_id === p.id);
      const done = pt.filter((t) => t.status === "done").length;
      const pct = pt.length ? Math.round((done / pt.length) * 100) : 0;
      return `<div class="proj-row"><div class="pr-head"><span>${esc(p.name)}</span><span class="pct">${done}/${pt.length} · ${pct}%</span></div>
        <div class="progress"><i style="width:${pct}%;background:${projColor(p, state.projects.indexOf(p))}"></i></div></div>`;
    }).join("") : `<p class="muted">No projects yet.</p>`);
    box.appendChild(prog);

    // overdue
    const over = tasks.filter((t) => t.due && t.due < todayStr() && t.status !== "done")
      .sort((a, b) => a.due.localeCompare(b.due));
    const ov = document.createElement("div");
    ov.className = "panel";
    ov.innerHTML = `<h3>Overdue</h3>` + (over.length ? over.map((t) => {
      const p = projById(t.project_id);
      return `<div class="over-item"><span>${esc(t.title)}</span><span class="over-days">${diffDays(t.due, todayStr())}d over${p ? " · " + esc(p.name) : ""}</span></div>`;
    }).join("") : `<p class="muted">Nothing overdue. 🙏</p>`);
    box.appendChild(ov);
  }

  /* ---------- updates ---------- */
  function renderUpdates() {
    const box = $("#updates");
    box.innerHTML = "";
    const list = state.updates.filter((u) => state.activeProject === "all" || u.project_id === state.activeProject);
    if (!list.length) { box.innerHTML = `<p class="muted" style="text-align:center;padding:30px">No updates yet. Post one above, or send a voice note to @fluso_pm_bot.</p>`; return; }
    for (const u of list) {
      const p = u.project_id ? projById(u.project_id) : null;
      const el = document.createElement("div");
      el.className = "upd" + (u.author === "fluso" ? " fluso-post" : "");
      el.innerHTML = `<div class="upd-head">
        <span class="upd-author ${esc(u.author)}">${u.author === "fluso" ? "Fluso" : esc(u.author)}</span>
        ${p ? `<span class="upd-proj">${esc(p.name)}</span>` : ""}
        <span class="upd-time">${relTime(u.created_at)}</span></div>
        <div class="upd-text">${esc(u.text)}</div>`;
      box.appendChild(el);
    }
  }

  /* ---------- router / render ---------- */
  function render() {
    if (state.view === "board") renderBoard();
    else if (state.view === "timeline") renderTimeline();
    else if (state.view === "charts") renderCharts();
    else if (state.view === "updates") renderUpdates();
  }
  function switchView(v) {
    state.view = v;
    $$(".view").forEach((el) => el.classList.toggle("active", el.id === "view-" + v));
    $$(".tab").forEach((el) => el.classList.toggle("active", el.dataset.view === v));
    render();
  }

  /* ---------- wire up ---------- */
  function wire() {
    $$(".tab").forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
    $("#fab").onclick = () => openModal(null);
    $("#f-save").onclick = saveModal;
    $("#f-cancel").onclick = closeModal;
    $("#modal-backdrop").addEventListener("click", (e) => { if (e.target.id === "modal-backdrop") closeModal(); });
    $("#f-delete").onclick = async () => {
      const t = state.modalTask;
      if (!t) return;
      closeModal();
      state.tasks = state.tasks.filter((x) => x.id !== t.id);
      render();
      try { await DB.deleteTask(t.id); } catch (e) { toast("Delete failed"); reload(); }
    };
    $("#f-title").addEventListener("keydown", (e) => { if (e.key === "Enter") saveModal(); });
    $("#upd-send").onclick = postUpdate;
    $("#upd-input").addEventListener("keydown", (e) => { if (e.key === "Enter") postUpdate(); });
    $("#btn-refresh").onclick = () => { $("#btn-refresh").classList.add("spin"); setTimeout(() => $("#btn-refresh").classList.remove("spin"), 700); reload(); };
  }
  async function postUpdate() {
    const inp = $("#upd-input");
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    const pid = state.activeProject === "all" ? null : state.activeProject;
    try {
      const u = await DB.addUpdate(pid, text, "akash");
      state.updates.unshift(u);
      renderUpdates();
    } catch (e) { toast("Post failed"); }
  }

  /* ---------- boot ---------- */
  async function boot() {
    wire();
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    if (DB.demo) {
      await reload();
      switchView("board");
      return;
    }
    const sess = await DB.session();
    if (!sess) {
      $("#login").classList.remove("hidden");
      $("#login-btn").onclick = async () => {
        $("#login-err").textContent = "";
        try {
          await DB.signIn($("#login-email").value.trim(), $("#login-pass").value);
          $("#login").classList.add("hidden");
          await reload(); switchView("board"); subscribe();
        } catch (e) { $("#login-err").textContent = "Sign in failed. Check email and password."; }
      };
      return;
    }
    await reload();
    switchView("board");
    subscribe();
  }
  function subscribe() {
    // live refresh when Fluso (or another device) writes to the DB
    try {
      const cfg = window.APP_CONFIG;
      const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      client.channel("board-changes")
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => reload())
        .on("postgres_changes", { event: "*", schema: "public", table: "updates" }, () => reload())
        .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, () => reload())
        .subscribe();
    } catch (e) { /* realtime optional */ }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
